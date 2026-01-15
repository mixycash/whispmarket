/**
 * Rate-Limited RPC Connection Utilities
 * 
 * Solana devnet has strict rate limits (~40 req/10s for getProgramAccounts).
 * This module provides:
 * - Request throttling with exponential backoff
 * - Request deduplication (same call within window returns cached result)
 * - Global queue to prevent burst requests
 */

import { Connection, PublicKey, GetProgramAccountsFilter, Commitment } from "@solana/web3.js";

// Configuration
const RATE_LIMIT_WINDOW_MS = 1000; // 1 second window
const MAX_REQUESTS_PER_WINDOW = 4; // Conservative limit for devnet
const REQUEST_CACHE_TTL_MS = 5000; // Cache identical requests for 5 seconds
const RETRY_BASE_DELAY_MS = 500;
const MAX_RETRIES = 3;

// Request queue management
interface QueuedRequest {
    execute: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
    addedAt: number;
}

const requestQueue: QueuedRequest[] = [];
let requestsInWindow = 0;
let windowStart = Date.now();
let isProcessing = false;

// Request cache for deduplication (serialized key -> { result, timestamp })
const requestCache = new Map<string, { result: unknown; timestamp: number }>();

/**
 * Generate a cache key for a request
 */
function getCacheKey(method: string, ...args: unknown[]): string {
    try {
        return `${method}:${JSON.stringify(args)}`;
    } catch {
        return `${method}:${Date.now()}`; // Fallback for circular references
    }
}

/**
 * Check and update rate limit window
 */
function checkRateLimit(): boolean {
    const now = Date.now();
    if (now - windowStart > RATE_LIMIT_WINDOW_MS) {
        // New window
        windowStart = now;
        requestsInWindow = 0;
    }

    if (requestsInWindow < MAX_REQUESTS_PER_WINDOW) {
        requestsInWindow++;
        return true;
    }

    return false;
}

/**
 * Get delay until next available slot
 */
function getDelayUntilNextSlot(): number {
    const now = Date.now();
    const windowEnd = windowStart + RATE_LIMIT_WINDOW_MS;
    return Math.max(0, windowEnd - now + 50); // +50ms buffer
}

/**
 * Process the request queue
 */
async function processQueue(): Promise<void> {
    if (isProcessing || requestQueue.length === 0) return;

    isProcessing = true;

    while (requestQueue.length > 0) {
        if (!checkRateLimit()) {
            // Wait until next window
            const delay = getDelayUntilNextSlot();
            await sleep(delay);
            continue;
        }

        const request = requestQueue.shift();
        if (!request) continue;

        try {
            const result = await request.execute();
            request.resolve(result);
        } catch (error) {
            request.reject(error);
        }
    }

    isProcessing = false;
}

/**
 * Add a request to the queue
 */
function queueRequest<T>(execute: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        requestQueue.push({
            execute,
            resolve: resolve as (value: unknown) => void,
            reject,
            addedAt: Date.now(),
        });
        processQueue();
    });
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute with retry and exponential backoff
 */
async function withRetry<T>(
    fn: () => Promise<T>,
    retries = MAX_RETRIES
): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (error: unknown) {
            lastError = error;

            // Check if it's a rate limit error (429)
            const is429 = error instanceof Error &&
                (error.message.includes("429") ||
                    error.message.includes("Too many requests"));

            if (is429 && attempt < retries) {
                // Exponential backoff with jitter
                const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 200;
                console.warn(`[RPC] Rate limited (attempt ${attempt + 1}/${retries + 1}), waiting ${delay.toFixed(0)}ms...`);
                await sleep(delay);
                continue;
            }

            // If not a 429 or out of retries, throw
            if (attempt === retries) {
                throw lastError;
            }
        }
    }

    throw lastError;
}

/**
 * Rate-limited wrapper for getProgramAccounts
 * This is the most expensive RPC call and needs careful management
 */
export async function rateLimitedGetProgramAccounts(
    connection: Connection,
    programId: PublicKey,
    filters?: GetProgramAccountsFilter[],
    commitment?: Commitment
): Promise<Array<{ pubkey: PublicKey; account: { data: Buffer } }>> {
    const cacheKey = getCacheKey("getProgramAccounts", programId.toBase58(), filters);

    // Check cache first
    const cached = requestCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < REQUEST_CACHE_TTL_MS) {
        console.log("[RPC] Cache hit for getProgramAccounts");
        return cached.result as Array<{ pubkey: PublicKey; account: { data: Buffer } }>;
    }

    // Queue the request
    const result = await queueRequest(() =>
        withRetry(async () => {
            const accounts = await connection.getProgramAccounts(programId, {
                filters,
                commitment: commitment || "confirmed",
            });
            return accounts.map(acc => ({
                pubkey: acc.pubkey,
                account: { data: acc.account.data as Buffer },
            }));
        })
    );

    // Store in cache
    requestCache.set(cacheKey, { result, timestamp: Date.now() });

    // Cleanup old cache entries
    cleanupCache();

    return result;
}

/**
 * Rate-limited wrapper for getAccountInfo
 */
export async function rateLimitedGetAccountInfo(
    connection: Connection,
    address: PublicKey,
    commitment?: Commitment
): Promise<{ data: Buffer } | null> {
    const cacheKey = getCacheKey("getAccountInfo", address.toBase58());

    // Check cache first
    const cached = requestCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < REQUEST_CACHE_TTL_MS) {
        console.log("[RPC] Cache hit for getAccountInfo");
        return cached.result as { data: Buffer } | null;
    }

    // Queue the request
    const result = await queueRequest(() =>
        withRetry(async () => {
            const info = await connection.getAccountInfo(address, commitment || "confirmed");
            return info ? { data: info.data as Buffer } : null;
        })
    );

    // Store in cache
    requestCache.set(cacheKey, { result, timestamp: Date.now() });

    return result;
}

/**
 * Rate-limited wrapper for getBalance
 */
export async function rateLimitedGetBalance(
    connection: Connection,
    address: PublicKey,
    commitment?: Commitment
): Promise<number> {
    const cacheKey = getCacheKey("getBalance", address.toBase58());

    // Check cache first
    const cached = requestCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < REQUEST_CACHE_TTL_MS) {
        return cached.result as number;
    }

    const result = await queueRequest(() =>
        withRetry(async () => {
            return await connection.getBalance(address, commitment || "confirmed");
        })
    );

    requestCache.set(cacheKey, { result, timestamp: Date.now() });

    return result;
}

/**
 * Cleanup expired cache entries
 */
function cleanupCache(): void {
    const now = Date.now();
    for (const [key, value] of requestCache.entries()) {
        if (now - value.timestamp > REQUEST_CACHE_TTL_MS * 2) {
            requestCache.delete(key);
        }
    }
}

/**
 * Clear all cached data (useful when wallet changes)
 */
export function clearRpcCache(): void {
    requestCache.clear();
}

/**
 * Get current queue size (for debugging)
 */
export function getQueueSize(): number {
    return requestQueue.length;
}

/**
 * Get cache stats (for debugging)
 */
export function getCacheStats(): { size: number; requests: number; windowRemaining: number } {
    return {
        size: requestCache.size,
        requests: requestsInWindow,
        windowRemaining: Math.max(0, RATE_LIMIT_WINDOW_MS - (Date.now() - windowStart)),
    };
}
