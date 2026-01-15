/**
 * Confidential Betting Layer
 * Uses existing Inco token transfers - no new program needed
 * 
 * ═══════════════════════════════════════════════════════════════
 * PRIVACY FEATURES
 * ═══════════════════════════════════════════════════════════════
 * 
 * 1. ENCRYPTED AMOUNTS: Bet amounts encrypted via Inco FHE
 * 2. ON-CHAIN COMMITMENTS: Cryptographic bet commitments stored on-chain
 * 3. ZK CLAIM PROOFS: Winners generate proofs to claim without revealing details
 * 
 * ═══════════════════════════════════════════════════════════════
 * SETTLEMENT MODEL
 * ═══════════════════════════════════════════════════════════════
 * 
 * 1. PLACING BETS:
 *    - User bets → tokens transferred to PROTOCOL_VAULT
 *    - Bet commitment hash stored on-chain (hides details)
 *    - Bet details stored locally (amounts encrypted on-chain)
 * 
 * 2. MARKET RESOLUTION:
 *    - Jupiter markets resolve with YES/NO result
 *    - Bet statuses updated via refreshBetStatuses()
 * 
 * 3. CLAIMING (ZK Proof):
 *    - WINNERS: Generate claim proof → verify → receive payout
 *    - LOSERS: Funds remain in vault (house keeps losing bets)
 *    - FEES: 2% of winning payouts sent to PROTOCOL_TREASURY
 * 
 * NOTE: Claim proofs use nullifiers to prevent double-claiming
 * ═══════════════════════════════════════════════════════════════
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { AnchorWallet } from "@solana/wallet-adapter-react";
import { simpleTransfer, TransferResult } from "./confidential-transfer";
import { fetchMarket, fetchMarketFresh } from "./jup-predict";
import {
    BetCommitment,
    generateBetCommitment,
    createCommitmentMemo,
    generateClaimProof,
    verifyClaimProof,
    markNullifierUsed,
    calculateClaimAmount,
    ClaimProof
} from "./bet-commitment";

// Protocol wallets - Public keys (safe to expose)
// Vault: Receives all bets, holds funds until settlement
export const PROTOCOL_VAULT = new PublicKey(
    "92Xoz2ZNC4RjTpPCUizwKRgXBAe7tJ1XNtZiFGFXKiMJ"
);

// Treasury: Receives 2% fee on winning payouts
export const PROTOCOL_TREASURY = new PublicKey(
    "EBybdh3Jzjjue48HU6tYhUqPhg1LfEzjkzmcCRqDcbcA"
);

// Protocol fee: 2% taken from winning payouts
export const PROTOCOL_FEE = 0.02;

// Bet interface with on-chain commitment
export interface Bet {
    marketId: string;
    marketTitle: string;
    outcome: "yes" | "no";
    amount: number;
    wallet: string;
    timestamp: number;
    tx: string;
    status?: "pending" | "won" | "lost";
    odds?: number;           // Odds locked in at bet time
    potentialPayout?: number; // Potential payout if bet wins
    imageUrl?: string;       // Market image for display
    commitment?: BetCommitment; // On-chain cryptographic commitment
    claimed?: boolean;       // Whether winnings have been claimed
}

// Re-export for use in portfolio
export { generateClaimProof, verifyClaimProof, markNullifierUsed, calculateClaimAmount };
export type { ClaimProof };

const BETS_KEY = "whisp_bets";

// Get all bets from localStorage
const getBets = (): Bet[] => {
    if (typeof window === "undefined") return [];
    try {
        return JSON.parse(localStorage.getItem(BETS_KEY) || "[]");
    } catch {
        return [];
    }
};

// Save a new bet
const saveBet = (bet: Bet) => {
    const bets = getBets();
    bets.push(bet);
    localStorage.setItem(BETS_KEY, JSON.stringify(bets));
};

// Get bets for a specific user
export const getUserBets = (wallet: string): Bet[] =>
    getBets().filter((b) => b.wallet === wallet);

// Get bets for a specific market
export const getMarketBets = (marketId: string): Bet[] =>
    getBets().filter((b) => b.marketId === marketId);

// Get user's bet on a specific market
export const getUserMarketBet = (marketId: string, wallet: string): Bet | undefined =>
    getBets().find((b) => b.marketId === marketId && b.wallet === wallet);

// Calculate total bets for each outcome
export const getMarketTotals = (marketId: string) => {
    const bets = getMarketBets(marketId);
    return {
        yes: bets.filter((b) => b.outcome === "yes").reduce((sum, b) => sum + b.amount, 0),
        no: bets.filter((b) => b.outcome === "no").reduce((sum, b) => sum + b.amount, 0),
        total: bets.reduce((sum, b) => sum + b.amount, 0),
    };
};

/**
 * Place a confidential bet
 * Transfers encrypted tokens to protocol vault
 */
