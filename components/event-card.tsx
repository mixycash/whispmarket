"use client";

import { PredictEvent, formatPrice, formatVolume } from "@/lib/jup-predict";

interface EventCardProps {
    event: PredictEvent;
    onClick: () => void;
}

export default function EventCard({ event, onClick }: EventCardProps) {
    const primaryMarket = event.markets?.find(m => m.status === "open") || event.markets?.[0];
    const yesPrice = primaryMarket?.pricing?.buyYesPriceUsd;
    const noPrice = primaryMarket?.pricing?.buyNoPriceUsd;

    // Calculate percentages
    const yesPct = yesPrice !== null && yesPrice !== undefined ? (yesPrice / 10000).toFixed(0) : "—";
    const noPct = noPrice !== null && noPrice !== undefined ? (noPrice / 10000).toFixed(0) : "—";

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
                    <span className="outcome-label">Yes</span>
                    <span className="outcome-value yes">{yesPct}%</span>
                </div>
                <div className="outcome-row">
                    <span className="outcome-label">No</span>
                    <span className="outcome-value no">{noPct}%</span>
                </div>
            </div>

            {/* Footer */}
            <div className="card-footer">
                <span className="card-volume">{formatVolume(event.volumeUsd)} Vol.</span>
                <span className="card-category">{event.category}</span>
            </div>
        </div>
    );
}
