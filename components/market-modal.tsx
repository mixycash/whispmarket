"use client";

import { useEffect, useState, useMemo } from "react";
import { useWallet, useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { PredictEvent, Market, formatPrice, formatVolume, getCategoryColor } from "@/lib/jup-predict";
import { placeBet, fetchUserMarketBet, fetchMarketTotals, calculatePotentialPayout, Bet } from "@/lib/confidential-betting";
import { fetchUserMint, fetchUserTokenAccount } from "@/utils/constants";

interface MarketModalProps {
    event: PredictEvent | null;
    selectedMarketId?: string | null;
    onClose: () => void;
}

export default function MarketModal({ event, selectedMarketId, onClose }: MarketModalProps) {
    const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
    const [selectedOutcome, setSelectedOutcome] = useState<"yes" | "no" | null>(null);
    const [betAmount, setBetAmount] = useState("");
    const [betting, setBetting] = useState(false);
    const [betResult, setBetResult] = useState<{ success: boolean; message: string } | null>(null);
    const [userMint, setUserMint] = useState<string | null>(null);
    const [hasTokens, setHasTokens] = useState(false);

    // Async data states
    const [totals, setTotals] = useState({ yes: 0, no: 0, total: 0 });
    const [existingBet, setExistingBet] = useState<Bet | null | undefined>(null);

    const { publicKey, sendTransaction, connected } = useWallet();
    const { connection } = useConnection();
    const wallet = useAnchorWallet();

    // Fetch user's mint on connect
    useEffect(() => {
        if (!publicKey || !connection) {
            setUserMint(null);
            setHasTokens(false);
            return;
        }

        (async () => {
            const mint = await fetchUserMint(connection, publicKey);
            if (mint) {
                setUserMint(mint.pubkey.toBase58());
                const account = await fetchUserTokenAccount(connection, publicKey, mint.pubkey);
                setHasTokens(!!account);
            }
        })();
    }, [publicKey, connection]);

    useEffect(() => {
        if (!event) return;

        const market = selectedMarketId
            ? relevantMarkets.find(m => m.marketId === selectedMarketId)
            : relevantMarkets.find(m => m.status === "open") || relevantMarkets[0];

        if (market) {
            setSelectedMarket(market);
        }
    }, [event, selectedMarketId]);

    // Reset state when modal opens
    useEffect(() => {
        if (event) {
            setBetAmount("");
            setBetResult(null);
            setSelectedOutcome(null);
        }
    }, [event]);

    // Fetch Async Data (Totals and Existing Bet)
    useEffect(() => {
        if (!selectedMarket) {
            setTotals({ yes: 0, no: 0, total: 0 });
            setExistingBet(null);
            return;
        }

        const loadData = async () => {
            // Load totals
            try {
                const t = await fetchMarketTotals(selectedMarket.marketId);
                setTotals(t);
            } catch (e) {
                console.error("Error fetching totals:", e);
            }

            // Load existing bet
            if (publicKey) {
                try {
                    const b = await fetchUserMarketBet(selectedMarket.marketId, publicKey.toBase58());
                    setExistingBet(b);
                } catch (e) { console.error("Error fetching bet:", e); }
            } else {
                setExistingBet(null);
            }
        };
        loadData();
    }, [selectedMarket, publicKey]);

    // Filter relevant markets if event title implies a specific matchup (e.g. "Miami vs Indiana")
    const relevantMarkets = useMemo(() => {
        if (!event || !event.markets) return [];

        // If it's a "vs" or "at" event, try to filter relevant teams
        const title = (event.metadata?.title || "").toLowerCase();
        const separators = [" vs ", " at ", " vs. ", " @ "];
        const separator = separators.find(s => title.includes(s));

        if (separator && event.markets.length > 2) {
            // Extract teams from title (handle potential prefixes like "Championship: ")
            let cleanTitle = title;
            if (cleanTitle.includes(":")) {
                cleanTitle = cleanTitle.split(":").pop() || cleanTitle;
            }

            const teams = cleanTitle.split(separator).map(t => t.trim());

            // Filter markets that match the team names
            if (teams.length >= 2) {
                const filtered = event.markets.filter(m => {
                    const mTitle = (m.metadata?.title || "").toLowerCase();
                    // Match if market title contains team name or team name contains market title
                    // Also check for common abbreviations or partial matches if needed, but simple inclusion is safer first
                    return teams.some(t => mTitle.includes(t) || t.includes(mTitle));
                });

                // Only apply filter if we found matches (safety fallback)
                if (filtered.length > 0) {
                    return filtered;
                }
            }
        }

        return event.markets;
    }, [event]);

    if (!event) return null;

    const totalPool = totals.yes + totals.no;

    // Calculate percentages for UI (default to 50/50 if empty)
    const yesPct = totalPool > 0 ? (totals.yes / totalPool) * 100 : 50;
    const noPct = 100 - yesPct;

    // Calculate estimated payout using Parimutuel model
    const calculateLivePayout = (amount: number, outcome: "yes" | "no"): number => {
        if (amount <= 0) return 0;

        // Simulate adding our bet to the pool
        const estimatedTotals = {
            yes: totals.yes + (outcome === "yes" ? amount : 0),
            no: totals.no + (outcome === "no" ? amount : 0)
        };

        return calculatePotentialPayout(amount, outcome, estimatedTotals);
    };

    // Derived odds for display (Payout / Bet)
    const getEstimatedOdds = (outcome: "yes" | "no") => {
        // Estimate with a standard unit (e.g. 10) to avoid 0/0 issues if pool is empty
        const sampleBet = 10;
        const payout = calculateLivePayout(sampleBet, outcome);
        return payout > 0 ? payout / sampleBet : 1.0;
    };

    const estYesOdds = getEstimatedOdds("yes");
    const estNoOdds = getEstimatedOdds("no");

    const handleBet = async () => {
        if (!wallet || !selectedMarket || !betAmount || !publicKey || !userMint || !selectedOutcome) return;

        const amount = parseFloat(betAmount);
        if (isNaN(amount) || amount <= 0) {
            setBetResult({ success: false, message: "Enter a valid amount" });
            return;
        }

        setBetting(true);
        setBetResult(null);

        try {
            const currentOdds = selectedOutcome === "yes" ? estYesOdds : estNoOdds;
            const payout = calculateLivePayout(amount, selectedOutcome);

            const result = await placeBet(
                connection,
                wallet,
                sendTransaction,
                selectedMarket.marketId,
                event.metadata?.title || selectedMarket.marketId,
                selectedOutcome,
                amount,
                userMint,
                currentOdds,
                payout,
                event.metadata?.imageUrl
            );

            if (result.success) {
                setBetResult({
                    success: true,
                    message: `Bet placed! TX: ${result.signature.slice(0, 8)}...`
                });
                setBetAmount("");
                setSelectedOutcome(null);

                // Refresh totals and bet status
                const newTotals = await fetchMarketTotals(selectedMarket.marketId);
                setTotals(newTotals);
                const newBet = await fetchUserMarketBet(selectedMarket.marketId, publicKey.toBase58());
                setExistingBet(newBet);
            } else {
                setBetResult({
                    success: false,
                    message: result.error || "Bet failed"
                });
            }
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : "Unknown error";
            setBetResult({ success: false, message });
        }

        setBetting(false);
    };

    const potentialPayout = selectedOutcome && betAmount && parseFloat(betAmount) > 0
        ? calculateLivePayout(parseFloat(betAmount), selectedOutcome)
        : 0;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                {/* Close button */}
                <button className="modal-close" onClick={onClose}>×</button>

                {/* Header */}
                <div className="modal-header">
                    <div className="modal-title-group">
                        {event.metadata?.imageUrl && (
                            <div className="modal-image-container">
                                <img
                                    src={event.metadata.imageUrl}
                                    alt={event.metadata.title}
                                    className="modal-image"
                                    onError={(e) => {
                                        (e.target as HTMLImageElement).style.display = 'none';
                                    }}
                                />
                            </div>
                        )}
                        <div className="modal-title-content">
                            <div
                                className="modal-category"
                                style={{ backgroundColor: getCategoryColor(event.category) }}
                            >
                                {event.category}
                                {event.isLive && <span className="live-indicator" />}
                            </div>
                            <h2 className="modal-title">{event.metadata?.title}</h2>
                            {event.metadata?.subtitle && (
                                <p className="modal-subtitle">{event.metadata.subtitle}</p>
                            )}
                            {event.beginAt && !isNaN(new Date(event.beginAt).getTime()) && (
                                <p className="modal-date" style={{ color: '#aaa', fontSize: '0.85rem', marginTop: '4px' }}>
                                    On {new Date(event.beginAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Market selector if multiple markets */}
                {relevantMarkets && relevantMarkets.length > 1 && (
                    <div className="market-selector">
                        <label style={{ display: 'block', marginBottom: '8px', color: '#aaa', fontSize: '0.9rem' }}>Select Market:</label>
                        <select
                            value={selectedMarket?.marketId || ""}
                            onChange={(e) => {
                                const m = relevantMarkets.find(m => m.marketId === e.target.value);
                                if (m) setSelectedMarket(m);
                                setSelectedOutcome(null);
                            }}
                        >
                            {relevantMarkets.map(m => ( // Allow selecting closed markets to see results
                                <option key={m.marketId} value={m.marketId}>
                                    {m.metadata?.title || m.marketId}
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                {/* Pricing section */}
                {selectedMarket && (
                    <div className="modal-pricing">
                        {/* Large progress bar */}
                        <div className="modal-probability">
                            <div className="probability-bar">
                                <div
                                    className="probability-fill"
                                    style={{ width: `${yesPct}%` }}
                                />
                            </div>
                            <div className="probability-labels">
                                <span className="yes">
                                    {yesPct.toFixed(1)}%
                                    {(!relevantMarkets || relevantMarkets.length <= 1) && " Yes"}
                                </span>
                                {(!relevantMarkets || relevantMarkets.length <= 1) && (
                                    <span className="no">{noPct.toFixed(1)}% No</span>
                                )}
                            </div>
                        </div>

                        {/* Stats */}
                        <div className="modal-stats">
                            <div className="stat">
                                <span className="stat-label">24h Volume</span>
                                <span className="stat-value">
                                    ${selectedMarket.pricing.volume24h.toLocaleString()}
                                </span>
                            </div>
                            <div className="stat">
                                <span className="stat-label">Total Volume</span>
                                <span className="stat-value">{formatVolume(event.volumeUsd)}</span>
                            </div>
                            <div className="stat">
                                <span className="stat-label">Open Interest</span>
                                <span className="stat-value">
                                    ${selectedMarket.pricing.openInterest.toLocaleString()}
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Existing bet notice */}
                {existingBet && (
                    <div className="existing-bet-notice">
                        <span className={`bet-badge ${existingBet.outcome}`}>{existingBet.outcome.toUpperCase()}</span>
                        <span>You already placed a bet on this market</span>
                    </div>
                )}

                {/* Market Closed notice */}
                {(selectedMarket?.status === "closed" || !event.isActive || (selectedMarket?.closeTime && (selectedMarket.closeTime * (selectedMarket.closeTime < 10000000000 ? 1000 : 1)) < Date.now())) && (
                    <div className="market-closed-notice" style={{ padding: '15px', backgroundColor: '#333', borderRadius: '8px', textAlign: 'center', margin: '20px 0' }}>
                        <span style={{ fontSize: '1.2rem', display: 'block', marginBottom: '5px' }}>🔒 Market Closed</span>
                        <span style={{ color: '#aaa' }}>This market has ended and is no longer accepting bets.</span>
                        {selectedMarket?.result && (
                            <div style={{ marginTop: '10px', fontWeight: 'bold' }}>
                                Result: {selectedMarket.result}
                            </div>
                        )}
                    </div>
                )}

                {/* Betting workflow - Only show if market is OPEN */}
                {connected && hasTokens && !existingBet && selectedMarket?.status === "open" && event.isActive &&
                    (!selectedMarket.closeTime || (selectedMarket.closeTime * (selectedMarket.closeTime < 10000000000 ? 1000 : 1)) > Date.now()) && (
                        <div className="bet-flow">
                            <label className="bet-input-label">1. Choose Your Prediction</label>
                            <div className="outcome-selector">
                                <button
                                    className={`outcome-btn yes ${selectedOutcome === "yes" ? "selected" : ""}`}
                                    onClick={() => setSelectedOutcome("yes")}
                                    disabled={betting}
                                    style={relevantMarkets && relevantMarkets.length > 1 ? { width: '100%' } : {}}
                                >
                                    <span className="outcome-label">
                                        {relevantMarkets && relevantMarkets.length > 1 ? "WIN" : "YES"}
                                    </span>
                                    <span className="outcome-odds">{estYesOdds.toFixed(2)}x</span>
                                    <span className="outcome-price">Est. Payout</span>
                                </button>
                                {(!relevantMarkets || relevantMarkets.length <= 1) && (
                                    <button
                                        className={`outcome-btn no ${selectedOutcome === "no" ? "selected" : ""}`}
                                        onClick={() => setSelectedOutcome("no")}
                                        disabled={betting}
                                    >
                                        <span className="outcome-label">NO</span>
                                        <span className="outcome-odds">{estNoOdds.toFixed(2)}x</span>
                                        <span className="outcome-price">Est. Payout</span>
                                    </button>
                                )}
                            </div>

                            {/* Step 2: Enter amount (shown after selecting outcome) */}
                            {selectedOutcome && (
                                <div className="bet-amount-section">
                                    <label className="bet-input-label">2. Enter Bet Amount (Confidential)</label>
                                    <input
                                        type="number"
                                        placeholder="Enter amount..."
                                        value={betAmount}
                                        onChange={(e) => {
                                            setBetAmount(e.target.value);
                                            setBetResult(null);
                                        }}
                                        disabled={betting}
                                        className="bet-input"
                                        step="0.01"
                                        min="0"
                                    />

                                    {/* Live payout calculation */}
                                    {potentialPayout > 0 && (
                                        <div className={`potential-payout ${selectedOutcome}`}>
                                            <div className="payout-row">
                                                <span>Your bet:</span>
                                                <strong>🔒 {parseFloat(betAmount).toFixed(2)} tokens</strong>
                                            </div>
                                            <div className="payout-row">
                                                <span>If {selectedOutcome.toUpperCase()} wins:</span>
                                                <strong>{potentialPayout.toFixed(2)} tokens</strong>
                                            </div>
                                            <div className="payout-multiplier">
                                                {selectedOutcome === "yes" ? estYesOdds.toFixed(2) : estNoOdds.toFixed(2)}x potential return
                                            </div>
                                        </div>
                                    )}

                                    {/* Place bet button */}
                                    <button
                                        className={`btn-place-bet ${selectedOutcome}`}
                                        onClick={handleBet}
                                        disabled={!betAmount || parseFloat(betAmount) <= 0 || betting}
                                    >
                                        {betting ? "Placing Bet..." : `Place ${selectedOutcome.toUpperCase()} Bet`}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                {/* Bet result message */}
                {betResult && (
                    <div className={`bet-result ${betResult.success ? "success" : "error"}`}>
                        {betResult.success ? "✅" : "❌"} {betResult.message}
                    </div>
                )}

                {/* Status messages for disconnected/no-tokens */}
                {!connected && (
                    <p className="modal-disclaimer">Connect wallet to place bets</p>
                )}
                {connected && !hasTokens && (
                    <p className="modal-disclaimer">
                        <a href="/wallet" className="mint-link">Mint tokens</a> to start betting
                    </p>
                )}
                {existingBet && (
                    <p className="modal-disclaimer">You can only bet once per market</p>
                )}

                {/* Rules */}
                {selectedMarket?.metadata?.rulesPrimary && (
                    <div className="modal-rules">
                        <h4>Resolution Rules</h4>
                        <p>{selectedMarket.metadata.rulesPrimary}</p>
                    </div>
                )}
            </div>
        </div>
    );
}
