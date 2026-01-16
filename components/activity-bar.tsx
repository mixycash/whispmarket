"use client";

import { useSolPrice } from "@/hooks/use-sol-price";

const ActivityBar = () => {
    const { solPrice, isLoading } = useSolPrice();

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
