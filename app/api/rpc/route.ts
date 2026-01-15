import { NextRequest, NextResponse } from "next/server";

// Server-side only - API key never exposed to client
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const NETWORK = process.env.NEXT_PUBLIC_NETWORK || "devnet";

const RPC_URL = HELIUS_API_KEY
    ? `https://${NETWORK}.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
    : `https://api.${NETWORK}.solana.com`;

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        const response = await fetch(RPC_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error("RPC proxy error:", error);
        return NextResponse.json(
            { error: "RPC request failed" },
            { status: 500 }
        );
    }
}

export async function GET() {
    return NextResponse.json({
        network: NETWORK,
        hasHelius: !!HELIUS_API_KEY,
    });
}
