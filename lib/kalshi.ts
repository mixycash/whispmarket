/**
 * Kalshi API Client
 * Direct integration with Kalshi prediction markets API
 * 
 * API Docs: https://docs.kalshi.com/api-reference
 * Note: Read-only endpoints are public and don't require authentication
 */

// API Configuration - using the public trading API
const KALSHI_API_BASE = "https://api.elections.kalshi.com/trade-api/v2";

// Types matching Kalshi API response structure
export interface KalshiMarket {
    ticker: string;
    event_ticker: string;
    market_type: "binary" | "multi";
    title: string;
    subtitle: string;
    yes_sub_title?: string;
    no_sub_title?: string;
    created_time: string;
    open_time: string;
    close_time: string;
    expiration_time: string;
    status: "initialized" | "open" | "active" | "closed" | "settled";
    yes_bid: number;
    yes_bid_dollars?: string;
    yes_ask: number;
    yes_ask_dollars?: string;
    no_bid: number;
    no_bid_dollars?: string;
    no_ask: number;
    no_ask_dollars?: string;
    last_price: number;
    last_price_dollars?: string;
    volume: number;
    volume_fp?: string;
    volume_24h: number;
    volume_24h_fp?: string;
    result?: "yes" | "no" | "void" | "";
    open_interest: number;
    open_interest_fp?: string;
    liquidity: number;
    liquidity_dollars?: string;
    rules_primary?: string;
    rules_secondary?: string;
    can_close_early: boolean;
}

export interface KalshiEvent {
    event_ticker: string;
    series_ticker: string;
    sub_title: string;
    title: string;
    category: string;
    mutually_exclusive: boolean;
    strike_date?: string;
    strike_period?: string;
    markets: KalshiMarket[];
}

export interface KalshiEventsResponse {
    events: KalshiEvent[];
    cursor?: string;
}

export interface KalshiMarketsResponse {
    markets: KalshiMarket[];
    cursor?: string;
}

export interface KalshiSeries {
    ticker: string;
    title: string;
    category: string;
    tags?: string[];
    frequency?: string;
}

export interface KalshiSeriesResponse {
    series: KalshiSeries[];
}

// Cache structure
interface KalshiCacheData {
    events: Map<string, KalshiEvent>;
    markets: Map<string, KalshiMarket>;
    lastUpdated: number;
}

let kalshiCache: KalshiCacheData = {
    events: new Map(),
    markets: new Map(),
    lastUpdated: 0,
};

const CACHE_TTL = 60 * 1000; // 1 minute

/**
 * Make request to Kalshi public API (no auth required for read endpoints)
 */
