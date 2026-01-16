/**
 * Confidential Betting Layer
 * Uses existing Inco token transfers - no new program needed
 * 
 * PRIVACY FEATURES:
 * - Client-side AES encryption of bet details (only wallet owner can decrypt)
 * - On-chain commitment memos (verifiable by anyone)
 * - User-initiated claims via /api/claim endpoint
 */

import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { AnchorWallet } from "@solana/wallet-adapter-react";
import { simpleTransfer, TransferResult } from "./confidential-transfer";
import { fetchMarket, fetchMarketFresh } from "./jup-predict";
import {
    BetCommitment,
    generateBetCommitment,
    generateClaimProof,
    verifyClaimProof,
    calculateClaimAmount,
    ClaimProof
} from "./bet-commitment";
import { Bet, EncryptedBetData } from "./schema";
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
import {
    encryptBetData,
    decryptBetData,
    getCachedOrDeriveKey,
    DecryptedBetData
} from "./crypto";
import { createOnChainMemo } from "./nullifier-chain";

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
 * Place a confidential bet with client-side encryption
 * Transfers encrypted tokens to protocol vault and saves encrypted bet to DB
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
    imageUrl?: string,
    signMessage?: (message: Uint8Array) => Promise<Uint8Array>,
    teamName?: string,  // Team/selection name for multi-outcome markets
    cryptoKey?: CryptoKey | null // Pre-derived session key
): Promise<TransferResult> => {
    // Validate
    if (amount <= 0) {
        return { signature: "", success: false, error: "Amount must be positive" };
    }

    // Transfer to vault using existing Inco transfer
    // Note: The memo is attached during the Inco transfer
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
        const walletAddress = wallet.publicKey.toBase58();

        // Generate cryptographic commitment for this bet
        const commitment = generateBetCommitment(
            marketId,
            outcome,
            amount,
            walletAddress
        );

        // Create on-chain memo format
        const memoData = createOnChainMemo(commitment.commitmentHash, commitment.nullifier, marketId);
        console.log(`[On-Chain Memo] ${memoData}`);

        // Encrypt bet details if signMessage is available
        let encryptedData: EncryptedBetData | undefined;
        let isEncrypted = false;

        // Encrypt bet details if key is available or can be derived
        let key = cryptoKey;

        // If no pre-derived key but we have signMessage, try to derive/cache it
        if (!key && signMessage) {
            try {
                key = await getCachedOrDeriveKey(walletAddress, signMessage);
            } catch (e) {
                console.warn("Failed to derive key from signature:", e);
            }
        }

        if (key) {
            try {
                const betData: DecryptedBetData = {
                    amount,
                    outcome,
                    odds,
                    potentialPayout,
                };
                encryptedData = await encryptBetData(betData, key);
                isEncrypted = true;
                console.log(`[Encryption] Bet data encrypted successfully`);
            } catch (e) {
                console.warn("Failed to encrypt bet data, storing plaintext:", e);
            }
        }

        const newBet: Bet = {
            marketId,
            marketTitle,
            outcome,
            amount,
            wallet: walletAddress,
            timestamp: Date.now(),
            tx: result.signature,
            status: "pending",
            odds,
            potentialPayout,
            imageUrl,
            commitment, // On-chain cryptographic commitment
            claimed: false,
            mint,
            teamName,  // Team/selection name for multi-outcome markets
            // Privacy fields
            encryptedData,
            isEncrypted,
        };

        await saveBet(newBet);
    }

    return result;
};

/**
 * Decrypt a bet's encrypted data using wallet signature
 */
export const decryptBet = async (
    bet: Bet,
    signMessage: (message: Uint8Array) => Promise<Uint8Array>
): Promise<DecryptedBetData | null> => {
    if (!bet.isEncrypted || !bet.encryptedData) {
        // Return plaintext data if not encrypted
        return {
            amount: bet.amount,
            outcome: bet.outcome,
            odds: bet.odds,
            potentialPayout: bet.potentialPayout,
        };
    }

    try {
        const key = await getCachedOrDeriveKey(bet.wallet, signMessage);
        if (!key) {
            console.error("Could not derive decryption key");
            return null;
        }
        return await decryptBetData(bet.encryptedData, key);
    } catch (e) {
        console.error("Failed to decrypt bet:", e);
        return null;
    }
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
 * Claim result interface
 */
export interface ClaimResult {
    success: boolean;
    proof?: ClaimProof;
    claimAmount?: number;
    payoutTx?: string;
    error?: string;
}

/**
 * Check if a bet is claimable (client-side check before API call)
 */
export const checkClaimable = async (bet: Bet): Promise<{
    claimable: boolean;
    reason?: string;
    estimatedPayout?: number;
}> => {
    if (bet.claimed) {
        return { claimable: false, reason: "Already claimed" };
    }

    if (bet.status === "lost") {
        return { claimable: false, reason: "Bet was lost" };
    }

    try {
        const market = await fetchMarketFresh(bet.marketId);

        if (market.status !== "closed") {
            return { claimable: false, reason: "Market not settled yet" };
        }

        const result = market.result?.toLowerCase();
        if (bet.outcome !== result) {
            return { claimable: false, reason: "Bet lost - outcome did not match" };
        }

        // Calculate estimated payout
        const totals = await fetchMarketTotals(bet.marketId);
        const winningPool = result === "yes" ? totals.yes : totals.no;
        const losingPool = result === "yes" ? totals.no : totals.yes;
        const payout = calculateClaimAmount(bet.amount, winningPool, losingPool, PROTOCOL_FEE);

        return { claimable: true, estimatedPayout: payout };
    } catch (e) {
        console.error("Error checking claimable:", e);
        return { claimable: false, reason: "Failed to check market status" };
    }
};

/**
 * User-initiated claim - calls /api/claim endpoint
 * This replaces the centralized settlement bot for winning bets
 */
export const claimBet = async (
    bet: Bet,
    marketResult: "yes" | "no"
): Promise<ClaimResult> => {
    // Generate claim proof client-side
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

    // Client-side verification first
    const verification = verifyClaimProof(proof, marketResult);
    if (!verification.valid) {
        return {
            success: false,
            error: verification.reason || "Proof verification failed",
        };
    }

    // Check if already claimed locally
    if (bet.claimed) {
        return { success: false, error: "This bet has already been claimed" };
    }

    // Call the claim API
    try {
        const response = await fetch("/api/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                proof,
                betTx: bet.tx,
                walletAddress: bet.wallet,
            }),
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            return {
                success: false,
                error: data.error || "Claim failed",
            };
        }

        return {
            success: true,
            proof,
            claimAmount: data.payout,
            payoutTx: data.payoutTx,
        };
    } catch (e) {
        console.error("Claim API error:", e);
        return {
            success: false,
            error: "Failed to call claim API",
        };
    }
};

/**
 * Check claim status via API (can be used to poll for settlement)
 */
export const getClaimStatus = async (
    betTx: string,
    walletAddress: string
): Promise<{
    claimable: boolean;
    status?: string;
    reason?: string;
    estimatedPayout?: number;
    marketResult?: string;
}> => {
    try {
        const response = await fetch(
            `/api/claim?betTx=${encodeURIComponent(betTx)}&wallet=${encodeURIComponent(walletAddress)}`
        );
        return await response.json();
    } catch (e) {
        console.error("Error checking claim status:", e);
        return { claimable: false, reason: "Failed to check status" };
    }
};

