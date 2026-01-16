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
import { useSolPrice } from "@/hooks/use-sol-price";

export default function DepositSol() {
    const { publicKey, connected, sendTransaction } = useWallet();
    const { connection } = useConnection();
    const wallet = useAnchorWallet();
    const { formatUsd, isLoading: priceLoading } = useSolPrice();

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
            <div className="deposit-connect-prompt">
                <div className="connect-icon">💳</div>
                <p>Connect your wallet to deposit SOL</p>
            </div>
        );
    }

    const inputAmount = parseFloat(amount) || 0;

    return (
        <div className="deposit-section">
            {/* Available Balance Card */}
            <div className="deposit-balance-card">
                <div className="deposit-balance-row">
                    <div className="deposit-balance-left">
                        <span className="deposit-balance-label">Available</span>
                        <div className="deposit-balance-amount">
                            <img
                                src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png"
                                alt="SOL"
                                className="deposit-sol-icon"
                            />
                            <span className="deposit-sol-value">{solBalance.toFixed(4)} SOL</span>
                        </div>
                        {!priceLoading && (
                            <span className="deposit-usd-value">≈ {formatUsd(solBalance)}</span>
                        )}
                    </div>
                </div>
            </div>

            {/* Deposit Input */}
            <div className="deposit-input-section">
                <label className="deposit-input-label">
                    Amount to Deposit
                </label>
                <div className="deposit-input-wrapper">
                    <div className="deposit-input-field">
                        <input
                            type="number"
                            placeholder="0.00"
                            value={amount}
                            onChange={(e) => {
                                setAmount(e.target.value);
                                setError(null);
                                setSuccess(null);
                            }}
                            className="deposit-input"
                            step="0.01"
                            min={MIN_DEPOSIT}
                            max={MAX_DEPOSIT}
                        />
                        <div className="deposit-input-suffix">
                            <img
                                src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png"
                                alt="SOL"
                                className="deposit-input-icon"
                            />
                            <span>SOL</span>
                        </div>
                    </div>
                    <button
                        onClick={() => setAmount(Math.max(0, solBalance - 0.02).toFixed(4))}
                        className="deposit-max-btn"
                    >
                        Max
                    </button>
                </div>
                <div className="deposit-input-meta">
                    <span className="deposit-input-hint">{MIN_DEPOSIT} - {MAX_DEPOSIT} SOL</span>
                    {inputAmount > 0 && !priceLoading && (
                        <span className="deposit-input-usd">≈ {formatUsd(inputAmount)}</span>
                    )}
                </div>
            </div>

            {/* Deposit Button */}
            <button
                onClick={handleDeposit}
                disabled={loading || !amount || parseFloat(amount) <= 0}
                className="deposit-btn"
            >
                {loading ? (
                    <span className="deposit-btn-loading">
                        <span className="deposit-spinner" />
                        {step === "wrapping" ? "Wrapping SOL..."
                            : step === "depositing" ? "Creating confidential balance..."
                                : "Processing..."}
                    </span>
                ) : (
                    <>Deposit{inputAmount > 0 && !priceLoading && ` (${formatUsd(inputAmount)})`}</>
                )}
            </button>

            {/* Info Box */}
            <div className="deposit-info-box">
                <div className="deposit-info-title">How it works</div>
                <div className="deposit-info-steps">
                    <div className="deposit-info-step">
                        <span className="step-number">1</span>
                        <span>Your SOL is wrapped to wSOL</span>
                    </div>
                    <div className="deposit-info-step">
                        <span className="step-number">2</span>
                        <span>wSOL is deposited to protocol vault</span>
                    </div>
                    <div className="deposit-info-step">
                        <span className="step-number">3</span>
                        <span>You receive confidential betting balance</span>
                    </div>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="deposit-error">
                    <span className="error-icon">⚠</span>
                    {error}
                </div>
            )}

            {/* Success */}
            {success && (
                <div className="deposit-success">
                    <span className="success-icon">✓</span>
                    <div className="success-content">
                        <span>{success.message}</span>
                        {success.tx && (
                            <a
                                href={`https://orb.helius.dev/tx/${success.tx}?cluster=devnet`}
                                target="_blank"
                                className="success-link"
                            >
                                View transaction →
                            </a>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

