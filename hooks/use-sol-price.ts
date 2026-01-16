"use client";

import { useState, useEffect, useCallback } from "react";

interface UseSolPriceReturn {
    solPrice: number | null;
    isLoading: boolean;
    formatUsd: (solAmount: number) => string;
    formatSolWithUsd: (solAmount: number) => { sol: string; usd: string };
}

export function useSolPrice(): UseSolPriceReturn {
    const [solPrice, setSolPrice] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const fetchPrice = useCallback(async () => {
        try {
            const response = await fetch("/api/sol-price", {
                cache: "no-store",
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            if (data.price) {
                setSolPrice(data.price);
            }
        } catch (err) {
            console.error("[useSolPrice] Failed to fetch price:", err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchPrice();
        const interval = setInterval(fetchPrice, 30000);
        return () => clearInterval(interval);
    }, [fetchPrice]);

    const formatUsd = useCallback((solAmount: number): string => {
        if (solPrice === null || isNaN(solAmount)) return "—";
        const usdValue = solAmount * solPrice;
        return `$${usdValue.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        })}`;
    }, [solPrice]);

    const formatSolWithUsd = useCallback((solAmount: number): { sol: string; usd: string } => {
        return {
            sol: `${solAmount.toFixed(4)} SOL`,
            usd: formatUsd(solAmount),
        };
    }, [formatUsd]);

    return {
        solPrice,
        isLoading,
        formatUsd,
        formatSolWithUsd,
    };
}
