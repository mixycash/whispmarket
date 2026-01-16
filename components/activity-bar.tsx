"use client";

import { useState, useEffect, useCallback } from "react";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUP_PRICE_API = `https://api.jup.ag/price/v3?ids=${SOL_MINT}`;
const API_KEY = "1854cb83-08f2-4604-982d-b5d2576630a2";

const ActivityBar = () => {
    const [solPrice, setSolPrice] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const fetchPrice = useCallback(async () => {
        try {
            const response = await fetch(JUP_PRICE_API, {
                headers: {
                    "x-api-key": API_KEY,
                },
                cache: "no-store",
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            const solData = data?.[SOL_MINT];

            if (solData?.usdPrice) {
                setSolPrice(Number(solData.usdPrice));
            }
        } catch (err) {
            console.error("[ActivityBar] Failed to fetch price:", err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchPrice();
        const interval = setInterval(fetchPrice, 30000);
        return () => clearInterval(interval);
    }, [fetchPrice]);

    const formatPrice = (price: number | null): string => {
        if (price === null) return "—";
        return `$${price.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        })}`;
    };

    return (
        <div className="activity-bar">
            <div className="activity-bar-content">
                {/* SOL Price - Left */}
                <div className="price-ticker">
                    <img
                        src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png"
                        alt="SOL"
                        className="price-ticker-icon"
                    />
                    <span className="price-ticker-symbol">SOL</span>
                    <span className={`price-ticker-value ${isLoading ? "loading" : ""}`}>
                        {isLoading ? "..." : formatPrice(solPrice)}
                    </span>
                </div>

                {/* Devnet Indicator - Right */}
                <div className="activity-network">
                    <span>Devnet</span>
                </div>
            </div>
        </div>
    );
};

export default ActivityBar;
