/**
 * On-Chain Nullifier Tracking via Memo Parsing
 * 
 * Instead of localStorage, we track nullifiers by parsing
 * transaction memos from the PROTOCOL_VAULT address.
 * This is trustless and verifiable by anyone.
 */

import { Connection, PublicKey, ParsedTransactionWithMeta } from "@solana/web3.js";
import { PROTOCOL_VAULT } from "./protocol";

// Memo program ID
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

// Protocol memo prefix
const MEMO_PREFIX = "WM:";

export interface OnChainCommitment {
    commitmentHash: string;
    nullifier: string;
    marketId: string;
    txSignature: string;
    timestamp: number;
}

// Cache for on-chain nullifiers
let nullifierCache: Set<string> = new Set();
let lastFetchTime = 0;
const CACHE_TTL = 30_000; // 30 seconds

/**
 * Parse a WhispMarket memo from transaction data
 */
function parseMemo(memoData: string): Partial<OnChainCommitment> | null {
    try {
        // Format: WM:{"v":1,"c":"hash","n":"nullifier","m":"marketId"}
        if (!memoData.startsWith(MEMO_PREFIX)) return null;

        const jsonPart = memoData.slice(MEMO_PREFIX.length);
        const parsed = JSON.parse(jsonPart);

        if (parsed.v !== 1) return null;

        return {
            commitmentHash: parsed.c,
            nullifier: parsed.n,
            marketId: parsed.m,
        };
    } catch {
        // Try legacy format: WM:hash16:nullifier16
        if (memoData.startsWith(MEMO_PREFIX)) {
            const parts = memoData.split(":");
            if (parts.length === 3) {
                return {
                    commitmentHash: parts[1],
                    nullifier: parts[2],
                };
            }
        }
        return null;
    }
}

/**
 * Fetch all nullifiers from on-chain memos for PROTOCOL_VAULT
 */
export async function fetchOnChainNullifiers(
    connection: Connection,
    forceRefresh = false
): Promise<Set<string>> {
    const now = Date.now();

    // Return cached if fresh
    if (!forceRefresh && now - lastFetchTime < CACHE_TTL && nullifierCache.size > 0) {
        return nullifierCache;
    }

    try {
        // Fetch recent transactions to PROTOCOL_VAULT
        const signatures = await connection.getSignaturesForAddress(
            PROTOCOL_VAULT,
            { limit: 500 }, // Last 500 transactions
            "confirmed"
        );

        const txSignatures = signatures.map(s => s.signature);

        // Fetch transaction details in batches
        const batchSize = 50;
        const nullifiers = new Set<string>();

        for (let i = 0; i < txSignatures.length; i += batchSize) {
            const batch = txSignatures.slice(i, i + batchSize);
            const transactions = await connection.getParsedTransactions(batch, {
                maxSupportedTransactionVersion: 0,
            });

            for (const tx of transactions) {
                if (!tx?.meta?.logMessages) continue;

                // Look for memo program logs
                for (const log of tx.meta.logMessages) {
                    if (log.includes("Program log: Memo")) {
                        // Extract memo data from log
                        const match = log.match(/Memo \(len \d+\): "(.+)"/);
                        if (match) {
                            const parsed = parseMemo(match[1]);
                            if (parsed?.nullifier) {
                                nullifiers.add(parsed.nullifier);
                            }
                        }
                    }
                }

                // Also check instruction data for memo program
                if (tx.transaction?.message?.instructions) {
                    for (const ix of tx.transaction.message.instructions) {
                        if ('programId' in ix && ix.programId.equals(MEMO_PROGRAM_ID)) {
                            // This is a memo instruction
                            if ('data' in ix && typeof ix.data === 'string') {
                                const parsed = parseMemo(ix.data);
                                if (parsed?.nullifier) {
                                    nullifiers.add(parsed.nullifier);
                                }
                            }
                        }
                    }
                }
            }
        }

        nullifierCache = nullifiers;
        lastFetchTime = now;

        console.log(`Fetched ${nullifiers.size} on-chain nullifiers`);
        return nullifiers;

    } catch (e) {
        console.error("Error fetching on-chain nullifiers:", e);
        return nullifierCache; // Return stale cache on error
    }
}

/**
 * Check if a nullifier exists on-chain
 */
export async function isNullifierUsedOnChain(
    connection: Connection,
    nullifier: string
): Promise<boolean> {
    const nullifiers = await fetchOnChainNullifiers(connection);
    return nullifiers.has(nullifier);
}

/**
 * Verify a bet commitment exists on-chain
 */
export async function verifyCommitmentOnChain(
    connection: Connection,
    commitmentHash: string
): Promise<{ found: boolean; txSignature?: string }> {
    try {
        const signatures = await connection.getSignaturesForAddress(
            PROTOCOL_VAULT,
            { limit: 200 },
            "confirmed"
        );

        for (const sig of signatures) {
            const tx = await connection.getParsedTransaction(sig.signature, {
                maxSupportedTransactionVersion: 0,
            });

            if (!tx?.meta?.logMessages) continue;

            for (const log of tx.meta.logMessages) {
                if (log.includes(commitmentHash.slice(0, 16))) {
                    return { found: true, txSignature: sig.signature };
                }
            }
        }

        return { found: false };
    } catch (e) {
        console.error("Error verifying commitment:", e);
        return { found: false };
    }
}

/**
 * Create memo data for on-chain commitment
 */
export function createOnChainMemo(
    commitmentHash: string,
    nullifier: string,
    marketId: string
): string {
    return `${MEMO_PREFIX}${JSON.stringify({
        v: 1,
        c: commitmentHash,
        n: nullifier,
        m: marketId.slice(0, 8),
    })}`;
}

/**
 * Force refresh the nullifier cache
 */
export async function refreshNullifierCache(connection: Connection): Promise<void> {
    await fetchOnChainNullifiers(connection, true);
}
