/**
 * Confidential Betting Layer
 * Uses existing Inco token transfers - no new program needed
 * Refactored to use Server Actions for persistence (Neon Postgres)
 */

import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { AnchorWallet } from "@solana/wallet-adapter-react";
import { simpleTransfer, TransferResult } from "./confidential-transfer";
import { fetchMarket, fetchMarketFresh } from "./jup-predict";
import {
    BetCommitment,
    generateBetCommitment,
    createCommitmentMemo,
    generateClaimProof,
    verifyClaimProof,
    calculateClaimAmount,
    ClaimProof
} from "./bet-commitment";
import { Bet } from "./schema";
import {
    saveBet,
    getBets,
    getBetsByMarket,
    updateBetStatus,
    markNullifierUsed as markNullifierUsedServer,
    checkNullifierUsed,
    clearLostBets as clearLostBetsAction
} from "@/app/actions";
import { PROTOCOL_VAULT, PROTOCOL_FEE } from "./protocol";

// Re-export shared types and logic
export { generateClaimProof, verifyClaimProof, calculateClaimAmount };
export type { ClaimProof, Bet };

/**
 * Get bets for a specific user (Async)
 */
export const fetchUserBets = async (wallet: string): Promise<Bet[]> => {
    return getBets(wallet);
};

/**
 * Clear lost bets for a user (Async)
 */
export const clearLostBets = async (wallet: string): Promise<void> => {
    await clearLostBetsAction(wallet);
};


/**
 * Get bets for a specific market (Async)
 */
export const fetchMarketBets = async (marketId: string): Promise<Bet[]> => {
    return getBetsByMarket(marketId);
};

/**
 * Get user's bet on a specific market (Async)
 */
export const fetchUserMarketBet = async (marketId: string, wallet: string): Promise<Bet | undefined> => {
    const bets = await getBets(wallet);
    return bets.find((b) => b.marketId === marketId);
};

/**
 * Calculate total bets for each outcome (Async)
 */
export const fetchMarketTotals = async (marketId: string): Promise<{ yes: number; no: number; total: number }> => {
    const bets = await fetchMarketBets(marketId);
    return {
        yes: bets.filter((b) => b.outcome === "yes").reduce((sum, b) => sum + b.amount, 0),
        no: bets.filter((b) => b.outcome === "no").reduce((sum, b) => sum + b.amount, 0),
        total: bets.reduce((sum, b) => sum + b.amount, 0),
    };
};

/**
 * Place a confidential bet
 * Transfers encrypted tokens to protocol vault and saves to DB
 */
export const placeBet = async (
    connection: Connection,
    wallet: AnchorWallet,
    sendTransaction: (tx: Transaction, conn: Connection) => Promise<string>,
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

    // Store bet in DB on success
    if (result.success) {
        // Generate cryptographic commitment for this bet
        const commitment = generateBetCommitment(
            marketId,
            outcome,
            amount,
            wallet.publicKey.toBase58()
        );

        const newBet: Bet = {
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
            mint,
        };

        await saveBet(newBet);


        // Log commitment memo
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
    const bet = await fetchUserMarketBet(marketId, wallet);
    if (!bet) return "none";

    try {
        const market = await fetchMarketFresh(marketId);
        if (market.status !== "closed") return "pending";
        if (!market.result) return "pending";

        // Ensure result is yes/no
        const resultFormatted = market.result.toLowerCase();
        if (resultFormatted !== "yes" && resultFormatted !== "no") return "pending";

        return bet.outcome === resultFormatted ? "won" : "lost";
    } catch {
        return "pending";
    }
};

/**
 * Update stored bet statuses for a user
 */
export const refreshBetStatuses = async (wallet: string): Promise<Bet[]> => {
    const userBets = await fetchUserBets(wallet);
    const updatedBets: Bet[] = [];

    for (const bet of userBets) {
        // Optimize: Only check pending bets
        if (bet.status !== 'pending') {
            updatedBets.push(bet);
            continue;
        }

        try {
            const market = await fetchMarketFresh(bet.marketId);
            if (market.status === 'closed' && (market.result?.toLowerCase() === 'yes' || market.result?.toLowerCase() === 'no')) {
                const newStatus = bet.outcome === market.result.toLowerCase() ? 'won' : 'lost';
                await updateBetStatus(bet.tx, newStatus);
                updatedBets.push({ ...bet, status: newStatus });
            } else {
                updatedBets.push(bet);
            }
        } catch (e) {
            console.error(`Error refreshing status for bet ${bet.tx}:`, e);
            updatedBets.push(bet);
        }
    }

    return updatedBets;
};

/**
 * Calculate potential payout for a bet
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

// Deprecated or testing functions - functionality moved to server actions (remove or stub)
export const clearBets = () => {
    // No-op or call server? Server clear not implemented for safety.
    console.warn("clearBets is not supported with server persistence");
};

/**
 * Claim winnings for a bet using ZK proof
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

    // Verify the proof (Client side check)
    const verification = verifyClaimProof(proof, marketResult);

    if (!verification.valid) {
        return {
            success: false,
            error: verification.reason || "Proof verification failed",
        };
    }

    // Check if already claimed (Server check)
    if (bet.claimed) {
        return { success: false, error: "This bet has already been claimed" };
    }

    // Check nullifier on server
    const isUsed = await checkNullifierUsed(proof.nullifier);
    if (isUsed) {
        return { success: false, error: "This bet has already been claimed (nullifier used)" };
    }

    // Calculate claim amount using Parimutuel logic (fetch current totals)
    const totals = await fetchMarketTotals(bet.marketId);
    const winningPool = marketResult === "yes" ? totals.yes : totals.no;
    const losingPool = marketResult === "yes" ? totals.no : totals.yes;

    const claimAmount = calculateClaimAmount(bet.amount, winningPool, losingPool, PROTOCOL_FEE);

    // Mark nullifier as used
    await markNullifierUsedServer(proof.nullifier);

    // Mark bet as claimed
    await updateBetStatus(bet.tx, "won", true);

    return {
        success: true,
        proof,
        claimAmount,
    };
};
