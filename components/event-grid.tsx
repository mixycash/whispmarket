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

type SortOption = "volume" | "newest" | "ending_soon";
type SortDirection = "asc" | "desc";
type StatusOption = "active" | "resolved";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
    { value: "volume", label: "Volume" },
    { value: "newest", label: "Newest" },
    { value: "ending_soon", label: "Ending Soon" },
];

export default function EventGrid() {
    const [events, setEvents] = useState<PredictEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [category, setCategory] = useState<Category>("all");
    const [sortBy, setSortBy] = useState<SortOption>("volume");
    const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
    const [status, setStatus] = useState<StatusOption>("active");
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
            // Determine API params based on sort selection
            let apiSortBy: "volume" | "beginAt" = "volume";

            if (sortBy === "newest") {
                apiSortBy = "beginAt";
            }

            // Fetch 50 events for display
            // For "ending_soon", we rely on client-side sort mainly, but fetching by volume or beginAt 
            // is a decent default. API doesn't have "ending soon" sort natively usually.
            const response = await fetchEvents({
                includeMarkets: true,
                category,
                sortBy: apiSortBy,
                sortDirection: sortDirection,
                start: 0,
                end: 50,
            });

            // Filter events based on status (Active vs Resolved)
            let filteredEvents = response.data.filter(event => {
                const hasOpenMarkets = event.markets?.some(m => m.status === "open");
                const isTotallyClosed = !event.isActive || (event.markets && event.markets.every(m => m.status !== "open"));

                if (status === "active") {
                    // Show live events with at least one open market
                    return event.isActive && hasOpenMarkets;
                } else {
                    // Show resolved/closed events
                    return isTotallyClosed;
                }
            });

            // Client-side sorting for "Ending Soon" or refined ordering
            if (sortBy === "ending_soon") {
                filteredEvents.sort((a, b) => {
                    // Find earliest closing active market for each event
                    const getCloseTime = (e: PredictEvent) => {
                        const openMarkets = e.markets?.filter(m => m.status === "open") || [];
                        if (openMarkets.length === 0) return Number.MAX_SAFE_INTEGER;
                        const times = openMarkets.map(m => {
                            let t = m.closeTime || m.metadata?.closeTime || 0;
                            // normalize seconds to ms
                            if (t < 10000000000) t *= 1000;
                            return t;
                        });
                        return Math.min(...times);
                    };
                    const diff = getCloseTime(a) - getCloseTime(b);
                    return sortDirection === 'asc' ? diff : -diff;
                });
            } else if (sortBy === "volume") {
                // Ensure volume sort is strict
                filteredEvents.sort((a, b) => {
                    const volA = parseInt(a.volumeUsd) || 0;
                    const volB = parseInt(b.volumeUsd) || 0;
                    return sortDirection === 'desc' ? volB - volA : volA - volB;
                });
            } else if (sortBy === "newest") {
                filteredEvents.sort((a, b) => {
                    const timeA = new Date(a.beginAt || 0).getTime();
                    const timeB = new Date(b.beginAt || 0).getTime();
                    return sortDirection === 'desc' ? timeB - timeA : timeA - timeB;
                });
            }

            setEvents(filteredEvents);
        } catch (err) {
            // Try to use cached data on error
            const cached = getAllCachedEvents();
            if (cached.length > 0) {
                const filtered = cached.filter(event => {
                    if (category !== "all" && event.category !== category) return false;

                    const hasOpenMarkets = event.markets?.some(m => m.status === "open");
                    const isClosed = !event.isActive || (event.markets && event.markets.every(m => m.status !== "open"));

                    return status === "active" ? (event.isActive && hasOpenMarkets) : isClosed;
                });

                // Apply sort to cached data
                if (sortBy === "volume") {
                    filtered.sort((a, b) => {
                        const valA = (parseInt(a.volumeUsd) || 0);
                        const valB = (parseInt(b.volumeUsd) || 0);
                        return sortDirection === 'desc' ? valB - valA : valA - valB;
                    });
                } else if (sortBy === "newest") {
                    filtered.sort((a, b) => {
                        const timeA = new Date(a.beginAt || 0).getTime();
                        const timeB = new Date(b.beginAt || 0).getTime();
                        return sortDirection === 'desc' ? timeB - timeA : timeA - timeB;
                    });
                }

                setEvents(filtered.slice(0, 50));
                setError("Using cached data");
            } else {
                setError("Failed to load markets");
            }
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [category, sortBy, status, sortDirection]);

    useEffect(() => {
        loadEvents();
    }, [loadEvents]);

    return (
        <div className="event-grid-container">
            <div className="toolbar-container">
                {/* Mobile-friendly scrolling categories */}
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

                {/* Filters */}
                <div className="filters-row">
                    <div className="sort-group">
                        <div className="filter-group">
                            <span className="filter-label">Sort:</span>
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value as SortOption)}
                                className="filter-select"
                            >
                                {SORT_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>

                        <button
                            className="sort-direction-btn"
                            onClick={() => setSortDirection(prev => prev === "desc" ? "asc" : "desc")}
                            title={sortDirection === "desc" ? "Descending" : "Ascending"}
                            aria-label="Toggle sort direction"
                        >
                            <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                style={{ transform: sortDirection === "asc" ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
                            >
                                <line x1="12" y1="5" x2="12" y2="19"></line>
                                <polyline points="19 12 12 19 5 12"></polyline>
                            </svg>
                        </button>
                    </div>

                    <div className="filter-group">
                        <div className="toggle-switch">
                            <button
                                className={`toggle-option ${status === 'active' ? 'active' : ''}`}
                                onClick={() => setStatus('active')}
                            >
                                Active
                            </button>
                            <button
                                className={`toggle-option ${status === 'resolved' ? 'active' : ''}`}
                                onClick={() => setStatus('resolved')}
                            >
                                Resolved
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <style jsx>{`
                .toolbar-container {
                    display: flex;
                    flex-direction: column;
                    gap: 1rem;
                    margin-top: 1.5rem;
                    margin-bottom: 2rem;
                }
                
                @media (min-width: 768px) {
                    .toolbar-container {
                        flex-direction: row;
                        align-items: center;
                        justify-content: space-between;
                        gap: 2rem;
                    }
                    .category-tabs {
                        margin-bottom: 0;
                        padding: 0;
                    }
                }

                .filters-row {
                    display: flex;
                    align-items: center;
                    gap: 1.5rem;
                    flex-wrap: wrap;
                }

                .sort-group {
                    display: flex;
                    align-items: center;
                    gap: 0;
                    background: var(--surface);
                    border: 1px solid var(--border-subtle);
                    border-radius: 8px;
                    padding: 0 0 0 0.5rem; /* Left padding only */
                    height: 38px; /* Fixed height to match other inputs */
                }

                .filter-group {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                }

                .filter-label {
                    font-size: 0.75rem;
                    color: var(--muted);
                    white-space: nowrap;
                    font-weight: 500;
                    margin-left: 0.5rem;
                }

                .filter-select {
                    background: transparent;
                    color: var(--foreground);
                    border: none;
                    border-radius: 0;
                    padding: 0.25rem 1.5rem 0.25rem 0.5rem;
                    font-size: 0.8125rem;
                    cursor: pointer;
                    outline: none;
                    font-weight: 600;
                }
                .filter-select:focus {
                    box-shadow: none;
                }
                .filter-select option {
                    background-color: var(--surface);
                    color: var(--foreground);
                }

                .sort-direction-btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 100%; /* Fill container height */
                    padding: 0 0.5rem; /* Add sufficient padding area */
                    background: transparent;
                    border: none;
                    color: var(--muted);
                    cursor: pointer;
                    transition: all 0.2s;
                    border-left: 1px solid var(--border-subtle);
                    margin-left: 0;
                    border-top-right-radius: 7px;
                    border-bottom-right-radius: 7px;
                }
                .sort-direction-btn:hover {
                    color: var(--foreground);
                    background: rgba(255,255,255,0.05);
                }

                .toggle-switch {
                    display: flex;
                    background: var(--surface);
                    border: 1px solid var(--border-subtle);
                    border-radius: 8px;
                    padding: 2px;
                }

                .toggle-option {
                    padding: 0.375rem 0.75rem;
                    border-radius: 6px;
                    font-size: 0.75rem;
                    font-weight: 600;
                    color: var(--muted);
                    transition: all 0.2s;
                    cursor: pointer;
                    background: transparent;
                    border: none;
                }

                .toggle-option.active {
                    background: var(--surface-hover);
                    color: var(--foreground);
                    box-shadow: 0 1px 2px rgba(0,0,0,0.1);
                }
            `}</style>

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
                    {events.map(event => (
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
