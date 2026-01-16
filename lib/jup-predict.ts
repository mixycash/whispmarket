// Jupiter Predict Market API Types and Client with Caching

export interface MarketPricing {
    buyYesPriceUsd: number | null;
    buyNoPriceUsd: number | null;
    sellYesPriceUsd: number | null;
    sellNoPriceUsd: number | null;
    volume: number;
    volume24h: number;
    openInterest: number;
    liquidityDollars?: number;
    notionalValueDollars?: number;
}

export interface MarketMetadata {
    marketId: string;
    title: string;
    subtitle?: string;
    description?: string;
    status: string;
    result?: string;
    closeTime: number;
    openTime: number;
    settlementTime: number;
    isTradable: boolean;
    rulesPrimary?: string;
    rulesSecondary?: string;
}

export interface Market {
    marketId: string;
    event: string;
    status: "open" | "closed";
    result: string;
    openTime: number;
    closeTime: number;
    settlementTime: number;
    metadata: MarketMetadata;
    pricing: MarketPricing;
}

export interface EventMetadata {
    eventId: string;
    title: string;
    subtitle?: string;
    imageUrl?: string;
    isLive: boolean;
    earlyCloseCondition?: string;
}

export interface PredictEvent {
    eventId: string;
    series: string;
    isActive: boolean;
    beginAt: string | null;
    category: string;
    subcategory?: string;
    winner: string;
    metadata: EventMetadata;
    markets: Market[];
    multipleWinners: boolean;
    isLive: boolean;
    tvlDollars: string;
    volumeUsd: string;
    closeCondition?: string;
    rulesPdf?: string;
}

export interface PaginationInfo {
    start: number;
    end: number;
    total: number;
    hasNext: boolean;
}

export interface EventsResponse {
    data: PredictEvent[];
    pagination: PaginationInfo;
}

export type Category = "all" | "crypto" | "sports" | "politics" | "esports" | "culture" | "economics" | "tech";
export type SortBy = "volume" | "beginAt";
export type SortDirection = "asc" | "desc";
export type Filter = "new" | "live" | "trending";

export interface FetchEventsParams {
    includeMarkets?: boolean;
    start?: number;
    end?: number;
    category?: Category;
    subcategory?: string;
    sortBy?: SortBy;
    sortDirection?: SortDirection;
    filter?: Filter;
}

const API_BASE = "https://prediction-market-api.jup.ag/api/v1";
const CACHE_KEY = "whispmarket_events_cache";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Cache structure
interface CacheData {
    events: Map<string, PredictEvent>;
    markets: Map<string, Market>;
    lastUpdated: number;
}

// In-memory cache
let memoryCache: CacheData = {
    events: new Map(),
    markets: new Map(),
    lastUpdated: 0,
};

// Load cache from localStorage
function loadCache(): void {
    if (typeof window === "undefined") return;
    try {
        const stored = localStorage.getItem(CACHE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            memoryCache = {
                events: new Map(Object.entries(parsed.events || {})),
                markets: new Map(Object.entries(parsed.markets || {})),
                lastUpdated: parsed.lastUpdated || 0,
            };
        }
    } catch (e) {
        console.warn("Failed to load cache:", e);
    }
}

// Save cache to localStorage
function saveCache(): void {
    if (typeof window === "undefined") return;
    try {
        const toStore = {
            events: Object.fromEntries(memoryCache.events),
            markets: Object.fromEntries(memoryCache.markets),
            lastUpdated: memoryCache.lastUpdated,
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(toStore));
    } catch (e) {
        console.warn("Failed to save cache:", e);
    }
}

// Initialize cache on module load
if (typeof window !== "undefined") {
    loadCache();
}

// Cache an event and its markets
function cacheEvent(event: PredictEvent): void {
    memoryCache.events.set(event.eventId, event);
    if (event.markets) {
        for (const market of event.markets) {
            memoryCache.markets.set(market.marketId, market);
        }
    }
}

// Get cached event
export function getCachedEvent(eventId: string): PredictEvent | undefined {
    return memoryCache.events.get(eventId);
}

// Get cached market
export function getCachedMarket(marketId: string): Market | undefined {
    return memoryCache.markets.get(marketId);
}

// Get all cached events
export function getAllCachedEvents(): PredictEvent[] {
    return Array.from(memoryCache.events.values());
}

