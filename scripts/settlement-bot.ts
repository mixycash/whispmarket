
/**
 * Settlement Bot - BACKUP SYSTEM
 * 
 * This bot is a FALLBACK for bets that users haven't claimed.
 * Primary flow: Users claim via /api/claim endpoint
 * Backup flow: This bot auto-settles unclaimed winning bets after CLAIM_TIMEOUT
 * 
 * Privacy note: This bot still has visibility into bet outcomes.
 * For maximum privacy, users should claim their own winnings.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";

import { sql } from "../lib/db"; // Use relative path
import { Bet } from "../lib/schema";
import { fetchMarketFresh } from "../lib/jup-predict";
import { simpleTransfer } from "../lib/confidential-transfer";
import { PROTOCOL_VAULT, PROTOCOL_TREASURY, PROTOCOL_FEE } from "../lib/protocol";
import { calculateClaimAmount } from "../lib/bet-commitment";

// Claim timeout: How long to wait before auto-settling unclaimed bets (48 hours)
const CLAIM_TIMEOUT_MS = 48 * 60 * 60 * 1000;

// Check interval: How often to look for stale unclaimed bets
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// Polyfill for Wallet Adapter compatibility
interface AnchorWallet {
    publicKey: PublicKey;
    signTransaction<T extends Transaction | unknown>(transaction: T): Promise<T>;
    signAllTransactions<T extends Transaction | unknown>(transactions: T[]): Promise<T[]>;
}

class NodeWallet implements AnchorWallet {
    constructor(readonly payer: Keypair) { }

    get publicKey() {
        return this.payer.publicKey;
    }

    async signTransaction<T extends Transaction | unknown>(tx: T): Promise<T> {
        if (tx instanceof Transaction) {
            tx.sign(this.payer);
        } // VersionedTransaction handling if needed
        return tx;
    }

    async signAllTransactions<T extends Transaction | unknown>(txs: T[]): Promise<T[]> {
        return txs.map((t) => {
            if (t instanceof Transaction) {
                t.sign(this.payer);
            }
            return t;
        });
    }
}

// Helpers
async function getStaleUnclaimedBets(): Promise<Bet[]> {
    const cutoffTime = Date.now() - CLAIM_TIMEOUT_MS;
    try {
        // Fetch bets that:
        // 1. Have status 'won' (market settled)
        // 2. Are NOT claimed
        // 3. Were placed before the cutoff time
        // 4. Are NOT currently locked for claiming by user
        const rows = await sql`
            SELECT * FROM bets 
            WHERE status = 'won' 
            AND claimed = false 
            AND timestamp < ${cutoffTime}
            AND (claim_lock IS NULL OR claim_lock < ${Date.now() - 60000})
        `;
        return rows.map(mapRowToBet);
    } catch (e) {
        console.error("Error fetching stale unclaimed bets:", e);
        return [];
    }
}

async function getPendingBetsForSettlement(): Promise<Bet[]> {
    // Only get pending bets for markets that have closed
    try {
        const rows = await sql`SELECT * FROM bets WHERE status = 'pending'`;
        return rows.map(mapRowToBet);
    } catch (e) {
        console.error("Error fetching pending bets:", e);
        return [];
    }
}

async function getMarketBets(marketId: string): Promise<Bet[]> {
    try {
        const rows = await sql`SELECT * FROM bets WHERE market_id = ${marketId}`;
        return rows.map(mapRowToBet);
    } catch (e) { }
    return [];
}

function mapRowToBet(row: Record<string, unknown>): Bet {
    return {
        tx: row.tx as string,
        marketId: row.market_id as string,
        marketTitle: row.market_title as string,
        outcome: row.outcome as "yes" | "no",
        amount: Number(row.amount),
        wallet: row.wallet as string,
        timestamp: Number(row.timestamp),
        status: row.status as string,
        odds: row.odds ? Number(row.odds) : undefined,
        commitment: row.commitment as Bet["commitment"],
        claimed: row.claimed as boolean,
        mint: row.mint as string | undefined,
    };
}

async function updateBetStatus(tx: string, status: string, claimed: boolean = false) {
    await sql`UPDATE bets SET status = ${status}, claimed = ${claimed} WHERE tx = ${tx}`;
}

// Helper to queue failed treasury fee for retry
async function queueFailedFee(betTx: string, amount: number, mint: string, error: string) {
    try {
        await sql`
            INSERT INTO pending_fees (bet_tx, amount, mint, error, created_at, retry_count)
            VALUES (${betTx}, ${amount}, ${mint}, ${error}, ${Date.now()}, 0)
            ON CONFLICT (bet_tx) DO UPDATE SET
                retry_count = pending_fees.retry_count + 1,
                error = ${error},
                updated_at = ${Date.now()}
        `;
        console.log(`[Treasury Fee] Queued for retry: ${betTx}`);
    } catch (e) {
        console.error(`[Treasury Fee] Failed to queue for retry:`, e);
    }
}

// Main Logic
async function runBot() {
    console.log("==============================================");
    console.log("Starting Settlement Bot (BACKUP MODE)");
    console.log("==============================================");
    console.log("");
    console.log("NOTE: This bot is a BACKUP for users who haven't claimed.");
    console.log(`Auto-settle occurs ${CLAIM_TIMEOUT_MS / (60 * 60 * 1000)} hours after market settlement.`);
    console.log("Primary claims should go through /api/claim endpoint.");
    console.log("");

    // 1. Setup Connection & Wallet
    const connection = new Connection(
        process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com",
        "confirmed"
    );

    // Parse secret key
    if (!process.env.VAULT_SECRET_KEY) {
        throw new Error("VAULT_SECRET_KEY not found in env");
    }

    let secretKeyArray: number[];
    const keyStr = process.env.VAULT_SECRET_KEY.trim();
    if (keyStr.startsWith('[')) {
        secretKeyArray = JSON.parse(keyStr);
    } else {
        secretKeyArray = keyStr.split(',').map(n => parseInt(n.trim(), 10));
    }
    const secretKey = Uint8Array.from(secretKeyArray);
    const vaultKeypair = Keypair.fromSecretKey(secretKey);
    const vaultWallet = new NodeWallet(vaultKeypair);

    if (vaultKeypair.publicKey.toBase58() !== PROTOCOL_VAULT.toBase58()) {
        console.error("⚠️  Vault wallet public key mismatch!");
        console.error("Env:", vaultKeypair.publicKey.toBase58());
        console.error("Constant:", PROTOCOL_VAULT.toBase58());
    }

    console.log(`Bot running for Vault: ${vaultWallet.publicKey.toBase58()}`);
    console.log("");

    // Main Loop
    while (true) {
        try {
            console.log(`[${new Date().toISOString()}] Checking for settlements...`);

            // Phase 1: Update pending bets to won/lost based on market results
            await updateBetStatuses(connection);

            // Phase 2: Auto-payout stale unclaimed winning bets
            await autoPayoutStaleBets(connection, vaultWallet);

        } catch (e) {
            console.error("Bot Loop Error:", e);
        }

        // Wait before next check
        console.log(`Waiting ${CHECK_INTERVAL_MS / 60000} minutes...`);
        await new Promise(r => setTimeout(r, CHECK_INTERVAL_MS));
    }
}

/**
 * Phase 1: Update bet statuses based on market results
 * This marks bets as won/lost but does NOT pay out
 */
