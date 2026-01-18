"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { PredictEvent, Category, fetchEvents, fetchAllEvents, getAllCachedEvents } from "@/lib/jup-predict";
import EventCard from "./event-card";
import MarketModal from "./market-modal";

const CATEGORIES: { value: Category; label: string }[] = [
    { value: "all", label: "All" },
    { value: "crypto", label: "Crypto" },
    { value: "politics", label: "Politics" },
    { value: "sports", label: "Sports" },
    { value: "economics", label: "Economics" },
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
    const [visibleCount, setVisibleCount] = useState(36);
    const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);
    const prefetchStarted = useRef(false);

    // Background prefetch ALL events on app load for fast filtering
    useEffect(() => {
        if (prefetchStarted.current) return;
        prefetchStarted.current = true;

        const prefetchAll = async () => {
            console.log('[Prefetch] Starting background prefetch...');
            const startTime = Date.now();

            try {
                await fetchAllEvents();
                console.log('[Prefetch] ✓ Jupiter cache loaded');
            } catch (e) {
                console.warn('[Prefetch] Jupiter cache failed:', e);
            }

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[Prefetch] ✓ Prefetch complete in ${elapsed}s`);
            setCacheLoaded(true);
        };

        prefetchAll();
    }, []);

    const loadEvents = useCallback(async () => {
        setLoading(true);
        setError(null);
        setVisibleCount(36); // Reset visible count on filter change
        try {
            // Determine API params based on sort selection
            let apiSortBy: "volume" | "beginAt" = "volume";
            if (sortBy === "newest") {
                apiSortBy = "beginAt";
            }

            // Fetch 400 events in 4 parallel batches for comprehensive coverage
            const batchPromises = [
                fetchEvents({
                    includeMarkets: true,
                    category,
                    sortBy: apiSortBy,
                    sortDirection: sortDirection,
                    start: 0,
                    end: 99,
                }),
                fetchEvents({
                    includeMarkets: true,
                    category,
                    sortBy: apiSortBy,
                    sortDirection: sortDirection,
                    start: 100,
                    end: 199,
                }),
                fetchEvents({
                    includeMarkets: true,
                    category,
                    sortBy: apiSortBy,
                    sortDirection: sortDirection,
                    start: 200,
                    end: 299,
                }),
                fetchEvents({
                    includeMarkets: true,
                    category,
                    sortBy: apiSortBy,
                    sortDirection: sortDirection,
                    start: 300,
                    end: 399,
                }),
            ];

            const batches = await Promise.all(batchPromises);
            const apiEvents = batches.flatMap(b => b.data).map(e => ({ ...e, provider: 'jup' as const }));

            // Merge with cached events to ensure we show popular items (from background fetch) 
            // that might be missed by the standard API pagination
            const cachedEvents = getAllCachedEvents();
            const cachedMatchingParams = cachedEvents.filter(e => {
                // Filter by category
                if (category !== "all" && e.category.toLowerCase() !== category.toLowerCase()) return false;
                return true;
            });

            // Dedup by eventId, preferring API (fresh) data
            const eventMap = new Map<string, PredictEvent>();

            // Add cached first
            cachedMatchingParams.forEach(e => eventMap.set(e.eventId, e));
            // Overwrite with fresh API data
            apiEvents.forEach(e => eventMap.set(e.eventId, e));

            const allEvents = Array.from(eventMap.values());

            // Filter events based on status (Active vs Resolved)
            let filteredEvents = allEvents.filter(event => {
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

            if (sortBy === "ending_soon") {
                filteredEvents.sort((a, b) => {
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

                setEvents(filtered.slice(0, 200));
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
    }, [loadEvents, cacheLoaded]);

    // Derived state: Get unique subcategories/leagues from the current event list
    // Filter out internal "KX" codes and invalid values
    // Sort by popularity then alphabetically
    const POPULARITY_ORDER = ["nba", "nfl", "ufc", "epl", "ucl", "tennis", "cfb", "laliga", "seriea", "mlb", "nhl"];

    const uniqueSubcategories = Array.from(new Set(
        events
            .map(e => e.subcategory || e.series || "")
            .filter(s => {
                const val = s?.trim();
                if (!val || val === "null" || val.startsWith("KX")) return false;
                if (category === "sports") {
                    // Strict whitelist for sports to avoid showing pollution like politics/internal codes
                    return POPULARITY_ORDER.includes(val.toLowerCase());
                }
                return true;
            })
    )).sort((a, b) => {
        const idxA = POPULARITY_ORDER.indexOf(a.toLowerCase());
        const idxB = POPULARITY_ORDER.indexOf(b.toLowerCase());

        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;

        return a.localeCompare(b);
    });

    const formatSubcategory = (s: string) => {
        const lower = s.toLowerCase();
        const upperMap: Record<string, string> = {
            "nba": "NBA", "nfl": "NFL", "epl": "EPL", "ucl": "UCL", "ufc": "UFC",
            "cfb": "CFB", "mlb": "MLB", "nhl": "NHL", "tennis": "Tennis"
        };
        if (upperMap[lower]) return upperMap[lower];
        if (lower === "laliga") return "La Liga";
        if (lower === "seriea") return "Serie A";
        if (lower === "bundesliga") return "Bundesliga";
        return s.charAt(0).toUpperCase() + s.slice(1);
    };

    // Derived state: Filter events by selected subcategory
    const filteredEvents = selectedSubcategory
        ? events.filter(e => (e.subcategory === selectedSubcategory) || (e.series === selectedSubcategory))
        : events;

    // Reset subcategory when main category changes
    useEffect(() => {
        setSelectedSubcategory(null);
    }, [category]);

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

            {/* Subcategory / League Filters (Subtext) */}
            {uniqueSubcategories.length > 0 && category === "sports" && (
                <div className="subcategory-pills">
                    <button
                        className={`subcategory-pill ${selectedSubcategory === null ? "active" : ""}`}
                        onClick={() => setSelectedSubcategory(null)}
                    >
                        All
                    </button>
                    {uniqueSubcategories.map(sub => (
                        <button
                            key={sub}
                            className={`subcategory-pill ${selectedSubcategory === sub ? "active" : ""}`}
                            onClick={() => setSelectedSubcategory(sub)}
                        >
                            {formatSubcategory(sub)}
                        </button>
                    ))}
                </div>
            )}

            <style jsx>{`
                .toolbar-container {
                    display: flex;
                    flex-direction: column;
                    gap: 1rem;
                    margin-top: 1.5rem;
                    margin-bottom: 1rem;
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
                    background: transparent;
                    border: 1px solid var(--border-subtle);
                    border-radius: 8px;
                    padding: 0;
                    height: 36px;
                    overflow: hidden;
                    transition: border-color 0.2s;
                }
                .sort-group:hover {
                    border-color: var(--border);
                }

                .filter-group {
                    display: flex;
                    align-items: center;
                    gap: 0;
                    height: 100%;
                    position: relative;
                }

                .filter-label {
                    font-size: 0.75rem;
                    color: var(--muted);
                    white-space: nowrap;
                    font-weight: 500;
                    padding-left: 0.875rem;
                    margin: 0;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    pointer-events: none; /* Let clicks pass through if overlapping, though flex layout handles this */
                }

                .filter-select {
                    background: transparent;
                    color: var(--foreground);
                    border: none;
                    border-radius: 0;
                    padding: 0 0.875rem 0 0.5rem;
                    font-size: 0.8125rem;
                    cursor: pointer;
                    outline: none;
                    font-weight: 600;
                    height: 100%;
                    appearance: none;
                }
                .filter-select:focus {
                    box-shadow: none;
                }
                .filter-select option {
                    background-color: var(--background);
                    color: var(--foreground);
                    padding: 0.5rem;
                }

                .sort-direction-btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    width: 32px;
                    background: transparent;
                    border: none;
                    color: var(--muted);
                    cursor: pointer;
                    transition: all 0.2s;
                    border-left: 1px solid var(--border-subtle);
                    margin: 0;
                }
                .sort-direction-btn:hover {
                    color: var(--foreground);
                    background: var(--surface-hover);
                }

                .toggle-switch {
                    display: flex;
                    background: transparent;
                    border: 1px solid var(--border-subtle);
                    border-radius: 8px;
                    padding: 2px;
                    height: 36px;
                }

                .toggle-option {
                    padding: 0 1rem;
                    border-radius: 6px;
                    font-size: 0.75rem;
                    font-weight: 600;
                    color: var(--muted);
                    transition: all 0.2s;
                    cursor: pointer;
                    background: transparent;
                    border: none;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .toggle-option.active {
                    background: var(--surface-hover);
                    color: var(--foreground);
                    box-shadow: 0 1px 2px rgba(0,0,0,0.1);
                }

                .load-more-container {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 0.75rem;
                    margin-top: 2rem;
                    padding: 1.5rem;
                    width: 100%;
                }

                .pagination-info {
                    font-size: 0.875rem;
                    color: var(--muted);
                }

                .pagination-info strong {
                    color: var(--foreground);
                }

                .load-more-btn {
                    background: linear-gradient(135deg, var(--surface) 0%, var(--surface-hover) 100%);
                    border: 1px solid var(--border-subtle);
                    color: var(--foreground);
                    padding: 0.875rem 2.5rem;
                    border-radius: 12px;
                    font-weight: 600;
                    font-size: 0.9375rem;
                    cursor: pointer;
                    transition: all 0.2s;
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                }

                .load-more-btn:hover {
                    background: linear-gradient(135deg, var(--surface-hover) 0%, rgba(99, 102, 241, 0.15) 100%);
                    border-color: rgba(99, 102, 241, 0.3);
                    transform: translateY(-2px);
                    box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.2);
                }

                .load-more-btn .count-badge {
                    background: rgba(99, 102, 241, 0.2);
                    color: var(--primary);
                    padding: 0.125rem 0.5rem;
                    border-radius: 999px;
                    font-size: 0.75rem;
                    font-weight: 700;
                }

                .subcategory-pills {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 0.5rem;
                    margin-top: 0;
                    margin-bottom: 1.5rem;
                    width: 100%;
                }

                .subcategory-pill {
                    background: transparent;
                    border: 1px solid var(--border-subtle);
                    color: var(--muted);
                    padding: 0.25rem 0.875rem;
                    border-radius: 6px;
                    font-size: 0.75rem;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                    white-space: nowrap;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                }

                .subcategory-pill:hover {
                    border-color: var(--border);
                    color: var(--foreground);
                    background: var(--surface-hover);
                    transform: translateY(-1px);
                }

                .subcategory-pill.active {
                    background: var(--foreground);
                    border-color: var(--foreground);
                    color: var(--background);
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
                    {filteredEvents.slice(0, visibleCount).map(event => (
                        <EventCard
                            key={event.eventId}
                            event={event}
                            onClick={() => setSelectedEvent(event)}
                        />
                    ))}

                    {filteredEvents.length > 0 && (
                        <div className="load-more-container">
                            <p className="pagination-info">
                                Showing <strong>{Math.min(visibleCount, filteredEvents.length)}</strong> of <strong>{filteredEvents.length}</strong> markets
                            </p>
                            {filteredEvents.length > visibleCount && (
                                <button
                                    className="load-more-btn"
                                    onClick={() => setVisibleCount(prev => Math.min(prev + 36, events.length))}
                                >
                                    Load More
                                    <span className="count-badge">+{Math.min(36, filteredEvents.length - visibleCount)}</span>
                                </button>
                            )}
                        </div>
                    )}

                    {filteredEvents.length === 0 && !error && (
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
