"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useWallet, useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { PredictEvent, Market, formatPrice, formatVolume, getCategoryColor } from "@/lib/jup-predict";
import { placeBet, fetchUserMarketBet, fetchMarketTotals, calculatePotentialPayout, Bet } from "@/lib/confidential-betting";
import { useCrypto } from "@/app/providers/CryptoProvider";
import { fetchUserTokenAccount } from "@/utils/constants";
import { PROTOCOL_INCO_MINT } from "@/lib/protocol";

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
    const [hasTokens, setHasTokens] = useState(false);

    // Async data states
    const [totals, setTotals] = useState({ yes: 0, no: 0, total: 0 });
    const [existingBet, setExistingBet] = useState<Bet | null | undefined>(null);
    const [showMarketInfo, setShowMarketInfo] = useState(false);

    // Solana icon URL
    const solanaIconUrl = "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png";

    // Get display unit
    const unit = "wSOL";

    const { publicKey, sendTransaction, connected, signMessage } = useWallet();
    const { connection } = useConnection();
    const wallet = useAnchorWallet();
    const { cryptoKey, deriveSessionKey } = useCrypto();

    // Track if we've already fetched token account for this wallet/session
    const tokenFetchedRef = useRef<string | null>(null);

    // Check user's token accounts - enforces new protocol mint
    useEffect(() => {
        if (!publicKey || !connection) {
            setHasTokens(false);
            tokenFetchedRef.current = null;
            return;
        }

        const walletKey = publicKey.toBase58();
        if (tokenFetchedRef.current === walletKey) {
            return;
        }

        (async () => {
            // Check for protocol wSOL-backed mint account
            const protocolAccount = await fetchUserTokenAccount(connection, publicKey, PROTOCOL_INCO_MINT);
            if (protocolAccount) {
                setHasTokens(true);
            } else {
                setHasTokens(false);
            }
            tokenFetchedRef.current = walletKey;
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

    // Check if this is a multi-team sports/esports event
    const isMultiTeamEvent = useMemo(() => {
        return relevantMarkets && relevantMarkets.length > 1;
    }, [relevantMarkets]);

    // Sort markets by probability (descending) for better UX in large lists
    const sortedMarkets = useMemo(() => {
        if (!relevantMarkets) return [];
        return [...relevantMarkets].sort((a, b) => {
            const priceA = a.pricing?.buyYesPriceUsd || 0;
            const priceB = b.pricing?.buyYesPriceUsd || 0;
            return priceB - priceA; // Higher probability first
        });
    }, [relevantMarkets]);

    // Get live odds from API pricing data
    // API returns buyYesPriceUsd in micro-cents: 1,000,000 = $1.00 = 100 cents
    // For prediction markets: price represents probability in cents (0-100)
    // e.g., 730000 = 73 cents = 73% probability
    const getMarketOdds = (market: Market): { probability: number; odds: number; volumeRaw: number } => {
        const price = market.pricing?.buyYesPriceUsd;
        const volume24h = market.pricing?.volume24h || 0;

        if (price && price > 0) {
            // Price is in micro-cents, divide by 10000 to get percentage
            // 730000 / 10000 = 73%
            const probability = Math.max(0.1, Math.min(99.9, price / 10000));
            // Odds = 100 / probability (e.g., 73% = 1.37x, 1% = 100x)
            const odds = 100 / probability;
            return { probability, odds, volumeRaw: volume24h };
        }
        // Fallback for markets with no price data - use 1% as minimum
        return { probability: 1, odds: 100, volumeRaw: volume24h };
    };

    if (!event) return null;

    const totalPool = totals.yes + totals.no;

    // Calculate percentages for UI (default to 50/50 if empty)
    const yesPct = totalPool > 0 ? (totals.yes / totalPool) * 100 : 50;
    const noPct = 100 - yesPct;

    // Calculate estimated payout using Parimutuel model (for single YES/NO markets)
    const calculateLivePayout = (amount: number, outcome: "yes" | "no"): number => {
        if (amount <= 0) return 0;

        // Simulate adding our bet to the pool
        const estimatedTotals = {
            yes: totals.yes + (outcome === "yes" ? amount : 0),
            no: totals.no + (outcome === "no" ? amount : 0)
        };

        return calculatePotentialPayout(amount, outcome, estimatedTotals);
    };

    // Calculate payout for multi-team events using API odds
    const calculateApiOddsPayout = (amount: number, odds: number): number => {
        if (amount <= 0 || odds <= 0) return 0;
        return amount * odds;
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
        if (!wallet || !selectedMarket || !betAmount || !publicKey || !selectedOutcome) return;

        const amount = parseFloat(betAmount);
        if (isNaN(amount) || amount <= 0) {
            setBetResult({ success: false, message: "Enter a valid amount" });
            return;
        }

        setBetting(true);
        setBetResult(null);

        try {
            // For multi-team events, use API odds; for binary markets, use pool odds
            let currentOdds: number;
            let payout: number;

            if (isMultiTeamEvent && selectedMarket) {
                const { odds } = getMarketOdds(selectedMarket);
                currentOdds = odds;
                payout = calculateApiOddsPayout(amount, odds);
            } else {
                currentOdds = selectedOutcome === "yes" ? estYesOdds : estNoOdds;
                payout = calculateLivePayout(amount, selectedOutcome);
            }

            // Determine team name for multi-team events
            const teamName = isMultiTeamEvent && selectedMarket
                ? (selectedMarket.metadata?.title || undefined)
                : undefined;

            // Ensure session key is ready (derive if needed)
            let sessionKey = cryptoKey;
            if (!sessionKey && publicKey && signMessage) {
                try {
                    // This prompts signature if not cached
                    sessionKey = await deriveSessionKey(publicKey.toBase58(), signMessage);
                } catch (e) {
                    console.warn("Could not derive session key, bet will be unencrypted:", e);
                }
            }

            const result = await placeBet(
                connection,
                wallet,
                sendTransaction,
                selectedMarket.marketId,
                event.metadata?.title || selectedMarket.marketId,
                selectedOutcome,
                amount,
                PROTOCOL_INCO_MINT.toBase58(),
                currentOdds,
                payout,
                event.metadata?.imageUrl,
                undefined,  // signMessage - we handle key derivation above
                teamName,   // Team name for multi-outcome markets
                sessionKey  // Pass the derived session key
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

    // Calculate potential payout based on event type
    const getPotentialPayout = (): number => {
        if (!selectedOutcome || !betAmount || parseFloat(betAmount) <= 0) return 0;

        const amount = parseFloat(betAmount);

        // For multi-team events, use API odds directly
        if (isMultiTeamEvent && selectedMarket) {
            const { odds } = getMarketOdds(selectedMarket);
            return calculateApiOddsPayout(amount, odds);
        }

        // For single YES/NO markets, use parimutuel calculation
        return calculateLivePayout(amount, selectedOutcome);
    };
    const potentialPayout = getPotentialPayout();

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

                {/* Multi-Team Selection for Sports/Esports Events */}
                {isMultiTeamEvent && (
                    <div className="team-selection">
                        <label className="bet-input-label" style={{ marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>Pick Your Winner</span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 400 }}>
                                {sortedMarkets.length} options
                            </span>
                        </label>
                        <div className="team-list">
                            {sortedMarkets.map((market) => {
                                const { probability, odds } = getMarketOdds(market);
                                const isSelected = selectedMarket?.marketId === market.marketId && selectedOutcome === "yes";
                                const teamName = market.metadata?.title || market.marketId;

                                return (
                                    <button
                                        key={market.marketId}
                                        className={`team-row ${isSelected ? 'selected' : ''} ${market.status !== 'open' ? 'disabled' : ''}`}
                                        onClick={() => {
                                            if (market.status === 'open') {
                                                setSelectedMarket(market);
                                                setSelectedOutcome("yes");
                                            }
                                        }}
                                        disabled={betting || market.status !== 'open'}
                                    >
                                        <span className="team-row-name">{teamName}</span>
                                        <span className="team-row-prob">{probability.toFixed(0)}%</span>
                                        <span className="team-row-odds">{odds.toFixed(2)}x</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Single Market Stats (only for non-team events) */}
                {!isMultiTeamEvent && selectedMarket && (
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
                                <span className="yes">{yesPct.toFixed(1)}% Yes</span>
                                <span className="no">{noPct.toFixed(1)}% No</span>
                            </div>
                        </div>

                        {/* Stats */}
                        <div className="modal-stats" style={{
                            gridTemplateColumns: `repeat(${[
                                selectedMarket.pricing.liquidityDollars,
                                selectedMarket.pricing.openInterest
                            ].filter(v => v && v > 0).length + 1}, 1fr)`
                        }}>

                            {/* Only show stats if > 0 */}
                            {(selectedMarket.pricing.liquidityDollars || 0) > 0 && (
                                <div className="stat">
                                    <span className="stat-label">Liquidity</span>
                                    <span className="stat-value">
                                        ${(selectedMarket.pricing.liquidityDollars || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    </span>
                                </div>
                            )}

                            {(selectedMarket.pricing.openInterest || 0) > 0 && (
                                <div className="stat">
                                    <span className="stat-label">Open Interest</span>
                                    <span className="stat-value">
                                        ${selectedMarket.pricing.openInterest.toLocaleString()}
                                    </span>
                                </div>
                            )}

                            <div className="stat">
                                <span className="stat-label">Total Vol</span>
                                <span className="stat-value mb-8">{formatVolume(event.volumeUsd)}</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Aggregated Stats for Multi-Team Events */}
                {isMultiTeamEvent && relevantMarkets && (
                    <div className="modal-stats" style={{
                        marginTop: '16px', gridTemplateColumns: `repeat(${[
                            relevantMarkets.reduce((s, m) => s + (m.pricing?.liquidityDollars || 0), 0),
                            relevantMarkets.reduce((s, m) => s + (m.pricing?.openInterest || 0), 0)
                        ].filter(v => v > 0).length + 1}, 1fr)`
                    }}>

                        {/* Calculated Sums */}
                        {(() => {
                            const totalLiq = relevantMarkets.reduce((sum, m) => sum + (m.pricing?.liquidityDollars || 0), 0);
                            const totalOI = relevantMarkets.reduce((sum, m) => sum + (m.pricing?.openInterest || 0), 0);

                            return (
                                <>
                                    {totalLiq > 0 && (
                                        <div className="stat">
                                            <span className="stat-label">Liquidity</span>
                                            <span className="stat-value">${totalLiq.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                        </div>
                                    )}
                                    {totalOI > 0 && (
                                        <div className="stat">
                                            <span className="stat-label">Open Interest</span>
                                            <span className="stat-value">${totalOI.toLocaleString()}</span>
                                        </div>
                                    )}
                                </>
                            );
                        })()}

                        <div className="stat">
                            <span className="stat-label">Total Vol</span>
                            <span className="stat-value">{formatVolume(event.volumeUsd)}</span>
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
                            {/* For non-multi-team events, show YES/NO selector */}
                            {!isMultiTeamEvent && (
                                <>
                                    <label className="bet-input-label">1. Choose Your Prediction</label>
                                    <div className="outcome-selector">
                                        <button
                                            className={`outcome-btn yes ${selectedOutcome === "yes" ? "selected" : ""}`}
                                            onClick={() => setSelectedOutcome("yes")}
                                            disabled={betting}
                                        >
                                            <span className="outcome-label">YES</span>
                                            <span className="outcome-odds">{estYesOdds.toFixed(2)}x</span>
                                            <span className="outcome-price">Est. Payout</span>
                                        </button>
                                        <button
                                            className={`outcome-btn no ${selectedOutcome === "no" ? "selected" : ""}`}
                                            onClick={() => setSelectedOutcome("no")}
                                            disabled={betting}
                                        >
                                            <span className="outcome-label">NO</span>
                                            <span className="outcome-odds">{estNoOdds.toFixed(2)}x</span>
                                            <span className="outcome-price">Est. Payout</span>
                                        </button>
                                    </div>
                                </>
                            )}

                            {/* Step 2: Enter amount (shown after selecting outcome) */}
                            {selectedOutcome && (
                                <div className="bet-amount-section">
                                    <label className="bet-input-label">
                                        {isMultiTeamEvent
                                            ? "2. Enter Wager"
                                            : "2. Bet Amount"}
                                    </label>
                                    <div className="wager-input-wrapper">
                                        <input
                                            type="number"
                                            placeholder="0.00"
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
                                        <div className="wager-unit">
                                            <img
                                                src={solanaIconUrl}
                                                alt="SOL"
                                                className="sol-icon-input"
                                            />
                                            <span>SOL</span>
                                        </div>
                                    </div>

                                    {/* Live payout calculation */}
                                    {potentialPayout > 0 && (
                                        <div className={`potential-payout ${selectedOutcome}`}>
                                            <div className="payout-row">
                                                <span>Wager</span>
                                                <strong className="payout-amount">
                                                    <img src={solanaIconUrl} alt="" className="sol-icon-tiny" />
                                                    {parseFloat(betAmount).toFixed(2)}
                                                </strong>
                                            </div>
                                            <div className="payout-row payout-highlight">
                                                <span>
                                                    If {isMultiTeamEvent && selectedMarket
                                                        ? (selectedMarket.metadata?.title || 'selection')
                                                        : selectedOutcome.toUpperCase()} wins
                                                </span>
                                                <strong className="payout-amount">
                                                    <img src={solanaIconUrl} alt="" className="sol-icon-tiny" />
                                                    {potentialPayout.toFixed(2)}
                                                </strong>
                                            </div>
                                            <div className="payout-multiplier">
                                                {isMultiTeamEvent && selectedMarket
                                                    ? getMarketOdds(selectedMarket).odds.toFixed(2)
                                                    : (selectedOutcome === "yes" ? estYesOdds.toFixed(2) : estNoOdds.toFixed(2))
                                                }x return
                                            </div>
                                        </div>
                                    )}

                                    {/* Place bet button */}
                                    <button
                                        className={`btn-place-bet ${selectedOutcome}`}
                                        onClick={handleBet}
                                        disabled={!betAmount || parseFloat(betAmount) <= 0 || betting}
                                    >
                                        {betting
                                            ? "Placing Bet..."
                                            : isMultiTeamEvent && selectedMarket
                                                ? `Bet on ${selectedMarket.metadata?.title || 'selection'}`
                                                : `Place ${selectedOutcome.toUpperCase()} Bet`
                                        }
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
                        <a href="/wallet" className="mint-link">Deposit SOL</a> or mint tokens to start betting
                    </p>
                )}
                {existingBet && (
                    <p className="modal-disclaimer">You can only bet once per market</p>
                )}

                {/* Market Info - Collapsible */}
                <div className="modal-rules">
                    <button
                        className="market-info-toggle"
                        onClick={() => setShowMarketInfo(!showMarketInfo)}
                    >
                        <span>Market Info</span>
                        <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            style={{ transform: showMarketInfo ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                        >
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </button>

                    {showMarketInfo && (
                        <div className="market-info-content">
                            {selectedMarket?.metadata?.description && (
                                <p className="description">{selectedMarket.metadata.description}</p>
                            )}

                            <div className="dates-grid">
                                {selectedMarket?.openTime && (
                                    <div>
                                        <span className="dates-label">Opened</span>
                                        {new Date(selectedMarket.openTime * 1000).toLocaleString()}
                                    </div>
                                )}
                                {selectedMarket?.closeTime && (
                                    <div>
                                        <span className="dates-label">Closes</span>
                                        {new Date(selectedMarket.closeTime * 1000).toLocaleString()}
                                    </div>
                                )}
                            </div>

                            {selectedMarket?.metadata?.rulesPrimary && (
                                <div className="rules-section">
                                    <h5>Resolution Rules</h5>
                                    <p>{selectedMarket.metadata.rulesPrimary}</p>
                                </div>
                            )}
                            {selectedMarket?.metadata?.rulesSecondary && (
                                <div className="rules-section">
                                    <h5>Additional Terms</h5>
                                    <p>{selectedMarket.metadata.rulesSecondary}</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