async function updateBetStatuses(connection: Connection) {
    const pendingBets = await getPendingBetsForSettlement();
    if (pendingBets.length === 0) {
        console.log("No pending bets to check.");
        return;
    }

    console.log(`Found ${pendingBets.length} pending bets to check.`);

    // Group by market
    const marketsToCheck = [...new Set(pendingBets.map(b => b.marketId))];

    for (const marketId of marketsToCheck) {
        try {
            const market = await fetchMarketFresh(marketId);

            if (market.status !== "closed" || !market.result) {
                continue;
            }

            const result = market.result.toLowerCase();
            if (result !== "yes" && result !== "no") {
                console.log(`Market ${marketId} has invalid result '${result}'. Skipping.`);
                continue;
            }

            console.log(`Market ${marketId} resolved: ${result.toUpperCase()}`);

            // Update statuses for bets in this market
            const marketBets = pendingBets.filter(b => b.marketId === marketId);
            for (const bet of marketBets) {
                if (bet.outcome === result) {
                    // Winner - mark as won but NOT claimed
                    // User should claim via /api/claim
                    await updateBetStatus(bet.tx, "won", false);
                    console.log(`  ✓ Bet ${bet.tx.slice(0, 8)}... marked as WON (user should claim)`);
                } else {
                    // Loser
                    await updateBetStatus(bet.tx, "lost", false);
                    console.log(`  ✗ Bet ${bet.tx.slice(0, 8)}... marked as LOST`);
                }
            }

        } catch (e) {
            console.error(`Error checking market ${marketId}:`, e);
        }
    }
}

/**
 * Phase 2: Auto-payout stale unclaimed winning bets
 * Only runs for bets not claimed within CLAIM_TIMEOUT
 */
