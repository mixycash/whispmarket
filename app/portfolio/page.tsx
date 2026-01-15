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
    clearLostBets
} from "@/lib/confidential-betting";
import { fetchMarket } from "@/lib/jup-predict";
import Link from "next/link";

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
    const [claimResult, setClaimResult] = useState<{ tx: string; result: ClaimResult } | null>(null);

    useEffect(() => {
        const loadBets = async () => {
            if (!publicKey) {
                setBets([]);
                return;
            }
            const userBets = await fetchUserBets(publicKey.toBase58());
            setBets(userBets.sort((a, b) => b.timestamp - a.timestamp));
        };
        loadBets();
    }, [publicKey]);

    const handleRefresh = async () => {
        if (!publicKey || refreshing) return;
        setRefreshing(true);
        try {
            const updated = await refreshBetStatuses(publicKey.toBase58());
            setBets(updated.sort((a, b) => b.timestamp - a.timestamp));
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

    const handleClaim = async (bet: Bet) => {
        if (claimingTx || bet.status !== "won" || bet.claimed) return;

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

    const getStatusClass = (status?: string, claimed?: boolean) => {
        if (claimed) return "claimed";
        if (status === "won") return "won";
        if (status === "lost") return "lost";
        return "pending";
    };

    const getStatusLabel = (status?: string, claimed?: boolean) => {
        if (claimed) return "Claimed ✓";
        if (status === "won") return "Won 🎉";
        if (status === "lost") return "Lost";
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
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        {connected && bets.some(b => b.status === "lost") && (
                            <button
                                onClick={handleClearLost}
                                style={{
                                    backgroundColor: 'transparent',
                                    border: '1px solid #444',
                                    color: '#aaa',
                                    padding: '6px 12px',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontSize: '0.85rem'
                                }}
                            >
                                Clear Lost
                            </button>
                        )}
                        {connected && bets.length > 0 && (
                            <button onClick={handleRefresh} disabled={refreshing} className="refresh-btn">
                                {refreshing ? "⟳" : "↻"}
                            </button>
                        )}
                    </div>
                </div>

                {!connected ? (
                    <div className="empty-state">
                        <div className="empty-state-icon">🔒</div>
                        <h3 className="empty-state-title">Connect Wallet</h3>
                        <p className="empty-state-desc">Connect your wallet to view your bets</p>
                    </div>
                ) : bets.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-state-icon">📊</div>
                        <h3 className="empty-state-title">No Bets Yet</h3>
                        <p className="empty-state-desc">Place your first confidential bet</p>
                        <Link href="/" className="empty-state-btn">Browse Markets</Link>
                    </div>
                ) : (
                    <div className="portfolio-grid">
                        {bets.map((bet, i) => (
                            <div
                                key={`${bet.tx}-${i}`}
                                className={`portfolio-card ${bet.status === "won" && !bet.claimed ? "claimable" : ""}`}
                            >
                                {bet.imageUrl && (
                                    <div className="portfolio-card-image">
                                        <img src={bet.imageUrl} alt="" />
                                    </div>
                                )}
                                <div className="portfolio-card-content">
                                    <div style={{ marginBottom: '4px', fontWeight: 'bold', fontSize: '1.1rem' }}>
                                        {bet.marketTitle}
                                    </div>
                                    <div className={`portfolio-card-status ${getStatusClass(bet.status, bet.claimed)}`} style={{ display: 'inline-block', marginBottom: '8px' }}>
                                        {getStatusLabel(bet.status, bet.claimed)}
                                    </div>
                                    <div className="portfolio-card-pick" style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span className={`portfolio-card-outcome ${bet.outcome}`} style={{ fontWeight: 'bold' }}>
                                            {bet.outcome.toUpperCase()}
                                        </span>
                                        {bet.odds && (
                                            <span className="portfolio-card-odds" style={{ color: '#aaa' }}>{toAmericanOdds(bet.odds)}</span>
                                        )}
                                    </div>
                                    <div className="portfolio-card-date" style={{ color: '#888', fontSize: '0.9rem', marginBottom: '8px' }}>
                                        {formatDate(bet.timestamp)}
                                    </div>
                                    {/* Claim button for winners */}
                                    {bet.status === "won" && !bet.claimed && (
                                        <button
                                            className="claim-btn"
                                            onClick={() => handleClaim(bet)}
                                            disabled={claimingTx === bet.tx}
                                            style={{ width: '100%', marginBottom: '8px' }}
                                        >
                                            {claimingTx === bet.tx ? (
                                                <>⏳ Generating ZK Proof...</>
                                            ) : (
                                                <>🎫 Claim Winnings</>
                                            )}
                                        </button>
                                    )}

                                    {/* View on explorer link */}
                                    <a
                                        href={`https://solscan.io/tx/${bet.tx}?cluster=devnet`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="portfolio-card-link"
                                        style={{ fontSize: '0.85rem', color: '#666', textDecoration: 'none' }}
                                    >
                                        View on Solscan →
                                    </a>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <div className="info-notice">
                    <span className="info-notice-icon">🔐</span>
                    <p>Bet amounts encrypted on-chain • ZK proofs for claims</p>
                </div>
            </div>
        </Padder>
    );
}
