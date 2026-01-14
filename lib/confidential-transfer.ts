/**
 * Confidential Token Transfer Library
 * Simple integration for transferring Inco confidential tokens using the IDL
 */

import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { Program, AnchorProvider, Idl } from "@coral-xyz/anchor";
import { AnchorWallet } from "@solana/wallet-adapter-react";
import { encryptValue } from "@inco/solana-sdk/encryption";
import { hexToBuffer } from "@inco/solana-sdk/utils";
import {
    PROGRAM_ID,
    INCO_LIGHTNING_PROGRAM_ID,
    getAllowancePda,
    extractHandle,
    fetchUserTokenAccount,
} from "@/utils/constants";
import idl from "@/utils/idl.json";

export interface TransferParams {
    /** Amount to transfer (will be encrypted) */
    amount: number;
    /** Destination wallet public key */
    destinationWallet: PublicKey;
    /** Destination token account public key */
    destinationTokenAccount: PublicKey;
    /** Mint public key */
    mint: PublicKey;
}

export interface TransferResult {
    signature: string;
    success: boolean;
    error?: string;
}

/**
 * Get Anchor Program instance for Inco Token
 */
export const getIncoProgram = (connection: Connection, wallet: AnchorWallet): Program => {
    const provider = new AnchorProvider(connection, wallet, {
        commitment: "confirmed",
    });
    return new Program(idl as Idl, provider);
};

/**
 * Encrypt an amount for confidential transfer
 * @param amount - Amount to encrypt (will be multiplied by 1e6 for 6 decimals)
 * @returns Encrypted ciphertext as hex string
 */
export const encryptAmount = async (amount: number): Promise<string> => {
    const scaledAmount = BigInt(Math.floor(amount * 1e6));
    return await encryptValue(scaledAmount);
};

/**
 * Get or fetch the handle from a token account for PDA derivation
 */
export const getHandleFromAccount = async (
    connection: Connection,
    tokenAccount: PublicKey
): Promise<bigint> => {
    const accountInfo = await connection.getAccountInfo(tokenAccount);
    if (!accountInfo) {
        throw new Error("Token account not found");
    }
    return extractHandle(accountInfo.data as Buffer);
};

/**
 * Transfer confidential tokens
 * 
 * @param connection - Solana connection
 * @param wallet - Anchor wallet
 * @param sendTransaction - Wallet adapter's sendTransaction function
 * @param params - Transfer parameters
 * @returns TransferResult with signature or error
 */
