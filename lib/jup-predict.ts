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

// Data provider type (Jupiter is the sole provider)
export type DataProvider = "jup";

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
    provider?: DataProvider;
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

export type Category = "all" | "crypto" | "sports" | "politics" | "economics";
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

// Load cache from localStorage (lightweight index only)
function loadCache(): void {
    if (typeof window === "undefined") return;
    try {
        const stored = localStorage.getItem(CACHE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            // Only restore lightweight data - full data comes from API
            memoryCache.lastUpdated = parsed.lastUpdated || 0;
            console.log(`[Cache] Loaded index with ${parsed.eventCount || 0} events from localStorage`);
        }
    } catch (e) {
        console.warn("[Cache] Failed to load cache:", e);
    }
}

// Save lightweight cache index to localStorage (just metadata, not full market data)
function saveCache(): void {
    if (typeof window === "undefined") return;

    // Only save if we have a reasonable amount of data (avoid spamming on each fetch)
    if (memoryCache.events.size === 0) return;

    try {
        // Store only a lightweight index with essential search fields
        const lightweightIndex = {
            lastUpdated: memoryCache.lastUpdated,
            eventCount: memoryCache.events.size,
            marketCount: memoryCache.markets.size,
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(lightweightIndex));
    } catch (e) {
        // Silently fail for localStorage - memory cache is what matters
        // This prevents QuotaExceededError spam in console
    }
}

// Initialize cache on module load
if (typeof window !== "undefined") {
    loadCache();
}

// Cache an event and its markets (memory only - the important cache)
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
const ALL_CATEGORIES: Category[] = ["crypto", "sports", "politics", "economics"];

// Configuration for fetching - optimized for maximum coverage
const BATCH_SIZE = 100; // Events per API request (0-99 = 100 events)
const MAX_EVENTS_PER_CATEGORY = 300; // Maximum events to fetch per category (balanced for speed)
const MAX_CONCURRENT_REQUESTS = 4; // Concurrent category fetches (Jupiter API handles this well)
const QUICK_FETCH_PER_CATEGORY = 100; // Events per category for initial quick load

// Check if cache is still fresh
export function isCacheFresh(): boolean {
    return memoryCache.events.size > 0 && Date.now() - memoryCache.lastUpdated < CACHE_TTL;
}

// Get cache stats for debugging
export function getCacheStats(): { events: number; markets: number; age: number } {
    return {
        events: memoryCache.events.size,
        markets: memoryCache.markets.size,
        age: Math.round((Date.now() - memoryCache.lastUpdated) / 1000),
    };
}

// Helper: delay between requests
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: fetch with retry and exponential backoff
async function fetchWithRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
): Promise<T> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxRetries - 1) throw error;
            const waitTime = baseDelay * Math.pow(2, attempt);
            console.log(`[API] Retry ${attempt + 1}/${maxRetries} after ${waitTime}ms...`);
            await delay(waitTime);
        }
    }
    throw new Error("Unreachable");
}

// Fetch events for a single category with pagination
async function fetchCategoryEventsDeep(
    category: Category,
    maxEvents: number = MAX_EVENTS_PER_CATEGORY
): Promise<PredictEvent[]> {
    const allCategoryEvents: PredictEvent[] = [];
    let start = 0;
    let hasMore = true;
    let totalAvailable = 0;

    while (hasMore && allCategoryEvents.length < maxEvents) {
        const end = Math.min(start + BATCH_SIZE - 1, start + (maxEvents - allCategoryEvents.length) - 1);

        try {
            const response = await fetchWithRetry(() =>
                fetchEvents({
                    includeMarkets: true,
                    category,
                    start,
                    end,
                    sortBy: "volume",
                    sortDirection: "desc",
                })
            );

            allCategoryEvents.push(...response.data);
            totalAvailable = response.pagination.total;
            hasMore = response.pagination.hasNext && allCategoryEvents.length < maxEvents;

            if (hasMore) {
                start = response.pagination.end + 1;
                // Small delay between paginated requests to be respectful
                await delay(100);
            }
        } catch (e) {
            console.error(`[${category}] Failed to fetch events at offset ${start}:`, e);
            break;
        }
    }

    console.log(`[Cache] ${category}: loaded ${allCategoryEvents.length}/${totalAvailable} events`);
    return allCategoryEvents;
}

