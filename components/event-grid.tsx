"use client";

import { useState, useEffect, useCallback } from "react";
import { PredictEvent, Category, fetchEvents, fetchAllEvents, getAllCachedEvents } from "@/lib/jup-predict";
import EventCard from "./event-card";
import MarketModal from "./market-modal";

const CATEGORIES: { value: Category; label: string }[] = [
    { value: "all", label: "All" },
    { value: "crypto", label: "Crypto" },
    { value: "politics", label: "Politics" },
    { value: "sports", label: "Sports" },
    { value: "esports", label: "Esports" },
    { value: "economics", label: "Economics" },
    { value: "tech", label: "Tech" },
    { value: "culture", label: "Culture" },
];

export default function EventGrid() {
    const [events, setEvents] = useState<PredictEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [category, setCategory] = useState<Category>("all");
    const [selectedEvent, setSelectedEvent] = useState<PredictEvent | null>(null);
    const [cacheLoaded, setCacheLoaded] = useState(false);

    // Background fetch all categories on app load for settlement cache
    useEffect(() => {
        const loadCache = async () => {
            try {
                await fetchAllEvents();
                setCacheLoaded(true);
            } catch (e) {
                console.warn("Background cache load failed:", e);
            }
        };
        loadCache();
    }, []);

    const loadEvents = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            // Fetch 50 events for display
            const response = await fetchEvents({
                includeMarkets: true,
                category,
                sortBy: "volume",
                sortDirection: "desc",
                start: 0,
                end: 50,
            });

            // Filter to only show events with at least one open market
            const activeEvents = response.data.filter(
                event => event.isActive && event.markets?.some(m => m.status === "open")
            );

            setEvents(activeEvents);
        } catch (err) {
            // Try to use cached data on error
            const cached = getAllCachedEvents();
            if (cached.length > 0) {
                const filtered = cached.filter(event => {
                    if (category !== "all" && event.category !== category) return false;
                    return event.isActive && event.markets?.some(m => m.status === "open");
                });
                setEvents(filtered.slice(0, 50));
                setError("Using cached data");
            } else {
                setError("Failed to load markets");
            }
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [category]);

    useEffect(() => {
        loadEvents();
    }, [loadEvents]);

    // Sort events by volume for display
    const sortedEvents = [...events].sort((a, b) => {
        const volA = parseInt(a.volumeUsd) || 0;
        const volB = parseInt(b.volumeUsd) || 0;
        return volB - volA;
    });

    return (
        <div className="event-grid-container">
            {/* Category tabs */}
            <div className="category-tabs">
                {CATEGORIES.map(cat => (
                    <button
                        key={cat.value}
                        className={`category-tab ${category === cat.value ? "active" : ""}`}
                        onClick={() => setCategory(cat.value)}
                    >
                        {cat.label}
                    </button>
                ))}
            </div>

            {/* Loading state */}
            {loading && (
                <div className="loading-grid">
                    {[...Array(8)].map((_, i) => (
                        <div key={i} className="skeleton-card" />
                    ))}
                </div>
            )}

            {/* Error state */}
            {error && (
                <div className={`error-state ${events.length > 0 ? "warning" : ""}`}>
                    <p>{error}</p>
                    <button onClick={loadEvents}>Retry</button>
                </div>
            )}

            {/* Events grid */}
            {!loading && (
                <div className="events-grid">
                    {sortedEvents.map(event => (
                        <EventCard
                            key={event.eventId}
                            event={event}
                            onClick={() => setSelectedEvent(event)}
                        />
                    ))}

                    {events.length === 0 && !error && (
                        <div className="empty-state">
                            <p>No active markets in this category</p>
                        </div>
                    )}
                </div>
            )}

            {/* Modal */}
            <MarketModal
                event={selectedEvent}
                onClose={() => setSelectedEvent(null)}
            />
        </div>
    );
}
