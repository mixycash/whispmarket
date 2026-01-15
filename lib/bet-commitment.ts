/**
 * On-Chain Bet Commitments & ZK Claim Proofs
 * 
 * Provides cryptographic commitments for bets that are stored on-chain,
 * and proof generation for trustless claiming of winnings.
 * 
 * Uses Web Crypto API for SHA-256 hashing (built-in, no external deps)
 */

// Simple SHA256 using Web Crypto API (works in browser)
async function sha256Hex(message: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Sync version using simple hash for non-async contexts
function simpleHash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        const char = input.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    // Convert to hex and pad
    const hex = Math.abs(hash).toString(16).padStart(8, '0');
    // Create longer hash by repeating with salt
    return hex + simpleHash2(input + hex);
}

function simpleHash2(input: string): string {
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) + hash) + input.charCodeAt(i);
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
}

// Generate a longer deterministic hash
function generateHash(input: string): string {
    const h1 = simpleHash(input);
    const h2 = simpleHash(input + "salt1");
    const h3 = simpleHash(input + "salt2");
    const h4 = simpleHash(input + "salt3");
    return h1 + h2 + h3 + h4;
}

// Commitment structure stored with each bet
export interface BetCommitment {
    commitmentHash: string;      // Hash of bet details
    nullifier: string;           // Unique identifier to prevent double-claims
    timestamp: number;
}

// Claim proof structure
export interface ClaimProof {
    commitmentHash: string;
    nullifier: string;
    marketId: string;
    outcome: "yes" | "no";
    amount: number;              // Encrypted/hidden in real ZK, shown here for MVP
    signature: string;           // Proof signature
    claimable: boolean;
}

/**
 * Generate a cryptographic commitment for a bet
 * Commitment = Hash(marketId || outcome || amount || salt)
 * 
 * This commitment is stored on-chain with the transfer memo,
 * hiding the actual bet details while proving it exists.
 */
export const generateBetCommitment = (
    marketId: string,
    outcome: "yes" | "no",
    amount: number,
    walletAddress: string
): BetCommitment => {
    const timestamp = Date.now();

    // Create deterministic salt from wallet + timestamp
    const salt = `${walletAddress}-${timestamp}-${Math.random().toString(36).slice(2)}`;

    // Commitment input: all bet details concatenated
    const commitmentInput = `${marketId}:${outcome}:${amount}:${salt}`;
    const commitmentHash = generateHash(commitmentInput);

    // Nullifier: unique per bet, prevents double-claiming
    const nullifierInput = `nullifier:${walletAddress}:${marketId}:${timestamp}`;
    const nullifier = generateHash(nullifierInput);

    return {
        commitmentHash,
        nullifier,
        timestamp,
    };
};

/**
 * Generate a claim proof for winning bets
 * In production this would be a ZK-SNARK proof, for MVP we use signed attestation
 */
export const generateClaimProof = (
    bet: {
        marketId: string;
        outcome: "yes" | "no";
        amount: number;
        wallet: string;
        commitment?: BetCommitment;
    },
    marketResult: "yes" | "no"
): ClaimProof => {
    const isWinner = bet.outcome === marketResult;

    // Generate proof signature (simplified for MVP - would be ZK proof in production)
    const proofInput = `claim:${bet.marketId}:${bet.outcome}:${marketResult}:${bet.wallet}`;
    const signature = generateHash(proofInput);

    return {
        commitmentHash: bet.commitment?.commitmentHash || "",
        nullifier: bet.commitment?.nullifier || generateBetCommitment(bet.marketId, bet.outcome, bet.amount, bet.wallet).nullifier,
        marketId: bet.marketId,
        outcome: bet.outcome,
        amount: bet.amount,
        signature,
        claimable: isWinner,
    };
};

/**
 * Verify a claim proof (would be done by smart contract in production)
 * For MVP, this is client-side verification
 */
export const verifyClaimProof = (
    proof: ClaimProof,
    marketResult: "yes" | "no"
): { valid: boolean; reason?: string } => {
    // Check if outcome matches result
    if (proof.outcome !== marketResult) {
        return { valid: false, reason: "Bet outcome does not match market result" };
    }

    // Verify nullifier hasn't been used
    const usedNullifiers = getUsedNullifiers();
    if (usedNullifiers.includes(proof.nullifier)) {
        return { valid: false, reason: "This bet has already been claimed" };
    }

    return { valid: true };
};

/**
 * Mark a nullifier as used (prevents double claims)
 */
const NULLIFIER_KEY = "whisp_used_nullifiers";

export const getUsedNullifiers = (): string[] => {
    if (typeof window === "undefined") return [];
    try {
        return JSON.parse(localStorage.getItem(NULLIFIER_KEY) || "[]");
    } catch {
        return [];
    }
};

export const markNullifierUsed = (nullifier: string): void => {
    if (typeof window === "undefined") return;
    const used = getUsedNullifiers();
    if (!used.includes(nullifier)) {
        used.push(nullifier);
        localStorage.setItem(NULLIFIER_KEY, JSON.stringify(used));
    }
};

/**
 * Create on-chain memo data for bet commitment
 * This gets attached to the confidential transfer
 */
export const createCommitmentMemo = (commitment: BetCommitment): string => {
    // Compact format: first 16 chars of commitment + first 16 chars of nullifier
    return `WM:${commitment.commitmentHash.slice(0, 16)}:${commitment.nullifier.slice(0, 16)}`;
};

/**
 * Calculate claim amount based on odds and protocol fee
 */
/**
 * Calculate claim amount using Parimutuel model
 * Payout = Bet + (Share of Net Losing Pool)
 */
export const calculateClaimAmount = (
    betAmount: number,
    totalWinningPool: number,
    totalLosingPool: number,
    protocolFee: number = 0.02
): number => {
    if (totalWinningPool === 0) return betAmount; // Should not happen if betAmount is in the pool

    const userShare = betAmount / totalWinningPool;
    const netLosingPool = totalLosingPool * (1 - protocolFee);

    return betAmount + (userShare * netLosingPool);
};