export const transferConfidentialTokens = async (
    connection: Connection,
    wallet: AnchorWallet,
    sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>,
    params: TransferParams
): Promise<TransferResult> => {
    const { amount, destinationWallet, destinationTokenAccount, mint } = params;

    try {
        // 1. Get program
        const program = getIncoProgram(connection, wallet);

        // 2. Find source token account
        const sourceAccount = await fetchUserTokenAccount(connection, wallet.publicKey, mint);
        if (!sourceAccount) {
            throw new Error("Source token account not found. Please mint tokens first.");
        }

        // 3. Encrypt the amount
        const encryptedHex = await encryptAmount(amount);
        const ciphertext = hexToBuffer(encryptedHex);

        // 4. Build transaction for simulation
        const simTx = await program.methods
            .transfer(ciphertext, 0)
            .accounts({
                source: sourceAccount.pubkey,
                destination: destinationTokenAccount,
                authority: wallet.publicKey,
                incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any)
            .transaction();

        simTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        simTx.feePayer = wallet.publicKey;

        // 5. Simulate with both accounts to get handles from post-state
        const sim = await connection.simulateTransaction(simTx, undefined, [
            sourceAccount.pubkey,
            destinationTokenAccount,
        ]);

        if (sim.value.err) {
            console.warn("Simulation warning:", sim.value.err);
        }

        // 6. Extract handles from simulation results
        const simAccounts = sim.value.accounts;
        if (!simAccounts || simAccounts.length < 2) {
            throw new Error("Simulation did not return expected account data");
        }

        const sourceData = simAccounts[0]?.data;
        const destData = simAccounts[1]?.data;

        if (!sourceData || !destData) {
            throw new Error("Missing account data from simulation");
        }

        // Decode base64 data and extract handles
        const sourceBuffer = Buffer.from(sourceData[0], "base64");
        const destBuffer = Buffer.from(destData[0], "base64");

        const sourceHandle = extractHandle(sourceBuffer);
        const destHandle = extractHandle(destBuffer);

        // 7. Derive allowance PDAs using simulated handles
        const [sourceAllowancePda] = getAllowancePda(sourceHandle, wallet.publicKey);
        const [destAllowancePda] = getAllowancePda(destHandle, destinationWallet);

        // 8. Build and send the transfer transaction with remaining accounts
        const signature = await program.methods
            .transfer(ciphertext, 0)
            .accounts({
                source: sourceAccount.pubkey,
                destination: destinationTokenAccount,
                authority: wallet.publicKey,
                incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any)
            .remainingAccounts([
                { pubkey: sourceAllowancePda, isSigner: false, isWritable: true },
                { pubkey: wallet.publicKey, isSigner: false, isWritable: false },
                { pubkey: destAllowancePda, isSigner: false, isWritable: true },
                { pubkey: destinationWallet, isSigner: false, isWritable: false },
            ])
            .rpc();

        return {
            signature,
            success: true,
        };
    } catch (error) {
        console.error("Transfer error:", error);
        return {
            signature: "",
            success: false,
            error: error instanceof Error ? error.message : "Transfer failed",
        };
    }
};

/**
 * Simple transfer helper that creates token account if needed
 * This is a higher-level function for easier integration
 */
export const simpleTransfer = async (
    connection: Connection,
    wallet: AnchorWallet,
    sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>,
    destinationWallet: string,
    amount: number,
    mint: string
): Promise<TransferResult> => {
    const destinationPubkey = new PublicKey(destinationWallet);
    const mintPubkey = new PublicKey(mint);
    const program = getIncoProgram(connection, wallet);

    try {
        // Find destination token account
        let destTokenAccount = await fetchUserTokenAccount(connection, destinationPubkey, mintPubkey);

        // If destination doesn't have a token account, create one for them
        if (!destTokenAccount) {
            const { Keypair } = await import("@solana/web3.js");
            const destAccountKp = Keypair.generate();

            const createAccountTx = new Transaction();
            createAccountTx.add(
                await program.methods
                    .initializeAccount()
                    .accounts({
                        account: destAccountKp.publicKey,
                        mint: mintPubkey,
                        owner: destinationPubkey,
                        payer: wallet.publicKey,
                        systemProgram: SystemProgram.programId,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    } as any)
                    .instruction()
            );

            createAccountTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
            createAccountTx.feePayer = wallet.publicKey;
            createAccountTx.partialSign(destAccountKp);

            const createSig = await sendTransaction(createAccountTx, connection);
            await connection.confirmTransaction(createSig, "confirmed");

            // Wait a bit for account to be available
            await new Promise((r) => setTimeout(r, 1000));

            // Now fetch the newly created account
            destTokenAccount = {
                pubkey: destAccountKp.publicKey,
                data: (await connection.getAccountInfo(destAccountKp.publicKey))?.data as Buffer,
            };

            if (!destTokenAccount.data) {
                throw new Error("Failed to create destination token account");
            }
        }

        return transferConfidentialTokens(connection, wallet, sendTransaction, {
            amount,
            destinationWallet: destinationPubkey,
            destinationTokenAccount: destTokenAccount.pubkey,
            mint: mintPubkey,
        });
    } catch (error) {
        console.error("Simple transfer error:", error);
        return {
            signature: "",
            success: false,
            error: error instanceof Error ? error.message : "Transfer failed",
        };
    }
};

