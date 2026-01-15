"use client";

import { useState, useEffect } from "react";
import {
    useWallet,
    useConnection,
    useAnchorWallet,
} from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, SystemProgram, Transaction, Keypair, PublicKey } from "@solana/web3.js";
import { encryptValue } from "@inco/solana-sdk/encryption";
import { hexToBuffer } from "@inco/solana-sdk/utils";
import { createWrapSolTransaction, getWsolBalance } from "@/lib/wsol";
import {
    PROTOCOL_VAULT,
    MIN_DEPOSIT,
    MAX_DEPOSIT,
    PROTOCOL_INCO_MINT
} from "@/lib/protocol";
import {
    fetchUserTokenAccount,
    getAllowancePda,
    extractHandle,
    getProgram,
} from "@/utils/constants";

export default function DepositSol() {
    const { publicKey, connected, sendTransaction } = useWallet();
    const { connection } = useConnection();
    const wallet = useAnchorWallet();

    const [solBalance, setSolBalance] = useState<number>(0);
    const [wsolBalance, setWsolBalance] = useState<number>(0);
    const [amount, setAmount] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<{ message: string; tx?: string } | null>(null);
    const [step, setStep] = useState<"idle" | "wrapping" | "depositing">("idle");

    // Fetch balances
    useEffect(() => {
        if (!publicKey || !connection) {
            setSolBalance(0);
            setWsolBalance(0);
            return;
        }

        const fetchBalances = async () => {
            try {
                const sol = await connection.getBalance(publicKey);
                setSolBalance(sol / LAMPORTS_PER_SOL);

                const wsol = await getWsolBalance(connection, publicKey);
                setWsolBalance(wsol);
            } catch (e) {
                console.error("Error fetching balances:", e);
            }
        };

        fetchBalances();
        const interval = setInterval(fetchBalances, 10000);
        return () => clearInterval(interval);
    }, [publicKey, connection]);

    const handleDeposit = async () => {
        if (!publicKey || !wallet || !amount) return;

        const depositAmount = parseFloat(amount);
        if (isNaN(depositAmount) || depositAmount <= 0) {
            setError("Enter a valid amount");
            return;
        }

        if (depositAmount < MIN_DEPOSIT) {
            setError(`Minimum deposit is ${MIN_DEPOSIT} SOL`);
            return;
        }

        if (depositAmount > MAX_DEPOSIT) {
            setError(`Maximum deposit is ${MAX_DEPOSIT} SOL`);
            return;
        }

        if (depositAmount > solBalance - 0.01) {
            setError("Insufficient SOL (need to keep ~0.01 for fees)");
            return;
        }

        setLoading(true);
        setError(null);
        setSuccess(null);

        try {
            // Step 1: Wrap SOL → wSOL
            setStep("wrapping");
            const { transaction: wrapTx, wsolAta } = await createWrapSolTransaction(
                connection,
                publicKey,
                depositAmount
            );

            const wrapSig = await sendTransaction(wrapTx, connection);
            await connection.confirmTransaction(wrapSig, "confirmed");

            // Step 2: Deposit wSOL to protocol vault and get confidential tokens
            setStep("depositing");

            const program = getProgram(connection, wallet);

            // Check if user has Inco account for the protocol mint, create if not
            let userIncoAccount = await fetchUserTokenAccount(
                connection,
                publicKey,
                PROTOCOL_INCO_MINT
            );

            const signers: Keypair[] = [];
            const setupTx = new Transaction();
            let accountPubkey: PublicKey;

            if (!userIncoAccount) {
                // Create user's Inco account for protocol mint
                const accountKp = Keypair.generate();
                accountPubkey = accountKp.publicKey;
                signers.push(accountKp);

                setupTx.add(
                    await program.methods
                        .initializeAccount()
                        .accounts({
                            account: accountKp.publicKey,
                            mint: PROTOCOL_INCO_MINT,
                            owner: publicKey,
                            payer: publicKey,
                            systemProgram: SystemProgram.programId,
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        } as any)
                        .instruction()
                );

                setupTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
                setupTx.feePayer = publicKey;
                if (signers.length > 0) {
                    setupTx.partialSign(...signers);
                }

                const setupSig = await sendTransaction(setupTx, connection);
                await connection.confirmTransaction(setupSig, "confirmed");
                await new Promise(r => setTimeout(r, 1000));
            } else {
                accountPubkey = userIncoAccount.pubkey;
            }

            // Transfer wSOL to vault (simple SPL transfer for now)
            // The vault will credit confidential tokens via backend
            const { getAssociatedTokenAddress, createTransferInstruction, NATIVE_MINT } = await import("@solana/spl-token");

            const userWsolAta = await getAssociatedTokenAddress(NATIVE_MINT, publicKey);
            const vaultWsolAta = await getAssociatedTokenAddress(NATIVE_MINT, PROTOCOL_VAULT);

            // Check if vault wSOL ATA exists (it should be pre-created)
            const vaultAtaInfo = await connection.getAccountInfo(vaultWsolAta);

            const transferTx = new Transaction();

            if (!vaultAtaInfo) {
                // Create vault's wSOL ATA if it doesn't exist (one-time)
                const { createAssociatedTokenAccountInstruction } = await import("@solana/spl-token");
                transferTx.add(
                    createAssociatedTokenAccountInstruction(
                        publicKey,
                        vaultWsolAta,
                        PROTOCOL_VAULT,
                        NATIVE_MINT
                    )
                );
            }

            transferTx.add(
                createTransferInstruction(
                    userWsolAta,
                    vaultWsolAta,
                    publicKey,
                    Math.floor(depositAmount * LAMPORTS_PER_SOL)
                )
            );

            transferTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
            transferTx.feePayer = publicKey;

            const transferSig = await sendTransaction(transferTx, connection);
            await connection.confirmTransaction(transferSig, "confirmed");

            // Step 3: Request vault to mint confidential tokens (via API)
            const mintResponse = await fetch("/api/deposit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    wallet: publicKey.toBase58(),
                    amount: depositAmount,
                    wsolTx: transferSig,
                    userAccount: accountPubkey.toBase58(),
                }),
            });

            const mintResult = await mintResponse.json();

            if (!mintResult.success) {
                throw new Error(mintResult.error || "Failed to mint confidential tokens");
            }

            setSuccess({
                message: `Deposited ${depositAmount} SOL → Confidential balance`,
                tx: mintResult.mintTx || transferSig,
            });
            setAmount("");

            // Trigger balance refresh
            window.dispatchEvent(new CustomEvent("token-minted"));

        } catch (e) {
            console.error("Deposit error:", e);
            setError(e instanceof Error ? e.message : "Deposit failed");
        } finally {
            setLoading(false);
            setStep("idle");
        }
    };

    if (!connected) {
        return (
            <div className="mt-8 text-center text-[var(--muted)]">
                Connect wallet to deposit SOL
            </div>
        );
    }

    return (
        <div className="mt-8 space-y-6">
            {/* Balance Display */}
            <div className="flex items-center justify-between text-sm p-3 bg-[var(--surface)] rounded-xl">
                <div>
                    <span className="text-[var(--muted)]">Available SOL</span>
                    <div className="text-lg font-semibold">{solBalance.toFixed(4)} SOL</div>
                </div>
                {wsolBalance > 0 && (
                    <div className="text-right">
                        <span className="text-[var(--muted)]">wSOL Balance</span>
                        <div className="text-lg font-semibold">{wsolBalance.toFixed(4)} wSOL</div>
                    </div>
                )}
            </div>

            {/* Deposit Input */}
            <div>
                <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">
                    Amount to Deposit (SOL)
                </label>
                <div className="flex gap-2">
                    <input
                        type="number"
                        placeholder={`${MIN_DEPOSIT} - ${MAX_DEPOSIT} SOL`}
                        value={amount}
                        onChange={(e) => {
                            setAmount(e.target.value);
                            setError(null);
                            setSuccess(null);
                        }}
                        className="flex-1 p-3 border border-[var(--border-subtle)] rounded-xl bg-[var(--background)] text-[var(--foreground)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                        step="0.01"
                        min={MIN_DEPOSIT}
                        max={MAX_DEPOSIT}
                    />
                    <button
                        onClick={() => setAmount((solBalance - 0.02).toFixed(4))}
                        className="px-4 py-3 bg-[var(--surface)] text-[var(--text-secondary)] rounded-xl hover:bg-[var(--surface-hover)] text-sm font-medium transition-colors"
                    >
                        Max
                    </button>
                </div>
            </div>

            {/* Deposit Button */}
            <button
                onClick={handleDeposit}
                disabled={loading || !amount || parseFloat(amount) <= 0}
                className="w-full bg-[var(--accent)] text-white py-3 px-4 rounded-xl hover:bg-[var(--accent-hover)] disabled:bg-[var(--surface-hover)] disabled:text-[var(--muted)] disabled:cursor-not-allowed font-semibold transition-colors"
            >
                {loading ? (
                    step === "wrapping" ? "Wrapping SOL..."
                        : step === "depositing" ? "Creating confidential balance..."
                            : "Processing..."
                ) : (
                    "Deposit SOL"
                )}
            </button>

            {/* Info Box */}
            <div className="text-xs text-[var(--muted)] p-3 bg-[var(--surface)] rounded-xl">
                <p className="font-medium mb-1">How it works:</p>
                <ol className="list-decimal list-inside space-y-1">
                    <li>Your SOL is wrapped to wSOL</li>
                    <li>wSOL is deposited to protocol vault</li>
                    <li>You receive confidential betting balance</li>
                </ol>
            </div>

            {/* Error */}
            {error && (
                <p className="text-sm text-[var(--danger)] bg-[var(--danger-bg)] border border-[var(--danger)] p-3 rounded-xl">
                    {error}
                </p>
            )}

            {/* Success */}
            {success && (
                <div className="bg-[var(--success-bg)] border border-[var(--success)] p-3 rounded-xl">
                    <p className="text-sm text-[var(--success)]">
                        ✅ {success.message}
                        {success.tx && (
                            <>
                                {" "}
                                <a
                                    href={`https://orb.helius.dev/tx/${success.tx}?cluster=devnet`}
                                    target="_blank"
                                    className="underline hover:text-white"
                                >
                                    View tx
                                </a>
                            </>
                        )}
                    </p>
                </div>
            )}
        </div>
    );
}
