"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect, useRef } from "react";
import {
    useWallet,
    useConnection,
    useAnchorWallet,
} from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { simpleTransfer } from "@/lib/confidential-transfer";
import { fetchUserMint, fetchUserTokenAccount } from "@/utils/constants";

export default function Transfer() {
    const { publicKey, connected, sendTransaction } = useWallet();
    const { connection } = useConnection();
    const wallet = useAnchorWallet();
    const lastWallet = useRef<string | null>(null);

    const [mint, setMint] = useState<string | null>(null);
    const [hasAccount, setHasAccount] = useState(false);
    const [recipient, setRecipient] = useState("");
    const [amount, setAmount] = useState("");
    const [txHash, setTxHash] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch user's mint and account
    useEffect(() => {
        const key = publicKey?.toBase58() ?? null;
        if (key === lastWallet.current) return;
        lastWallet.current = key;
        setMint(null);
        setHasAccount(false);
        if (!key) return;

        (async () => {
            const m = await fetchUserMint(connection, publicKey!);
            if (m) {
                setMint(m.pubkey.toBase58());
                const a = await fetchUserTokenAccount(connection, publicKey!, m.pubkey);
                setHasAccount(!!a);
            }
        })();
    }, [publicKey, connection]);

    // Listen for token minted events to refresh state
    useEffect(() => {
        const handleMint = () => {
            if (publicKey) {
                fetchUserMint(connection, publicKey).then((m) => {
                    if (m) {
                        setMint(m.pubkey.toBase58());
                        fetchUserTokenAccount(connection, publicKey, m.pubkey).then((a) =>
                            setHasAccount(!!a)
                        );
                    }
                });
            }
        };
        window.addEventListener("token-minted", handleMint);
        return () => window.removeEventListener("token-minted", handleMint);
    }, [publicKey, connection]);

    const validateAddress = (addr: string): boolean => {
        try {
            new PublicKey(addr);
            return true;
        } catch {
            return false;
        }
    };

    const handleTransfer = async () => {
        if (!publicKey || !wallet || !mint) {
            setError("Wallet not connected or no mint found");
            return;
        }

        if (!recipient || !validateAddress(recipient)) {
            setError("Please enter a valid recipient address");
            return;
        }

        const numAmount = parseFloat(amount);
        if (isNaN(numAmount) || numAmount <= 0) {
            setError("Please enter a valid amount");
            return;
        }

        setLoading(true);
        setError(null);
        setTxHash(null);

        try {
            const result = await simpleTransfer(
                connection,
                wallet,
                sendTransaction,
                recipient,
                numAmount,
                mint
            );

            if (result.success) {
                setTxHash(result.signature);
                setRecipient("");
                setAmount("");
                // Refresh balance
                window.dispatchEvent(new CustomEvent("token-minted"));
            } else {
                setError(result.error || "Transfer failed");
            }
        } catch (e: any) {
            console.error("Transfer error:", e);
            setError(e.message || "Transfer failed");
        }

        setLoading(false);
    };

    if (!connected) {
        return (
            <div className="mt-8 p-6 bg-[var(--background)] rounded-xl border border-[var(--border-subtle)] text-center text-[var(--muted)]">
                Connect your wallet to transfer confidential tokens
            </div>
        );
    }

    if (!hasAccount) {
        return (
            <div className="mt-8 p-6 bg-[var(--background)] rounded-xl border border-[var(--border-subtle)] text-center text-[var(--muted)]">
                Mint some tokens first before you can transfer
            </div>
        );
    }

    return (
        <div className="mt-6 space-y-6">
            <div>
                <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">
                    Recipient Address
                </label>
                <input
                    type="text"
                    placeholder="Enter recipient wallet address..."
                    value={recipient}
                    onChange={(e) => {
                        setRecipient(e.target.value);
                        setError(null);
                        setTxHash(null);
                    }}
                    className="w-full p-3 border border-[var(--border-subtle)] rounded-xl bg-[var(--background)] text-[var(--foreground)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
            </div>

            <div>
                <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">Amount</label>
                <input
                    type="number"
                    placeholder="Enter amount..."
                    value={amount}
                    onChange={(e) => {
                        setAmount(e.target.value);
                        setError(null);
                        setTxHash(null);
                    }}
                    className="w-full p-3 border border-[var(--border-subtle)] rounded-xl bg-[var(--background)] text-[var(--foreground)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                    step="0.000001"
                    min="0"
                />
            </div>

            <button
                onClick={handleTransfer}
                disabled={loading || !recipient || !amount}
                className="w-full bg-[var(--accent)] text-white py-3 px-4 rounded-xl hover:bg-[var(--accent-hover)] disabled:bg-[var(--surface-hover)] disabled:text-[var(--muted)] disabled:cursor-not-allowed transition-colors font-semibold"
            >
                {loading ? (
                    <span className="flex items-center justify-center">
                        <svg
                            className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                        >
                            <circle
                                className="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="4"
                            />
                            <path
                                className="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            />
                        </svg>
                        Processing Transfer...
                    </span>
                ) : (
                    "Confirm Transfer"
                )}
            </button>

            {error && (
                <div className="bg-[var(--danger-bg)] border border-[var(--danger)] p-3 rounded-xl">
                    <p className="text-sm text-[var(--danger)]">❌ {error}</p>
                </div>
            )}

            {txHash && (
                <div className="bg-[var(--success-bg)] border border-[var(--success)] p-3 rounded-xl">
                    <p className="text-sm text-[var(--success)]">
                        ✅ Transfer successful!{" "}
                        <a
                            href={`https://orb.helius.dev/tx/${txHash}?cluster=devnet`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:text-white"
                        >
                            View transaction
                        </a>
                    </p>
                </div>
            )}

            {mint && (
                <div className="mt-4 p-3 bg-[var(--background)] rounded-xl border border-[var(--border-subtle)]">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-bold mb-1">Current Mint Address</p>
                    <p className="text-xs text-[var(--text-secondary)] font-mono break-all selection:bg-[var(--accent)] selection:text-white">
                        {mint}
                    </p>
                </div>
            )}
        </div>
    );
}
