/**
 * Deposit API - Mints confidential tokens after wSOL deposit
 * 
 * User deposits wSOL to vault → API mints equivalent confidential tokens
 * 
 * PRODUCTION FEATURES:
 * - Transaction amount verification (prevents mint amount manipulation)
 * - Used deposit tracking (prevents double-minting from same TX)
 * - Vault balance verification
 */

import { NextRequest, NextResponse } from "next/server";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { NATIVE_MINT, getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import { encryptValue } from "@inco/solana-sdk/encryption";
import { hexToBuffer } from "@inco/solana-sdk/utils";
import { PROTOCOL_VAULT, PROTOCOL_INCO_MINT, MIN_DEPOSIT, MAX_DEPOSIT } from "@/lib/protocol";
import { getProgram, getAllowancePda, extractHandle } from "@/utils/constants";
import { AnchorWallet } from "@solana/wallet-adapter-react";
import { sql } from "@/lib/db";

// Server wallet wrapper
class NodeWallet {
    constructor(readonly payer: Keypair) { }
    get publicKey() { return this.payer.publicKey; }
    async signTransaction<T extends Transaction>(tx: T): Promise<T> {
        if (tx instanceof Transaction) tx.sign(this.payer);
        return tx;
    }
    async signAllTransactions<T extends Transaction>(txs: T[]): Promise<T[]> {
        return txs.map(t => { if (t instanceof Transaction) t.sign(this.payer); return t; });
    }
}

// Tolerance for amount verification (0.1% to account for rent/fees)
const AMOUNT_TOLERANCE = 0.001;

export async function POST(request: NextRequest) {
    try {
        const { wallet, amount, wsolTx, userAccount } = await request.json();

        if (!wallet || !amount || !wsolTx || !userAccount) {
            return NextResponse.json(
                { success: false, error: "Missing required fields" },
                { status: 400 }
            );
        }

        // Validate amount bounds
        if (amount < MIN_DEPOSIT) {
            return NextResponse.json(
                { success: false, error: `Minimum deposit is ${MIN_DEPOSIT} SOL` },
                { status: 400 }
            );
        }

        if (amount > MAX_DEPOSIT) {
            return NextResponse.json(
                { success: false, error: `Maximum deposit is ${MAX_DEPOSIT} SOL (devnet limit)` },
                { status: 400 }
            );
        }

        const connection = new Connection(
            process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com",
            "confirmed"
        );

        // === CHECK IF DEPOSIT TX ALREADY USED ===
        const usedCheck = await sql`
            SELECT 1 FROM used_deposits WHERE tx_signature = ${wsolTx}
        `.catch(() => []);

        if (usedCheck.length > 0) {
            return NextResponse.json(
                { success: false, error: "This deposit transaction has already been used" },
                { status: 400 }
            );
        }

        // Verify the wSOL deposit transaction
        const txInfo = await connection.getTransaction(wsolTx, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
        });

        if (!txInfo) {
            return NextResponse.json(
                { success: false, error: "Deposit transaction not found" },
                { status: 400 }
            );
        }

        // === VERIFY DEPOSIT AMOUNT ===
        // Check that the transaction actually sent the claimed amount to vault's wSOL ATA
        const vaultWsolAta = await getAssociatedTokenAddress(NATIVE_MINT, PROTOCOL_VAULT);
        const vaultWsolAtaString = vaultWsolAta.toBase58();

        // For wSOL deposits, we look for token balance changes or SOL transfers
        // Method 1: Check postTokenBalances for wSOL increase
        let verifiedAmount = 0;

        // Check token balance changes (for direct wSOL transfers)
        const preTokenBalances = txInfo.meta?.preTokenBalances || [];
        const postTokenBalances = txInfo.meta?.postTokenBalances || [];

        // Find vault's wSOL account in post balances
        const postVaultBalance = postTokenBalances.find(
            b => b.mint === NATIVE_MINT.toBase58() &&
                txInfo.transaction.message.getAccountKeys().get(b.accountIndex)?.toBase58() === vaultWsolAtaString
        );

        const preVaultBalance = preTokenBalances.find(
            b => b.mint === NATIVE_MINT.toBase58() &&
                txInfo.transaction.message.getAccountKeys().get(b.accountIndex)?.toBase58() === vaultWsolAtaString
        );

        if (postVaultBalance) {
            const postAmount = Number(postVaultBalance.uiTokenAmount.amount) / LAMPORTS_PER_SOL;
            const preAmount = preVaultBalance
                ? Number(preVaultBalance.uiTokenAmount.amount) / LAMPORTS_PER_SOL
                : 0;
            verifiedAmount = postAmount - preAmount;
        }

        // Method 2: If no token balance change, check for SystemProgram SOL transfer to vault wSOL ATA
        // (This happens when wrapping SOL directly into the ATA)
        if (verifiedAmount === 0 && txInfo.meta?.innerInstructions) {
            // Look for SOL transfers to the vault wSOL ATA
            const accountKeys = txInfo.transaction.message.getAccountKeys();
            for (let i = 0; i < accountKeys.length; i++) {
                if (accountKeys.get(i)?.toBase58() === vaultWsolAtaString) {
                    // Check pre/post balances for this account
                    const preBalance = txInfo.meta.preBalances[i] || 0;
                    const postBalance = txInfo.meta.postBalances[i] || 0;
                    if (postBalance > preBalance) {
                        verifiedAmount = (postBalance - preBalance) / LAMPORTS_PER_SOL;
                        break;
                    }
                }
            }
        }

        // Verify the amount matches (with tolerance)
        const requestedAmount = Number(amount);
        const tolerance = requestedAmount * AMOUNT_TOLERANCE;

        if (verifiedAmount < requestedAmount - tolerance) {
            console.error(`[Deposit] Amount mismatch: requested ${requestedAmount}, verified ${verifiedAmount}`);
            return NextResponse.json(
                { success: false, error: `Deposit amount mismatch. Expected ${requestedAmount} SOL, found ${verifiedAmount.toFixed(6)} SOL` },
                { status: 400 }
            );
        }

        // Verify vault wSOL account exists
        try {
            await getAccount(connection, vaultWsolAta);
        } catch {
            return NextResponse.json(
                { success: false, error: "Vault wSOL account not found" },
                { status: 500 }
            );
        }

        // Setup vault wallet for minting
        if (!process.env.VAULT_SECRET_KEY) {
            return NextResponse.json(
                { success: false, error: "Server configuration error" },
                { status: 500 }
            );
        }

        // Parse secret key - handle both JSON array and comma-separated formats
        let secretKeyArray: number[];
        const keyStr = process.env.VAULT_SECRET_KEY.trim();
        if (keyStr.startsWith('[')) {
            secretKeyArray = JSON.parse(keyStr);
        } else {
            secretKeyArray = keyStr.split(',').map(n => parseInt(n.trim(), 10));
        }
        const secretKey = Uint8Array.from(secretKeyArray);
        const vaultKeypair = Keypair.fromSecretKey(secretKey);
        const vaultWallet = new NodeWallet(vaultKeypair);

        // === MARK DEPOSIT TX AS USED (before minting to prevent double-use) ===
        await sql`
            INSERT INTO used_deposits (tx_signature, wallet, amount, created_at)
            VALUES (${wsolTx}, ${wallet}, ${requestedAmount}, ${Date.now()})
            ON CONFLICT (tx_signature) DO NOTHING
        `.catch(async (e) => {
            // Table might not exist, create it
            if (e.message?.includes('relation "used_deposits" does not exist')) {
                await sql`
                    CREATE TABLE IF NOT EXISTS used_deposits (
                        tx_signature TEXT PRIMARY KEY,
                        wallet TEXT NOT NULL,
                        amount DOUBLE PRECISION NOT NULL,
                        created_at BIGINT NOT NULL
                    )
                `;
                await sql`
                    INSERT INTO used_deposits (tx_signature, wallet, amount, created_at)
                    VALUES (${wsolTx}, ${wallet}, ${requestedAmount}, ${Date.now()})
                `;
            } else {
                throw e;
            }
        });

        // Mint confidential tokens to user
        const program = getProgram(connection, vaultWallet as unknown as AnchorWallet);

        // Encrypt the amount (scaled to 6 decimals)
        const scaledAmount = BigInt(Math.floor(requestedAmount * 1e6));
        const encryptedHex = await encryptValue(scaledAmount);
        const ciphertext = hexToBuffer(encryptedHex);

        const userPubkey = new PublicKey(wallet);
        const userAccountPubkey = new PublicKey(userAccount);

        // Build mint transaction
        const mintAccounts = {
            mint: PROTOCOL_INCO_MINT,
            account: userAccountPubkey,
            mintAuthority: vaultWallet.publicKey,
            systemProgram: SystemProgram.programId,
        };

        // Simulate to get handle for allowance PDA
        const simTx = await program.methods
            .mintTo(ciphertext, 0)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .accounts(mintAccounts as any)
            .transaction();

        simTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        simTx.feePayer = vaultWallet.publicKey;

        const sim = await connection.simulateTransaction(simTx, undefined, [userAccountPubkey]);

        if (sim.value.err) {
            console.error("Simulation error:", sim.value.err);
            return NextResponse.json(
                { success: false, error: "Mint simulation failed" },
                { status: 500 }
            );
        }

        const simData = sim.value.accounts?.[0]?.data;
        if (!simData) {
            return NextResponse.json(
                { success: false, error: "No simulation data" },
                { status: 500 }
            );
        }

        const handle = extractHandle(Buffer.from(simData[0], "base64"));
        const [allowancePda] = getAllowancePda(handle, userPubkey);

        // Execute mint with allowance PDA
        const mintTx = await program.methods
            .mintTo(ciphertext, 0)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .accounts(mintAccounts as any)
            .remainingAccounts([
                { pubkey: allowancePda, isSigner: false, isWritable: true },
                { pubkey: userPubkey, isSigner: false, isWritable: false },
            ])
            .transaction();

        mintTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        mintTx.feePayer = vaultWallet.publicKey;

        // Sign with vault key
        mintTx.sign(vaultKeypair);

        const mintSig = await connection.sendRawTransaction(mintTx.serialize(), {
            skipPreflight: false,
            preflightCommitment: "confirmed",
        });

        await connection.confirmTransaction(mintSig, "confirmed");

        console.log(`[Deposit] Verified ${verifiedAmount} SOL, minted ${requestedAmount} confidential tokens to ${wallet}. TX: ${mintSig}`);

        return NextResponse.json({
            success: true,
            mintTx: mintSig,
            amount: requestedAmount,
            verifiedAmount,
        });

    } catch (e) {
        console.error("Deposit error:", e);
        return NextResponse.json(
            { success: false, error: e instanceof Error ? e.message : "Internal error" },
            { status: 500 }
        );
    }
}
