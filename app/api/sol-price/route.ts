import { NextResponse } from "next/server";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUP_PRICE_API = `https://api.jup.ag/price/v3?ids=${SOL_MINT}`;

export async function GET() {
    try {
        const apiKey = process.env.JUP_API_KEY || "";

        const response = await fetch(JUP_PRICE_API, {
            headers: apiKey ? { "x-api-key": apiKey } : {},
            next: { revalidate: 30 }, // Cache for 30 seconds
        });

        if (!response.ok) {
            return NextResponse.json(
                { error: "Failed to fetch price" },
                { status: response.status }
            );
        }

        const data = await response.json();
        const solData = data?.[SOL_MINT];

        if (!solData?.usdPrice) {
            return NextResponse.json(
                { error: "Price not available" },
                { status: 404 }
            );
        }

        return NextResponse.json({
            price: Number(solData.usdPrice),
            timestamp: Date.now(),
        });
    } catch (error) {
        console.error("[sol-price] Error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