// Fetch events with caching
export async function fetchEvents(params: FetchEventsParams = {}): Promise<EventsResponse> {
    const searchParams = new URLSearchParams();

    if (params.includeMarkets !== undefined) {
        searchParams.set("includeMarkets", String(params.includeMarkets));
    }
    if (params.start !== undefined) searchParams.set("start", String(params.start));
    if (params.end !== undefined) searchParams.set("end", String(params.end));
    if (params.category && params.category !== "all") searchParams.set("category", params.category);
    if (params.subcategory) searchParams.set("subcategory", params.subcategory);
    if (params.sortBy) searchParams.set("sortBy", params.sortBy);
    if (params.sortDirection) searchParams.set("sortDirection", params.sortDirection);
    if (params.filter) searchParams.set("filter", params.filter);

    const res = await fetch(`${API_BASE}/events?${searchParams.toString()}`);
    if (!res.ok) throw new Error("Failed to fetch events");

    const response: EventsResponse = await res.json();

    // Cache all fetched events, respecting local knowledge of settlement
    for (const event of response.data) {
        if (event.markets) {
            for (let i = 0; i < event.markets.length; i++) {
                const market = event.markets[i];
                const cached = memoryCache.markets.get(market.marketId);

                // If we know locally that the market is closed/settled (e.g. from portfolio check),
                // or if the closeTime has passed, override API status
                const now = Date.now();
                let closeTime = market.closeTime || market.metadata?.closeTime;
                if (closeTime && closeTime < 1000000000000) closeTime *= 1000; // Convert seconds to ms
                const isExpired = closeTime ? closeTime < now : false;

                if ((cached && cached.status === "closed" && market.status === "open") || (market.status === "open" && isExpired)) {
                    console.log(`[Sync] Overriding stale/expired API status for market ${market.marketId}: open -> closed`);
                    event.markets[i] = {
                        ...market,
                        status: "closed",
                        result: cached?.result || market.result
                    };
                }
            }
        }
        cacheEvent(event);
    }
    memoryCache.lastUpdated = Date.now();
    saveCache();

    return response;
}

// Fetch all events across all categories and cache them for settlement
const ALL_CATEGORIES: Category[] = ["crypto", "sports", "politics", "esports", "culture", "economics", "tech"];

export async function fetchAllEvents(): Promise<PredictEvent[]> {
    const promises = ALL_CATEGORIES.map(async (category) => {
        try {
            const [batch1, batch2] = await Promise.all([
                fetchEvents({
                    includeMarkets: true,
                    category,
                    start: 0,
                    end: 99,
                    sortBy: "volume",
                    sortDirection: "desc",
                }),
                fetchEvents({
                    includeMarkets: true,
                    category,
                    start: 100,
                    end: 199,
                    sortBy: "volume",
                    sortDirection: "desc",
                })
            ]);
            return [...batch1.data, ...batch2.data];
        } catch (e) {
            console.error(`Failed to fetch ${category} events:`, e);
            return [];
        }
    });

    const results = await Promise.all(promises);
    const allEvents = results.flat();

    console.log(`[Cache] Loaded ${allEvents.length} events across ${ALL_CATEGORIES.length} categories`);
    return allEvents;
}

// Search events from cache (local/offline)
export function searchEvents(query: string): PredictEvent[] {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return Array.from(memoryCache.events.values()).filter(event =>
        (event.metadata?.title?.toLowerCase().includes(q) ||
            event.metadata?.subtitle?.toLowerCase().includes(q) ||
            event.category?.toLowerCase().includes(q)) &&
        // Ensure strictly active markets only (matches home page filter)
        event.isActive &&
        event.markets?.some(m => {
            if (m.status !== "open") return false;

            // Check close time to prevent stale cache showing settled markets
            const now = Date.now();
            let closeTime = m.closeTime || m.metadata?.closeTime;
            if (closeTime) {
                if (closeTime < 1000000000000) closeTime *= 1000; // Convert seconds to ms
                if (closeTime < now) return false;
            }
            return true;
        })
    );
}

// Search events via API (server-side, better quality)
export interface SearchEventsParams {
    query: string;
    limit?: number; // 1-20, default varies
}

export async function searchEventsAPI(params: SearchEventsParams): Promise<PredictEvent[]> {
    if (!params.query.trim()) return [];

    const searchParams = new URLSearchParams();
    searchParams.set("query", params.query);
    if (params.limit !== undefined) {
        searchParams.set("limit", String(Math.min(20, Math.max(1, params.limit))));
    }

    const res = await fetch(`${API_BASE}/events/search?${searchParams.toString()}`, {
        headers: { Accept: "*/*" }
    });
    if (!res.ok) throw new Error("Failed to search events");

    const response: { data: PredictEvent[] } = await res.json();

    // Cache results
    for (const event of response.data) {
        cacheEvent(event);
    }
    saveCache();

    return response.data;
}