async function autoPayoutStaleBets(connection: Connection, vaultWallet: NodeWallet) {
    const staleBets = await getStaleUnclaimedBets();

    if (staleBets.length === 0) {
        console.log("No stale unclaimed bets to process.");
        return;
    }

    console.log(`Found ${staleBets.length} stale unclaimed winning bets.`);
    console.log("Processing auto-payouts for unclaimed winnings...");

    for (const bet of staleBets) {
        // Attempt to lock the bet
        try {
            const lockTime = Date.now();
            await sql`
                UPDATE bets SET claim_lock = ${lockTime} 
                WHERE tx = ${bet.tx} 
                AND (claim_lock IS NULL OR claim_lock < ${lockTime - 60000}) 
                AND claimed = false
            `;
        } catch (e) {
            console.log(`Could not lock bet ${bet.tx}, skipping...`);
            continue;
        }

        console.log(`\n  Processing unclaimed bet: ${bet.tx.slice(0, 8)}...`);
        console.log(`    Wallet: ${bet.wallet.slice(0, 8)}...`);
        console.log(`    Amount: ${bet.amount}`);
        console.log(`    Age: ${((Date.now() - bet.timestamp) / (60 * 60 * 1000)).toFixed(1)} hours`);

        // Calculate payout
        const allBets = await getMarketBets(bet.marketId);
        const yesTotal = allBets.filter(b => b.outcome === "yes").reduce((sum, b) => sum + b.amount, 0);
        const noTotal = allBets.filter(b => b.outcome === "no").reduce((sum, b) => sum + b.amount, 0);

        // Since status is 'won', the bet outcome matches the result
        // Determine winning pool based on outcome
        const winningPool = bet.outcome === "yes" ? yesTotal : noTotal;
        const losingPool = bet.outcome === "yes" ? noTotal : yesTotal;

        const payout = calculateClaimAmount(bet.amount, winningPool, losingPool, PROTOCOL_FEE);
        console.log(`    Payout: ${payout.toFixed(2)}`);

        if (!bet.mint) {
            console.error(`    ⚠️  Cannot payout: Missing mint address`);
            await sql`UPDATE bets SET claim_lock = NULL WHERE tx = ${bet.tx}`;
            continue;
        }

        try {
            const transferResult = await simpleTransfer(
                connection,
                vaultWallet,
                async (tx: Transaction, conn: Connection) => {
                    tx.sign(vaultWallet.payer);
                    return await conn.sendRawTransaction(tx.serialize(), {
                        skipPreflight: false,
                        preflightCommitment: "confirmed"
                    });
                },
                bet.wallet,
                payout,
                bet.mint
            );

            if (transferResult.success) {
                console.log(`    ✅ Auto-payout successful! TX: ${transferResult.signature}`);

                // Transfer 2% protocol fee to treasury
                const userShare = bet.amount / winningPool;
                const protocolFeeAmount = losingPool * PROTOCOL_FEE * userShare;

                if (protocolFeeAmount > 0) {
                    console.log(`    💰 Transferring ${protocolFeeAmount.toFixed(4)} fee to treasury...`);
                    const treasuryResult = await simpleTransfer(
                        connection,
                        vaultWallet,
                        async (tx: Transaction, conn: Connection) => {
                            tx.sign(vaultWallet.payer);
                            return await conn.sendRawTransaction(tx.serialize(), {
                                skipPreflight: false,
                                preflightCommitment: "confirmed"
                            });
                        },
                        PROTOCOL_TREASURY.toBase58(),
                        protocolFeeAmount,
                        bet.mint
                    );

                    if (treasuryResult.success) {
                        console.log(`    💰 Treasury fee sent: ${treasuryResult.signature}`);
                    } else {
                        // Queue for retry
                        console.error(`    ⚠️  Treasury fee failed, queueing for retry: ${treasuryResult.error}`);
                        await queueFailedFee(bet.tx, protocolFeeAmount, bet.mint, treasuryResult.error || "Unknown error (bot)");
                    }
                }

                await updateBetStatus(bet.tx, "won", true);

                // Record nullifier to prevent any future claim attempts
                if (bet.commitment?.nullifier) {
                    await sql`
                        INSERT INTO nullifiers (nullifier, used_at) 
                        VALUES (${bet.commitment.nullifier}, ${Date.now()}) 
                        ON CONFLICT DO NOTHING
                    `;
                }

                // Clear lock
                await sql`UPDATE bets SET claim_lock = NULL WHERE tx = ${bet.tx}`;
            } else {
                console.error(`    ❌ Auto-payout failed: ${transferResult.error}`);
                // Clear lock so it can be retried later
                await sql`UPDATE bets SET claim_lock = NULL WHERE tx = ${bet.tx}`;
            }
        } catch (e) {
            console.error("    ❌ Payout exception:", e);
            // Clear lock
            await sql`UPDATE bets SET claim_lock = NULL WHERE tx = ${bet.tx}`;
        }
    }
}

// Start
console.log("");
console.log("╔══════════════════════════════════════════════╗");
console.log("║  WhispMarket Settlement Bot (BACKUP MODE)    ║");
console.log("╠══════════════════════════════════════════════╣");
console.log("║  Users should claim winnings via /api/claim  ║");
console.log("║  This bot auto-settles after 48h timeout     ║");
console.log("╚══════════════════════════════════════════════╝");
console.log("");

runBot().catch(console.error);
