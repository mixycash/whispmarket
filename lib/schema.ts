
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

/**
 * Encrypted bet data - server only sees this encrypted blob
 * Only the user's wallet can decrypt to reveal amount/outcome
 */
export interface EncryptedBetData {
    ciphertext: string;     // Base64 encrypted JSON of {amount, outcome, odds, potentialPayout}
    iv: string;             // Initialization vector for AES-GCM
    salt: string;           // Salt for key derivation
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
    // Team/selection name for multi-outcome markets (sports, esports, etc.)
    teamName?: string;  // e.g., "Miami Heat", "Team Liquid" - shown instead of YES/NO
    // Privacy-enhanced fields
    encryptedData?: EncryptedBetData;  // Client-encrypted bet details
    isEncrypted?: boolean;              // Flag indicating data is encrypted
}