// Fetch a single event by ID
export async function fetchEvent(eventId: string, includeMarkets: boolean = true): Promise<PredictEvent> {
    const searchParams = new URLSearchParams();
    if (includeMarkets) {
        searchParams.set("includeMarkets", "true");
    }

    const res = await fetch(`${API_BASE}/events/${eventId}?${searchParams.toString()}`);
    if (!res.ok) {
        if (res.status === 404) throw new Error(`Event not found: ${eventId}`);
        throw new Error("Failed to fetch event");
    }

    const event: PredictEvent = await res.json();
    cacheEvent(event);
    saveCache();

    return event;
}

// Fetch suggested events for a user based on their order activity
export async function fetchSuggestedEvents(pubkey: string): Promise<PredictEvent[]> {
    const res = await fetch(`${API_BASE}/events/suggested/${pubkey}`);
    if (!res.ok) throw new Error("Failed to fetch suggested events");

    const response: { data: PredictEvent[] } = await res.json();

    // Cache results
    for (const event of response.data) {
        cacheEvent(event);
    }
    saveCache();

    return response.data;
}

// Fetch markets for an event with pagination
export interface FetchEventMarketsParams {
    eventId: string;
    start?: number;
    end?: number;
}

export interface EventMarketsResponse {
    data: Market[];
    pagination: PaginationInfo;
}

export async function fetchEventMarkets(params: FetchEventMarketsParams): Promise<EventMarketsResponse> {
    const searchParams = new URLSearchParams();
    if (params.start !== undefined) searchParams.set("start", String(params.start));
    if (params.end !== undefined) searchParams.set("end", String(params.end));

    const res = await fetch(`${API_BASE}/events/${params.eventId}/markets?${searchParams.toString()}`);
    if (!res.ok) throw new Error("Failed to fetch event markets");

    const response: EventMarketsResponse = await res.json();

    // Cache markets
    for (const market of response.data) {
        memoryCache.markets.set(market.marketId, market);
    }
    saveCache();

    return response;
}

// Fetch a specific market within an event
export async function fetchEventMarket(eventId: string, marketId: string): Promise<Market> {
    const res = await fetch(`${API_BASE}/events/${eventId}/markets/${marketId}`);
    if (!res.ok) {
        if (res.status === 404) throw new Error(`Market not found: ${marketId}`);
        throw new Error("Failed to fetch market");
    }

    const market: Market = await res.json();
    memoryCache.markets.set(marketId, market);
    saveCache();

    return market;
}

// Fetch a single market with caching
export async function fetchMarket(marketId: string): Promise<Market> {
    // Try cache first
    const cached = getCachedMarket(marketId);
    if (cached && Date.now() - memoryCache.lastUpdated < CACHE_TTL) {
        return cached;
    }

    const res = await fetch(`${API_BASE}/markets/${marketId}`);
    if (!res.ok) throw new Error("Failed to fetch market");

    const market: Market = await res.json();
    memoryCache.markets.set(marketId, market);
    saveCache();

    return market;
}

// Fetch fresh market data (bypass cache)
export async function fetchMarketFresh(marketId: string): Promise<Market> {
    const res = await fetch(`${API_BASE}/markets/${marketId}`);
    if (!res.ok) throw new Error("Failed to fetch market");

    const market: Market = await res.json();
    memoryCache.markets.set(marketId, market);
    saveCache();

    return market;
}

// Clear cache
export function clearCache(): void {
    memoryCache = {
        events: new Map(),
        markets: new Map(),
        lastUpdated: 0,
    };
    if (typeof window !== "undefined") {
        localStorage.removeItem(CACHE_KEY);
    }
}

// Format price from micro-units to percentage
export function formatPrice(price: number | null): string {
    if (price === null) return "—";
    return `${(price / 10000).toFixed(1)}%`;
}

// Format USD volume - API returns values in micro-units (divide by 1M for USD)
export function formatVolume(volumeUsd: string | number): string {
    const rawVol = typeof volumeUsd === "string" ? parseInt(volumeUsd) : volumeUsd;
    // Convert from micro-units to USD
    const vol = rawVol / 1_000_000;

    if (vol >= 1_000_000_000) {
        return `$${(vol / 1_000_000_000).toFixed(1)}B`;
    }
    if (vol >= 1_000_000) {
        return `$${(vol / 1_000_000).toFixed(1)}M`;
    }
    if (vol >= 1_000) {
        return `$${(vol / 1_000).toFixed(1)}K`;
    }
    return `$${vol.toFixed(0)}`;
}

// Get category color
export function getCategoryColor(category: string): string {
    const colors: Record<string, string> = {
        crypto: "#f7931a",
        sports: "#10b981",
        politics: "#6366f1",
        esports: "#ec4899",
        culture: "#8b5cf6",
        economics: "#06b6d4",
        tech: "#3b82f6",
    };
    return colors[category] || "#6b7280";
}
