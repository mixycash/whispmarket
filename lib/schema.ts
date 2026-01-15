
export interface BetCommitment {
    commitmentHash: string;
    nullifier: string;
    timestamp: number;
}

export interface ClaimProof {
    commitmentHash: string;
    nullifier: string;
    marketId: string;
    outcome: "yes" | "no";
    amount: number;
    signature: string;
    claimable: boolean;
}

export interface Bet {
    marketId: string;
    marketTitle: string;
    outcome: "yes" | "no";
    amount: number;
    wallet: string;
    timestamp: number;
    tx: string;
    status: string; // "pending" | "won" | "lost" | "none" but keeping string for DB compatibility
    odds?: number;
    potentialPayout?: number;
    image_url?: string; // Using snake_case for consistency? No, interface uses camelCase.
    imageUrl?: string;
    commitment?: BetCommitment;
    claimed?: boolean;
    mint?: string;
}