async function kalshiRequest<T>(path: string): Promise<T> {
    const url = `${KALSHI_API_BASE}${path}`;

    console.log(`[Kalshi] Fetching: ${path}`);

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
        },
        // Don't cache on server
        cache: 'no-store',
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Kalshi] API error ${response.status}:`, errorText);
        throw new Error(`Kalshi API error: ${response.status} - ${errorText}`);
    }

    return response.json();
}

/**
 * Fetch events from Kalshi (public endpoint)
 */
export async function fetchKalshiEvents(params?: {
    limit?: number;
    cursor?: string;
    status?: "open" | "closed" | "settled";
    with_nested_markets?: boolean;
}): Promise<KalshiEventsResponse> {
    const searchParams = new URLSearchParams();

    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.cursor) searchParams.set('cursor', params.cursor);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.with_nested_markets !== false) searchParams.set('with_nested_markets', 'true');

    const path = `/events${searchParams.toString() ? '?' + searchParams.toString() : ''}`;
    const response = await kalshiRequest<KalshiEventsResponse>(path);

    // Cache events
    if (response.events) {
        for (const event of response.events) {
            kalshiCache.events.set(event.event_ticker, event);
            if (event.markets) {
                for (const market of event.markets) {
                    kalshiCache.markets.set(market.ticker, market);
                }
            }
        }
        kalshiCache.lastUpdated = Date.now();
    }

    console.log(`[Kalshi] Fetched ${response.events?.length || 0} events`);
    return response;
}

/**
 * Fetch single event by ticker
 */
export async function fetchKalshiEvent(eventTicker: string): Promise<KalshiEvent> {
    const cached = kalshiCache.events.get(eventTicker);
    if (cached && Date.now() - kalshiCache.lastUpdated < CACHE_TTL) {
        return cached;
    }

    const response = await kalshiRequest<{ event: KalshiEvent }>(`/events/${eventTicker}`);

    kalshiCache.events.set(eventTicker, response.event);
    if (response.event.markets) {
        for (const market of response.event.markets) {
            kalshiCache.markets.set(market.ticker, market);
        }
    }

    return response.event;
}

/**
 * Fetch markets from Kalshi (public endpoint)
 */
export async function fetchKalshiMarkets(params?: {
    limit?: number;
    cursor?: string;
    event_ticker?: string;
    status?: "open" | "closed" | "settled";
}): Promise<KalshiMarketsResponse> {
    const searchParams = new URLSearchParams();

    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.cursor) searchParams.set('cursor', params.cursor);
    if (params?.event_ticker) searchParams.set('event_ticker', params.event_ticker);
    if (params?.status) searchParams.set('status', params.status);

    const path = `/markets${searchParams.toString() ? '?' + searchParams.toString() : ''}`;
    const response = await kalshiRequest<KalshiMarketsResponse>(path);

    if (response.markets) {
        for (const market of response.markets) {
            kalshiCache.markets.set(market.ticker, market);
        }
        kalshiCache.lastUpdated = Date.now();
    }

    return response;
}

/**
 * Fetch single market by ticker
 */
export async function fetchKalshiMarket(ticker: string): Promise<KalshiMarket> {
    const cached = kalshiCache.markets.get(ticker);
    if (cached && Date.now() - kalshiCache.lastUpdated < CACHE_TTL) {
        return cached;
    }

    const response = await kalshiRequest<{ market: KalshiMarket }>(`/markets/${ticker}`);
    kalshiCache.markets.set(ticker, response.market);

    return response.market;
}

/**
 * Fetch all events with pagination
 */
export async function fetchAllKalshiEvents(maxEvents: number = 200): Promise<KalshiEvent[]> {
    console.log('[Kalshi] Starting comprehensive fetch...');
    const startTime = Date.now();

    const allEvents: KalshiEvent[] = [];
    let cursor: string | undefined;

    while (allEvents.length < maxEvents) {
        try {
            const response = await fetchKalshiEvents({
                limit: 100,
                cursor,
                with_nested_markets: true,
            });

            if (!response.events || response.events.length === 0) {
                break;
            }

            allEvents.push(...response.events);

            if (!response.cursor) {
                break;
            }

            cursor = response.cursor;

            // Small delay to avoid rate limiting
            await new Promise(r => setTimeout(r, 200));
        } catch (e) {
            console.error('[Kalshi] Error fetching events:', e);
            break;
        }
    }

    const totalMarkets = allEvents.reduce((sum, e) => sum + (e.markets?.length || 0), 0);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`[Kalshi] ✓ Loaded ${allEvents.length} events with ${totalMarkets} markets in ${elapsed}s`);

    return allEvents;
}

/**
 * Fetch series by category
 */
export async function fetchKalshiSeriesByCategory(category: string): Promise<KalshiSeries[]> {
    const path = `/series?category=${encodeURIComponent(category)}`;
    const response = await kalshiRequest<KalshiSeriesResponse>(path);
    return response.series || [];
}

/**
 * Fetch events for a specific series
 */
export async function fetchEventsBySeries(seriesTicker: string): Promise<KalshiEvent[]> {
    const response = await fetchKalshiEvents({
        limit: 100,
        with_nested_markets: true,
    });

    // Filter events by series ticker
    return (response.events || []).filter(e => e.series_ticker === seriesTicker);
}

/**
 * Comprehensive multi-category fetch - ensures full coverage of Sports, Crypto, Culture, Tech, etc.
 */
export async function fetchAllKalshiEventsByCategory(): Promise<KalshiEvent[]> {
    console.log('[Kalshi] Starting comprehensive multi-category fetch...');
    const startTime = Date.now();

    // Kalshi's main categories - fetch series for categories with sparse representation
    const categoriesToFetch = ['Sports', 'Crypto', 'Entertainment', 'Tech & Science'];

    const allEvents: KalshiEvent[] = [];
    const seenEventIds = new Set<string>();

    // First, do a general fetch to get the most popular/recent events
    try {
        const generalResponse = await fetchKalshiEvents({
            limit: 200,
            with_nested_markets: true,
        });

        for (const event of generalResponse.events || []) {
            if (!seenEventIds.has(event.event_ticker)) {
                seenEventIds.add(event.event_ticker);
                allEvents.push(event);
            }
        }
        console.log(`[Kalshi] General fetch: ${generalResponse.events?.length || 0} events`);
    } catch (e) {
        console.error('[Kalshi] Error in general fetch:', e);
    }

    // Then fetch series for each category to find additional events
    for (const category of categoriesToFetch) {
        try {
            const series = await fetchKalshiSeriesByCategory(category);
            console.log(`[Kalshi] ${category}: found ${series.length} series`);

            // For each series, try to fetch its events (limit to top 10 series to avoid too many requests)
            const topSeries = series.slice(0, 10);

            for (const s of topSeries) {
                try {
                    const seriesResponse = await kalshiRequest<KalshiEventsResponse>(
                        `/events?series_ticker=${s.ticker}&limit=50&with_nested_markets=true`
                    );

                    for (const event of seriesResponse.events || []) {
                        if (!seenEventIds.has(event.event_ticker)) {
                            seenEventIds.add(event.event_ticker);
                            allEvents.push(event);
                        }
                    }

                    // Small delay between requests
                    await new Promise(r => setTimeout(r, 100));
                } catch (e) {
                    // Continue if one series fetch fails
                }
            }
        } catch (e) {
            console.error(`[Kalshi] Error fetching ${category} series:`, e);
        }
    }

    // Cache all events
    for (const event of allEvents) {
        kalshiCache.events.set(event.event_ticker, event);
        if (event.markets) {
            for (const market of event.markets) {
                kalshiCache.markets.set(market.ticker, market);
            }
        }
    }
    kalshiCache.lastUpdated = Date.now();

    const totalMarkets = allEvents.reduce((sum, e) => sum + (e.markets?.length || 0), 0);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`[Kalshi] ✓ Comprehensive fetch complete: ${allEvents.length} events with ${totalMarkets} markets in ${elapsed}s`);

    return allEvents;
}

/**
 * Get cached events
 */
export function getCachedKalshiEvents(): KalshiEvent[] {
    return Array.from(kalshiCache.events.values());
}

/**
 * Get cached market
 */
export function getCachedKalshiMarket(ticker: string): KalshiMarket | undefined {
    return kalshiCache.markets.get(ticker);
}

/**
 * Convert Kalshi event to unified PredictEvent format
 */
export function kalshiEventToUnified(event: KalshiEvent): import('./jup-predict').PredictEvent {
    const markets = event.markets?.map(m => {
        // For multi-option markets, use yes_sub_title as the display name (e.g., candidate name)
        // Otherwise fall back to market title
        const displayTitle = m.yes_sub_title || m.title;
        const isMultiOption = event.mutually_exclusive && event.markets && event.markets.length > 1;

        return {
            marketId: m.ticker,
            event: event.event_ticker,
            // Kalshi uses 'active' for open markets
            status: (m.status === 'open' || m.status === 'active' ? 'open' : 'closed') as "open" | "closed",
            result: m.result || '',
            openTime: new Date(m.open_time).getTime(),
            closeTime: new Date(m.close_time).getTime(),
            settlementTime: new Date(m.expiration_time).getTime(),
            metadata: {
                marketId: m.ticker,
                // Use the candidate/option name for multi-option markets
                title: isMultiOption ? displayTitle : m.title,
                subtitle: m.subtitle || m.yes_sub_title,
                description: m.rules_primary,
                status: m.status,
                result: m.result,
                closeTime: new Date(m.close_time).getTime(),
                openTime: new Date(m.open_time).getTime(),
                settlementTime: new Date(m.expiration_time).getTime(),
                isTradable: m.status === 'active' || m.status === 'open',
                rulesPrimary: m.rules_primary,
            },
            pricing: {
                // Kalshi prices are in cents (0-100), Jupiter uses micros (0-1000000)
                // Convert Kalshi cents to Jupiter-style (multiply by 10000)
                buyYesPriceUsd: (m.yes_ask || 0) * 10000,
                buyNoPriceUsd: (m.no_ask || 0) * 10000,
                sellYesPriceUsd: (m.yes_bid || 0) * 10000,
                sellNoPriceUsd: (m.no_bid || 0) * 10000,
                volume: m.volume || 0,
                volume24h: m.volume_24h || 0,
                openInterest: m.open_interest || 0,
                liquidityDollars: m.liquidity || 0,
            },
        };
    }) || [];

    // Calculate total volume from all markets
    const totalVolume = markets.reduce((sum, m) => sum + (m.pricing.volume || 0), 0);

    // Smart category detection based on event title/content keywords
    const detectCategory = (title: string, kalshiCategory: string): string => {
        const lowerTitle = title.toLowerCase();

        // Crypto keywords - use word boundaries to avoid false positives
        if (/\bbitcoin\b|\bbtc\b|\bethereum\b|\beth\b|\bcrypto\b|\bsolana\b|\bdoge\b|\bdogecoin\b|\bxrp\b|\baltcoin\b|\bdefi\b|\bnft\b|\bblockchain\b|\bcoinbase\b|\bbinance\b|\bstablecoin\b|\busdc\b|\busdt\b|\btether\b/i.test(lowerTitle)) {
            return 'crypto';
        }

        // Sports keywords - expanded for better coverage
        if (/nfl|nba|mlb|nhl|mls|ncaa|cfp|college football|pro football|super bowl|world cup|champions league|premier league|serie a|la liga|bundesliga|stanley cup|afcon|football|basketball|baseball|hockey|soccer|tennis|golf|boxing|ufc|mma|olympics|f1|formula 1|nascar|pga|wimbledon|us open|world series|playoffs|finals|championship|head coach|quarterback|mvp|draft pick|all-star|bowl game|march madness/i.test(lowerTitle)) {
            return 'sports';
        }

        // Esports keywords
        if (/esports|e-sports|league of legends|lol|dota|valorant|csgo|cs2|counter-strike|overwatch|fortnite|apex legends|call of duty|cod|pubg|rocket league|twitch|gaming tournament|worlds 2|major championship/i.test(lowerTitle)) {
            return 'esports';
        }

        // Tech & Companies keywords - includes specific company names
        if (/ai\b|artificial intelligence|gpt|openai|chatgpt|anthropic|claude|apple|google|microsoft|amazon|meta|facebook|tesla|nvidia|spacex|starship|ramp|brex|stripe|iphone|android|software|startup|ipo|tech company|machine learning|robot|self-driving|autonomous|semiconductor|chip|processor/i.test(lowerTitle)) {
            return 'tech';
        }

        // Culture & Entertainment keywords
        if (/oscar|grammy|emmy|golden globe|movie|film|album|music|artist|celebrity|kardashian|taylor swift|drake|kanye|beyonce|netflix|disney|hbo|box office|billboard|concert|tour|award show|reality tv|bachelor|survivor|james bond|rambo|cast as|next.*theme/i.test(lowerTitle)) {
            return 'culture';
        }

        // Climate keywords - new category
        if (/climate|global warming|temperature|celsius|degrees|carbon|emissions|hurricane|tornado|earthquake|volcano|wildfire|drought|flood|sea level|arctic|glacier|renewable|solar|wind energy|fossil fuel/i.test(lowerTitle)) {
            return 'economics'; // Map climate to economics for now
        }

        // Politics keywords - for SCOTUS, legislation, etc.
        if (/scotus|supreme court|congress|senate|house|legislation|bill|law|vote|election|president|governor|mayor|cabinet|attorney general|secretary|ambassador|treaty|sanctions|tariff|impeach/i.test(lowerTitle)) {
            return 'politics';
        }

        // Economics/Fed keywords
        if (/fed|federal reserve|interest rate|inflation|gdp|unemployment|jobs report|powell|yellen|treasury|recession|cpi|pce|fomc|rate cut|rate hike|basis points/i.test(lowerTitle)) {
            return 'economics';
        }

        // Fall back to Kalshi's category mapping
        const categoryMap: Record<string, string> = {
            'Economics': 'economics',
            'Politics': 'politics',
            'Entertainment': 'culture',
            'Tech & Science': 'tech',
            'Climate & Weather': 'economics',
            'Climate': 'economics',
            'Financials': 'economics',
            'Sports': 'sports',
            'Health': 'economics',
            'Companies': 'tech',
            'Mentions': 'culture',
            'Science': 'tech',
            'AI': 'tech',
            'Crypto': 'crypto',
            'World': 'politics',
            'Culture': 'culture',
            'Elections': 'politics',
            'Fed': 'economics',
            'Inflation': 'economics',
            'Interest Rates': 'economics',
            'GDP': 'economics',
            'Employment': 'economics',
            'Weather': 'economics',
            'Natural Disasters': 'economics',
            'Space': 'tech',
            'Legislation': 'politics',
        };

        return categoryMap[kalshiCategory] || 'economics';
    };

    // Category-based placeholder images
    const categoryImages: Record<string, string> = {
        'politics': 'https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?w=200&h=200&fit=crop',
        'economics': 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=200&h=200&fit=crop',
        'sports': 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=200&h=200&fit=crop',
        'tech': 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=200&h=200&fit=crop',
        'culture': 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=200&h=200&fit=crop',
        'crypto': 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=200&h=200&fit=crop',
        'esports': 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=200&h=200&fit=crop',
    };

    const hasOpenMarket = markets.some(m => m.status === 'open');
    const firstMarket = event.markets?.[0];

    // Use smart category detection based on title
    const mappedCategory = detectCategory(event.title, event.category);

    return {
        eventId: event.event_ticker,
        series: event.series_ticker,
        isActive: hasOpenMarket,
        beginAt: firstMarket?.open_time || null,
        category: mappedCategory,
        subcategory: event.category,
        winner: '',
        metadata: {
            eventId: event.event_ticker,
            title: event.title,
            subtitle: event.sub_title,
            // Use category-based image for Kalshi events
            imageUrl: categoryImages[mappedCategory],
            isLive: hasOpenMarket,
        },
        markets,
        multipleWinners: event.mutually_exclusive,
        isLive: hasOpenMarket,
        tvlDollars: String(markets.reduce((sum, m) => sum + (m.pricing.openInterest || 0), 0) * 1000000),
        volumeUsd: String(totalVolume * 1000000),
        provider: 'kalshi' as const,
    };
}

/**
 * Clear Kalshi cache
 */
export function clearKalshiCache(): void {
    kalshiCache = {
        events: new Map(),
        markets: new Map(),
        lastUpdated: 0,
    };
}
