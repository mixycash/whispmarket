"use client";

import { PredictEvent, formatPrice, formatVolume } from "@/lib/jup-predict";

interface EventCardProps {
    event: PredictEvent;
    onClick: () => void;
}

export default function EventCard({ event, onClick }: EventCardProps) {
    // Logic to identify top markets
    const activeMarkets = event.markets?.filter(m => m.status === "open") || [];
    const marketsList = activeMarkets.length > 0 ? activeMarkets : (event.markets || []);

    // Sort by Highest Probability (Yes Price) to show top contenders
    const sortedMarkets = [...marketsList].sort((a, b) => {
        const pA = a.pricing?.buyYesPriceUsd || 0;
        const pB = b.pricing?.buyYesPriceUsd || 0;
        return pB - pA;
    });

    const market1 = sortedMarkets[0];
    const market2 = sortedMarkets.length > 1 ? sortedMarkets[1] : null;

    // Helper to format percentage
    const getPct = (price: number | null | undefined) =>
        (price !== null && price !== undefined) ? (price / 10000).toFixed(0) : "—";

    // Helper to clean titles (remove prefixes like "Winner:")
    const cleanTitle = (t: string) => t.includes(":") ? t.split(":").pop()!.trim() : t;

    // Determine Labels and Values
    let outcome1Label = "Yes";
    let outcome1Value = "—";
    let outcome2Label = "No";
    let outcome2Value = "—";
    let isMulti = false;

    if (market1) {
        const m1Title = market1.metadata?.title || "Yes";
        const evtTitle = event.metadata?.title || "";

        // Use market title if it exists and isn't just a copy of the event title
        const isGeneric = m1Title.toLowerCase().trim() === evtTitle.toLowerCase().trim();

        outcome1Label = isGeneric ? "Yes" : cleanTitle(m1Title);
        outcome1Value = getPct(market1.pricing?.buyYesPriceUsd);

        if (market2) {
            isMulti = true;
            // For multi-market events, show the 2nd best contender
            outcome2Label = cleanTitle(market2.metadata?.title || "Outcome 2");
            outcome2Value = getPct(market2.pricing?.buyYesPriceUsd);
        } else {
            // Single market event: Show No/Field
            outcome2Label = "No";
            outcome2Value = getPct(market1.pricing?.buyNoPriceUsd);
        }
    }

    return (
        <div onClick={onClick} className="event-card">
            {/* Header with image and title */}
            <div className="card-header">
                <div className="card-title-group">
                    {event.metadata?.imageUrl && (
                        <div className="card-image-container">
                            <img
                                src={event.metadata.imageUrl}
                                alt={event.metadata.title}
                                className="card-image"
                                onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                }}
                            />
                        </div>
                    )}
                    <h3 className="card-title">{event.metadata?.title}</h3>
                </div>
            </div>

            {/* Outcomes */}
            <div className="card-outcomes">
                <div className="outcome-row">
                    {/* Use title attribute for full text on hover if truncated */}
                    <span className="outcome-label" title={outcome1Label}>{outcome1Label}</span>
                    <span className="outcome-value yes">{outcome1Value}%</span>
                </div>
                <div className="outcome-row">
                    <span className="outcome-label" title={outcome2Label}>{outcome2Label}</span>
                    <span className={`outcome-value ${isMulti ? "yes" : "no"}`}>{outcome2Value}%</span>
                </div>
            </div>

            {/* Footer */}
            <div className="card-footer">
                <span className="card-volume">{formatVolume(event.volumeUsd)} Vol</span>
                <span className="card-category" style={{ marginLeft: 'auto' }}>{event.category}</span>
            </div>
        </div>
    );
}
