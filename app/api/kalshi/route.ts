/**
 * Kalshi API Proxy Route
 * Server-side route to fetch Kalshi data
 */

import { NextRequest, NextResponse } from "next/server";
import {
    fetchKalshiEvents,
    fetchKalshiMarkets,
    fetchKalshiEvent,
    fetchKalshiMarket,
    fetchAllKalshiEvents,
    fetchAllKalshiEventsByCategory,
    kalshiEventToUnified,
} from "@/lib/kalshi";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "events";

    console.log(`[Kalshi API Route] Action: ${action}`);

    try {
        switch (action) {
            case "events": {
                const limit = parseInt(searchParams.get("limit") || "100");
                const cursor = searchParams.get("cursor") || undefined;
                const status = searchParams.get("status") as "open" | "closed" | "settled" | undefined;
                const comprehensive = searchParams.get("comprehensive") === "true";

                console.log(`[Kalshi API Route] Fetching events, limit=${limit}, comprehensive=${comprehensive}`);

                // Use comprehensive fetch for better category coverage
                if (comprehensive) {
                    const events = await fetchAllKalshiEventsByCategory();
                    const unifiedEvents = events.map(kalshiEventToUnified);

                    return NextResponse.json({
                        success: true,
                        data: unifiedEvents,
                        count: unifiedEvents.length,
                        provider: "kalshi",
                    });
                }

                const response = await fetchKalshiEvents({
                    limit,
                    cursor,
                    status,
                    with_nested_markets: true,
                });

                // Convert to unified format
                const unifiedEvents = (response.events || []).map(kalshiEventToUnified);

                console.log(`[Kalshi API Route] Returning ${unifiedEvents.length} events`);

                return NextResponse.json({
                    success: true,
                    data: unifiedEvents,
                    cursor: response.cursor,
                    count: unifiedEvents.length,
                    provider: "kalshi",
                });
            }

            case "all-events":
            case "comprehensive-events": {
                console.log(`[Kalshi API Route] Fetching comprehensive events by category`);

                // Use comprehensive multi-category fetch for full coverage
                const events = await fetchAllKalshiEventsByCategory();
                const unifiedEvents = events.map(kalshiEventToUnified);

                console.log(`[Kalshi API Route] Returning ${unifiedEvents.length} total events`);

                return NextResponse.json({
                    success: true,
                    data: unifiedEvents,
                    count: unifiedEvents.length,
                    provider: "kalshi",
                });
            }

            case "markets": {
                const limit = parseInt(searchParams.get("limit") || "100");
                const cursor = searchParams.get("cursor") || undefined;
                const eventTicker = searchParams.get("event_ticker") || undefined;
                const status = searchParams.get("status") as "open" | "closed" | "settled" | undefined;

                const response = await fetchKalshiMarkets({
                    limit,
                    cursor,
                    event_ticker: eventTicker,
                    status,
                });

                return NextResponse.json({
                    success: true,
                    data: response.markets || [],
                    cursor: response.cursor,
                    provider: "kalshi",
                });
            }

            case "event": {
                const ticker = searchParams.get("ticker");
                if (!ticker) {
                    return NextResponse.json(
                        { success: false, error: "Missing ticker parameter" },
                        { status: 400 }
                    );
                }

                const event = await fetchKalshiEvent(ticker);
                const unified = kalshiEventToUnified(event);

                return NextResponse.json({
                    success: true,
                    data: unified,
                    provider: "kalshi",
                });
            }

            case "market": {
                const ticker = searchParams.get("ticker");
                if (!ticker) {
                    return NextResponse.json(
                        { success: false, error: "Missing ticker parameter" },
                        { status: 400 }
                    );
                }

                const market = await fetchKalshiMarket(ticker);

                return NextResponse.json({
                    success: true,
                    data: market,
                    provider: "kalshi",
                });
            }

            default:
                return NextResponse.json(
                    { success: false, error: `Unknown action: ${action}` },
                    { status: 400 }
                );
        }
    } catch (error) {
        console.error("[Kalshi API Route] Error:", error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : "Failed to fetch Kalshi data",
                data: [], // Return empty array so UI doesn't break
            },
            { status: 500 }
        );
    }
}
