"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import Header from "@/components/header";
import Padder from "@/components/padder";
import {
    fetchUserBets,
    Bet,
    refreshBetStatuses,
    claimBet,
    ClaimResult,
    clearLostBets,
    checkClaimable, // Use this helper
    calculateClaimAmount
} from "@/lib/confidential-betting";
import { deleteBet } from "@/app/actions";
import { fetchMarket } from "@/lib/jup-predict";
import Link from "next/link";
import { PROTOCOL_FEE } from "@/lib/protocol";

// Convert decimal odds to American format
const toAmericanOdds = (decimal: number): string => {
    if (decimal >= 2) {
        return `+${Math.round((decimal - 1) * 100)}`;
    } else {
        return `${Math.round(-100 / (decimal - 1))}`;
    }
};

export default function PortfolioPage() {
    const { publicKey, connected } = useWallet();
    const [bets, setBets] = useState<Bet[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const [claimingTx, setClaimingTx] = useState<string | null>(null);
    const [deletingTx, setDeletingTx] = useState<string | null>(null);
    const [claimResult, setClaimResult] = useState<{ tx: string; result: ClaimResult } | null>(null);

    // Track claimable status for pending bets
    const [claimableStatus, setClaimableStatus] = useState<Record<string, boolean>>({});

    useEffect(() => {
        const loadBets = async () => {
            if (!publicKey) {
                setBets([]);
                return;
            }
            const userBets = await fetchUserBets(publicKey.toBase58());
            setBets(userBets.sort((a, b) => b.timestamp - a.timestamp));

            // Background check for claimability on pending bets
            checkPendingClaimability(userBets);
        };
        loadBets();
    }, [publicKey]);

    const checkPendingClaimability = async (currentBets: Bet[]) => {
        const pending = currentBets.filter(b => b.status === 'pending');
        const statuses: Record<string, boolean> = {};

        for (const bet of pending) {
            try {
                const check = await checkClaimable(bet);
                if (check.claimable) {
                    statuses[bet.tx] = true;
                }
            } catch (e) {
                // Ignore errors during background check
            }
        }

        setClaimableStatus(prev => ({ ...prev, ...statuses }));
    };

    const handleRefresh = async () => {
        if (!publicKey || refreshing) return;
        setRefreshing(true);
        try {
            const updated = await refreshBetStatuses(publicKey.toBase58());
            setBets(updated.sort((a, b) => b.timestamp - a.timestamp));
            await checkPendingClaimability(updated);
        } catch (e) {
            console.error("Failed to refresh:", e);
        }
        setRefreshing(false);
    };

    const handleClearLost = async () => {
        if (!publicKey) return;
        if (confirm("Are you sure you want to clear all lost bets from your history?")) {
            await clearLostBets(publicKey.toBase58());
            const userBets = await fetchUserBets(publicKey.toBase58());
            setBets(userBets.sort((a, b) => b.timestamp - a.timestamp));
        }
    };

    const handleDelete = async (tx: string) => {
        if (!publicKey || deletingTx) return;
        if (!confirm("Delete this bet from your history?")) return;

        setDeletingTx(tx);
        try {
            const result = await deleteBet(tx, publicKey.toBase58());
            if (result.success) {
                setBets(prev => prev.filter(b => b.tx !== tx));
            } else {
                console.error("Delete failed:", result.error);
            }
        } catch (e) {
            console.error("Delete error:", e);
        }
        setDeletingTx(null);
    };

    const handleClaim = async (bet: Bet) => {
        if (claimingTx || bet.claimed) return;

        setClaimingTx(bet.tx);
        setClaimResult(null);

        try {
            // Fetch fresh market data to get result
            const market = await fetchMarket(bet.marketId);

            if (market.status !== "closed" || !market.result) {
                setClaimResult({
                    tx: bet.tx,
                    result: { success: false, error: "Market not yet resolved" }
                });
                setClaimingTx(null);
                return;
            }

            const result = await claimBet(bet, market.result as "yes" | "no");
            setClaimResult({ tx: bet.tx, result });

            // Refresh bets list to show claimed status
            if (result.success && publicKey) {
                const updated = await fetchUserBets(publicKey.toBase58());
                setBets(updated.sort((a, b) => b.timestamp - a.timestamp));
                // Clear from claimable status if successful
                setClaimableStatus(prev => {
                    const next = { ...prev };
                    delete next[bet.tx];
                    return next;
                });
            }
        } catch (e) {
            console.error("Claim failed:", e);
            setClaimResult({
                tx: bet.tx,
                result: { success: false, error: "Claim failed" }
            });
        }

        setClaimingTx(null);
    };

    const formatDate = (ts: number) =>
        new Date(ts).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
        });

    const getStatusClass = (bet: Bet) => {
        if (bet.claimed) return "claimed";
        if (bet.status === "won" || claimableStatus[bet.tx]) return "won";
        if (bet.status === "lost") return "lost";
        return "pending";
    };

    const getStatusLabel = (bet: Bet) => {
        if (bet.claimed) return "Claimed ✓";
        if (bet.status === "won") return "Won 🎉";
        if (claimableStatus[bet.tx]) return "Ready to Claim! 🎉";
        if (bet.status === "lost") return "Lost";
        return "Active";
    };

    return (
        <Padder>
            <Header />
            <div className="header-separator" />

            <div className="portfolio-container">
                <div className="portfolio-page-header">
                    <div>
                        <h1 className="page-title">Portfolio</h1>
                        <p className="page-subtitle">{bets.length} bet{bets.length !== 1 ? "s" : ""}</p>
                    </div>
                    <div className="portfolio-header-actions">
                        {connected && bets.some(b => b.status === "lost") && (
                            <button
                                onClick={handleClearLost}
                                className="portfolio-action-btn secondary"
                            >
                                Clear Lost
                            </button>
                        )}
                        {connected && bets.length > 0 && (
                            <button
                                onClick={handleRefresh}
                                disabled={refreshing}
                                className="portfolio-action-btn"
                            >
                                <span className={refreshing ? "spinning" : ""}>↻</span>
                                {refreshing ? "Refreshing..." : "Refresh"}
                            </button>
                        )}
                    </div>
                </div>

                {!connected ? (
                    <div className="portfolio-empty-state">
                        <div className="empty-state-icon-wrapper">
                            <span className="empty-icon">🔒</span>
                        </div>
                        <h3 className="empty-state-title">Connect Wallet</h3>
                        <p className="empty-state-desc">Connect your wallet to view your confidential bets</p>
                    </div>
                ) : bets.length === 0 ? (
                    <div className="portfolio-empty-state">
                        <div className="empty-state-icon-wrapper">
                        </div>
                        <h3 className="empty-state-title">No Bets Yet</h3>
                        <p className="empty-state-desc">Place your first confidential bet to get started</p>
                        <Link href="/" className="empty-state-cta">
                            Browse Markets
                        </Link>
                    </div>
                ) : (
                    <div className="portfolio-grid">
                        {bets.map((bet, i) => {
                            // Determine display name for the pick
                            // For team bets (multi-outcome), show team name
                            // For binary (YES/NO) bets, show YES or NO
                            const pickDisplay = bet.teamName || bet.outcome.toUpperCase();
                            const isTeamBet = !!bet.teamName;
                            const isClaimable = (bet.status === "won" && !bet.claimed) || claimableStatus[bet.tx];

                            return (
                                <div
                                    key={`${bet.tx}-${i}`}
                                    className={`portfolio-card ${isClaimable ? "claimable" : ""}`}
                                >
                                    {bet.imageUrl && (
                                        <div className="portfolio-card-image">
                                            <img src={bet.imageUrl} alt="" />
                                        </div>
                                    )}
                                    <div className="portfolio-card-content">
                                        {/* Market Title */}
                                        <div className="portfolio-card-title">
                                            {bet.marketTitle}
                                        </div>

                                        {/* Status Badge */}
                                        <div className={`portfolio-card-status ${getStatusClass(bet)}`}>
                                            {getStatusLabel(bet)}
                                        </div>

                                        {/* Pick Display: Team Name or YES/NO with Odds */}
                                        <div className="portfolio-card-pick">
                                            <span className={`portfolio-card-outcome ${isTeamBet ? 'team' : bet.outcome}`}>
                                                {pickDisplay}
                                            </span>
                                            {bet.odds && (
                                                <span className="portfolio-card-odds">{toAmericanOdds(bet.odds)}</span>
                                            )}
                                        </div>

                                        {/* Date */}
                                        <div className="portfolio-card-date">
                                            {formatDate(bet.timestamp)}
                                        </div>

                                        {/* Claim button for winners or detected claimable bets */}
                                        {isClaimable && !bet.claimed && (
                                            <button
                                                className="claim-btn"
                                                onClick={() => handleClaim(bet)}
                                                disabled={claimingTx === bet.tx}
                                            >
                                                {claimingTx === bet.tx ? (
                                                    <>
                                                        <span className="claim-spinner" />
                                                        Generating ZK Proof...
                                                    </>
                                                ) : (
                                                    <>🎫 Claim Winnings</>
                                                )}
                                            </button>
                                        )}

                                        {/* Show result message if this bet was just acted on */}
                                        {claimResult && claimResult.tx === bet.tx && (
                                            <div className={`claim-result ${claimResult.result.success ? 'success' : 'error'}`}>
                                                {claimResult.result.success ?
                                                    `✓ Payout: ${claimResult.result.claimAmount?.toFixed(4)} SOL` :
                                                    `⚠ ${claimResult.result.error}`
                                                }
                                            </div>
                                        )}

                                        {/* View on explorer link and delete */}
                                        <div className="portfolio-card-actions">
                                            <a
                                                href={`https://solscan.io/tx/${bet.tx}?cluster=devnet`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="portfolio-card-link"
                                            >
                                                View on Solscan →
                                            </a>
                                            <button
                                                onClick={() => handleDelete(bet.tx)}
                                                disabled={deletingTx === bet.tx}
                                                title="Delete bet"
                                                className="portfolio-card-delete"
                                            >
                                                {deletingTx === bet.tx ? '⏳' : '🗑️'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                <div className="info-notice">
                    <p>🔐 Bet amounts are encrypted on-chain • Use zk-proofs for payout claims</p>
                </div>
            </div>
        </Padder>
    );
}

