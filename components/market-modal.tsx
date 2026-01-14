"use client";

import { useEffect, useState } from "react";
import { PredictEvent, Market, formatPrice, formatVolume, getCategoryColor } from "@/lib/jup-predict";

interface MarketModalProps {
    event: PredictEvent | null;
    selectedMarketId?: string | null;
    onClose: () => void;
}

export default function MarketModal({ event, selectedMarketId, onClose }: MarketModalProps) {
    const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!event) return;

        // If a specific market is selected, fetch its details
        // Otherwise use the first open market
        const market = selectedMarketId
            ? event.markets?.find(m => m.marketId === selectedMarketId)
            : event.markets?.find(m => m.status === "open") || event.markets?.[0];

        if (market) {
            setSelectedMarket(market);
        }
    }, [event, selectedMarketId]);

    if (!event) return null;

    const yesPrice = selectedMarket?.pricing?.buyYesPriceUsd;
    const noPrice = selectedMarket?.pricing?.buyNoPriceUsd;
    const yesPct = yesPrice !== null && yesPrice !== undefined ? yesPrice / 10000 : 50;

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
                        </div>
                    </div>
                </div>

                {/* Market selector if multiple markets */}
                {event.markets && event.markets.length > 1 && (
                    <div className="market-selector">
                        <label>Select Outcome:</label>
                        <select
                            value={selectedMarket?.marketId || ""}
                            onChange={(e) => {
                                const m = event.markets.find(m => m.marketId === e.target.value);
                                if (m) setSelectedMarket(m);
                            }}
                        >
                            {event.markets.filter(m => m.status === "open").map(m => (
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
                        <div className="modal-prices">
                            <div className="modal-price yes">
                                <span className="label">Buy Yes</span>
                                <span className="value">{formatPrice(yesPrice ?? null)}</span>
                            </div>
                            <div className="modal-price no">
                                <span className="label">Buy No</span>
                                <span className="value">{formatPrice(noPrice ?? null)}</span>
                            </div>
                        </div>

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
                                <span className="no">{(100 - yesPct).toFixed(1)}% No</span>
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

                {/* Buy buttons */}
                <div className="modal-actions">
                    <button className="btn-buy-yes" disabled>
                        Buy Yes · {formatPrice(yesPrice ?? null)}
                    </button>
                    <button className="btn-buy-no" disabled>
                        Buy No · {formatPrice(noPrice ?? null)}
                    </button>
                </div>

                <p className="modal-disclaimer">
                    Trading coming soon. Connect wallet to enable.
                </p>

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