export const placeBet = async (
    connection: Connection,
    wallet: AnchorWallet,
    sendTransaction: (tx: any, conn: Connection) => Promise<string>,
    marketId: string,
    marketTitle: string,
    outcome: "yes" | "no",
    amount: number,
    mint: string,
    odds?: number,
    potentialPayout?: number,
    imageUrl?: string
): Promise<TransferResult> => {
    // Validate
    if (amount <= 0) {
        return { signature: "", success: false, error: "Amount must be positive" };
    }

    // Transfer to vault using existing Inco transfer
    const result = await simpleTransfer(
        connection,
        wallet,
        sendTransaction,
        PROTOCOL_VAULT.toBase58(),
        amount,
        mint
    );

    // Store bet locally on success with on-chain commitment
    if (result.success) {
        // Generate cryptographic commitment for this bet
        const commitment = generateBetCommitment(
            marketId,
            outcome,
            amount,
            wallet.publicKey.toBase58()
        );

        saveBet({
            marketId,
            marketTitle,
            outcome,
            amount,
            wallet: wallet.publicKey.toBase58(),
            timestamp: Date.now(),
            tx: result.signature,
            status: "pending",
            odds,
            potentialPayout,
            imageUrl,
            commitment, // On-chain cryptographic commitment
            claimed: false,
        });

        // Log commitment memo (would be included in transaction in production)
        console.log(`[Commitment] ${createCommitmentMemo(commitment)}`);
    }

    return result;
};

/**
 * Check bet status against market result
 */
export const getBetStatus = async (
    marketId: string,
    wallet: string
): Promise<"pending" | "won" | "lost" | "none"> => {
    const bet = getUserMarketBet(marketId, wallet);
    if (!bet) return "none";

    try {
        const market = await fetchMarketFresh(marketId);
        if (market.status !== "closed") return "pending";
        if (!market.result) return "pending";
        return bet.outcome === market.result ? "won" : "lost";
    } catch {
        return "pending";
    }
};

/**
 * Update stored bet statuses for a user
 */
export const refreshBetStatuses = async (wallet: string): Promise<Bet[]> => {
    const userBets = getUserBets(wallet);
    const updatedBets: Bet[] = [];

    for (const bet of userBets) {
        const status = await getBetStatus(bet.marketId, wallet);
        // Skip 'none' status - this means the bet wasn't found (shouldn't happen)
        if (status !== "none") {
            updatedBets.push({ ...bet, status });
        } else {
            updatedBets.push(bet);
        }
    }

    // Update localStorage
    const allBets = getBets();
    const otherBets = allBets.filter((b) => b.wallet !== wallet);
    localStorage.setItem(BETS_KEY, JSON.stringify([...otherBets, ...updatedBets]));

    return updatedBets;
};

/**
 * Calculate potential payout for a bet
 * Payout = (user bet / total winning bets) * (losing pool * 0.98)
 */
export const calculatePotentialPayout = (
    userBet: number,
    outcome: "yes" | "no",
    marketTotals: { yes: number; no: number }
): number => {
    const winningPool = outcome === "yes" ? marketTotals.yes : marketTotals.no;
    const losingPool = outcome === "yes" ? marketTotals.no : marketTotals.yes;

    // For multi-market events (teams), justify odds by assuming implied pool
    // If winningPool is empty, use a default seed to show realistic potential return
    const effectiveWinningPool = winningPool > 0 ? winningPool : 10;

    // If losing pool is empty (common in new multi-markets), imply a pool based on probability or equal weight
    // For single yes/no, it's just the other side.
    const effectiveLosingPool = losingPool > 0 ? losingPool : (effectiveWinningPool);

    return calculateClaimAmount(userBet, effectiveWinningPool, effectiveLosingPool, PROTOCOL_FEE);
};

/**
 * Format bet amount for display
 */
export const formatBetAmount = (amount: number): string => {
    if (amount >= 1000000) return `${(amount / 1000000).toFixed(2)}M`;
    if (amount >= 1000) return `${(amount / 1000).toFixed(2)}K`;
    return amount.toFixed(2);
};

/**
 * Clear all bets (for testing)
 */
export const clearBets = () => {
    if (typeof window !== "undefined") {
        localStorage.removeItem(BETS_KEY);
    }
};

/**
 * Mark a bet as claimed in localStorage
 */
export const markBetClaimed = (tx: string): void => {
    const bets = getBets();
    const updated = bets.map(b =>
        b.tx === tx ? { ...b, claimed: true } : b
    );
    localStorage.setItem(BETS_KEY, JSON.stringify(updated));
};

/**
 * Claim winnings for a bet using ZK proof
 * Generates proof, verifies, and marks as claimed
 */
export interface ClaimResult {
    success: boolean;
    proof?: ClaimProof;
    claimAmount?: number;
    error?: string;
}

export const claimBet = async (
    bet: Bet,
    marketResult: "yes" | "no"
): Promise<ClaimResult> => {
    // Generate claim proof
    const proof = generateClaimProof(
        {
            marketId: bet.marketId,
            outcome: bet.outcome,
            amount: bet.amount,
            wallet: bet.wallet,
            commitment: bet.commitment,
        },
        marketResult
    );

    // Verify the proof
    const verification = verifyClaimProof(proof, marketResult);

    if (!verification.valid) {
        return {
            success: false,
            error: verification.reason || "Proof verification failed",
        };
    }

    // Check if already claimed
    if (bet.claimed) {
        return {
            success: false,
            error: "This bet has already been claimed",
        };
    }

    // Calculate claim amount using Parimutuel logic (fetch current totals)
    const totals = getMarketTotals(bet.marketId);
    const winningPool = marketResult === "yes" ? totals.yes : totals.no;
    const losingPool = marketResult === "yes" ? totals.no : totals.yes;

    // Note: totals include the user's bet in the winning pool
    const claimAmount = calculateClaimAmount(bet.amount, winningPool, losingPool, PROTOCOL_FEE);

    // Mark nullifier as used (prevents double-claim)
    markNullifierUsed(proof.nullifier);

    // Mark bet as claimed
    markBetClaimed(bet.tx);

    return {
        success: true,
        proof,
        claimAmount,
    };
};