// Main function: fetch all events across all categories (comprehensive)
export async function fetchAllEvents(): Promise<PredictEvent[]> {
    console.log(`[Cache] Starting comprehensive market fetch across ${ALL_CATEGORIES.length} categories...`);
    const startTime = Date.now();

    // Process categories in batches to limit concurrent requests
    const allEvents: PredictEvent[] = [];

    for (let i = 0; i < ALL_CATEGORIES.length; i += MAX_CONCURRENT_REQUESTS) {
        const categoryBatch = ALL_CATEGORIES.slice(i, i + MAX_CONCURRENT_REQUESTS);
        const batchPromises = categoryBatch.map(category => fetchCategoryEventsDeep(category));
        const batchResults = await Promise.all(batchPromises);
        allEvents.push(...batchResults.flat());
    }

    // Count total markets
    const totalMarkets = allEvents.reduce((sum, e) => sum + (e.markets?.length || 0), 0);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`[Cache] ✓ Loaded ${allEvents.length} events with ${totalMarkets} markets across ${ALL_CATEGORIES.length} categories in ${elapsed}s`);
    return allEvents;
}

// Quick fetch for UI - balanced for speed and coverage
export async function fetchEventsQuick(): Promise<PredictEvent[]> {
    // Return cached data if fresh
    if (isCacheFresh() && memoryCache.events.size > 100) {
        console.log(`[Cache] Quick load: returning ${memoryCache.events.size} cached events`);
        return Array.from(memoryCache.events.values());
    }

    console.log(`[Cache] Quick fetch: ${QUICK_FETCH_PER_CATEGORY} events per category...`);
    const startTime = Date.now();

    // Fetch all categories in parallel for speed
    const promises = ALL_CATEGORIES.map(async (category) => {
        try {
            const response = await fetchEvents({
                includeMarkets: true,
                category,
                start: 0,
                end: QUICK_FETCH_PER_CATEGORY - 1,
                sortBy: "volume",
                sortDirection: "desc",
            });
            return response.data;
        } catch (e) {
            console.error(`[Quick] Failed to fetch ${category}:`, e);
            return [];
        }
    });

    const results = await Promise.all(promises);
    const allEvents = results.flat();

    const totalMarkets = allEvents.reduce((sum, e) => sum + (e.markets?.length || 0), 0);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`[Cache] ✓ Quick load: ${allEvents.length} events with ${totalMarkets} markets in ${elapsed}s`);
    return allEvents;
}

// Deep fetch with custom limits (for testing/settlement)
export async function fetchEventsDeep(
    eventsPerCategory: number = 1000,
    categories: Category[] = ALL_CATEGORIES
): Promise<PredictEvent[]> {
    console.log(`[Cache] Deep fetch: up to ${eventsPerCategory} events per category across ${categories.length} categories...`);
    const startTime = Date.now();

    const allEvents: PredictEvent[] = [];

    for (let i = 0; i < categories.length; i += MAX_CONCURRENT_REQUESTS) {
        const categoryBatch = categories.slice(i, i + MAX_CONCURRENT_REQUESTS);
        const batchPromises = categoryBatch.map(category =>
            fetchCategoryEventsDeep(category, eventsPerCategory)
        );
        const batchResults = await Promise.all(batchPromises);
        allEvents.push(...batchResults.flat());
    }

    const totalMarkets = allEvents.reduce((sum, e) => sum + (e.markets?.length || 0), 0);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`[Cache] ✓ Deep fetch complete: ${allEvents.length} events with ${totalMarkets} markets in ${elapsed}s`);
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
