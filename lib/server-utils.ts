/**
 * Server-Side Utilities
 * 
 * Shared utilities for API routes and background jobs:
 * - Secret key parsing (supports JSON array and comma-separated formats)
 * - In-memory rate limiting for API protection
 */

import { Keypair } from "@solana/web3.js";

/**
 * Parse a secret key from environment variable
 * Supports both JSON array format: [1,2,3,...] 
 * And comma-separated format: 1,2,3,...
 * 
 * @param envKey - Name of the environment variable
 * @returns Keypair instance
 * @throws Error if env var is missing or invalid
 */
export function parseSecretKey(envKey: string): Keypair {
    const keyStr = process.env[envKey]?.trim();

    if (!keyStr) {
        throw new Error(`Environment variable ${envKey} is not set`);
    }

    try {
        let secretKeyArray: number[];

        if (keyStr.startsWith('[')) {
            // JSON array format: [1,2,3,...]
            secretKeyArray = JSON.parse(keyStr);
        } else {
            // Comma-separated format: 1,2,3,...
            secretKeyArray = keyStr.split(',').map(n => parseInt(n.trim(), 10));
        }

        // Validate array length (Solana secret keys are 64 bytes)
        if (secretKeyArray.length !== 64) {
            throw new Error(`Invalid secret key length: expected 64, got ${secretKeyArray.length}`);
        }

        // Validate all values are valid bytes
        if (secretKeyArray.some(n => isNaN(n) || n < 0 || n > 255)) {
            throw new Error(`Invalid byte values in secret key`);
        }

        return Keypair.fromSecretKey(Uint8Array.from(secretKeyArray));
    } catch (e) {
        if (e instanceof Error && e.message.startsWith('Environment variable')) {
            throw e;
        }
        throw new Error(`Failed to parse ${envKey}: ${e instanceof Error ? e.message : 'Invalid format'}`);
    }
}

/**
 * In-Memory Rate Limiter
 * 
 * Simple sliding window rate limiter for API protection.
 * For production with multiple instances, use Redis-based limiting.
 */
interface RateLimitEntry {
    count: number;
    windowStart: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupExpiredEntries(windowMs: number): void {
    const now = Date.now();
    if (now - lastCleanup < CLEANUP_INTERVAL) return;

    lastCleanup = now;
    for (const [key, entry] of rateLimitStore.entries()) {
        if (now - entry.windowStart > windowMs * 2) {
            rateLimitStore.delete(key);
        }
    }
}

export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetIn: number; // ms until window resets
}

/**
 * Check and update rate limit for a given key
 * 
 * @param key - Unique identifier (e.g., wallet address, IP)
 * @param maxRequests - Maximum requests allowed in window
 * @param windowMs - Time window in milliseconds
 * @returns RateLimitResult with allowed status and metadata
 */
export function checkRateLimit(
    key: string,
    maxRequests: number,
    windowMs: number
): RateLimitResult {
    const now = Date.now();
    cleanupExpiredEntries(windowMs);

    const entry = rateLimitStore.get(key);

    if (!entry || now - entry.windowStart >= windowMs) {
        // New window
        rateLimitStore.set(key, { count: 1, windowStart: now });
        return {
            allowed: true,
            remaining: maxRequests - 1,
            resetIn: windowMs,
        };
    }

    if (entry.count >= maxRequests) {
        // Rate limited
        return {
            allowed: false,
            remaining: 0,
            resetIn: windowMs - (now - entry.windowStart),
        };
    }

    // Increment count
    entry.count++;
    return {
        allowed: true,
        remaining: maxRequests - entry.count,
        resetIn: windowMs - (now - entry.windowStart),
    };
}

/**
 * Rate limit configuration presets
 */
export const RATE_LIMITS = {
    // 10 claims per minute per wallet
    CLAIM: { maxRequests: 10, windowMs: 60 * 1000 },
    // 5 deposits per minute per wallet
    DEPOSIT: { maxRequests: 5, windowMs: 60 * 1000 },
    // 20 status checks per minute per wallet
    STATUS: { maxRequests: 20, windowMs: 60 * 1000 },
} as const;
