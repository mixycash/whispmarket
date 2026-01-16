/**
 * Claim API - User-Initiated Claim Flow
 * 
 * Users submit claim proofs for their winning bets.
 * Server validates the proof and releases funds using PARIMUTUEL model.
 * 
 * PRODUCTION FEATURES:
 * - Atomic claim locking (prevents race conditions)
 * - Parimutuel payout calculation (consistent with settlement bot)
 * - Treasury fee retry queue (handles failed fee transfers)
 */

import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { sql } from "@/lib/db";
import { Bet } from "@/lib/schema";
import { fetchMarketFresh } from "@/lib/jup-predict";
import { simpleTransfer } from "@/lib/confidential-transfer";
import { PROTOCOL_VAULT, PROTOCOL_FEE, PROTOCOL_TREASURY } from "@/lib/protocol";
import { ClaimProof, calculateClaimAmount } from "@/lib/bet-commitment";
import { NodeWallet } from "@/lib/node-wallet";
import { parseSecretKey, checkRateLimit, RATE_LIMITS } from "@/lib/server-utils";



// Helper to map DB row to Bet
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
        potentialPayout: row.potential_payout ? Number(row.potential_payout) : undefined,
        imageUrl: row.image_url as string | undefined,
        commitment: row.commitment as Bet["commitment"],
        claimed: row.claimed as boolean,
        mint: row.mint as string | undefined,
    };
}

// Helper to get market totals from all bets in a market
async function getMarketTotals(marketId: string): Promise<{ yes: number; no: number }> {
    const rows = await sql`SELECT outcome, SUM(amount) as total FROM bets WHERE market_id = ${marketId} GROUP BY outcome`;
    let yesTotal = 0;
    let noTotal = 0;
    for (const row of rows) {
        if (row.outcome === 'yes') yesTotal = Number(row.total);
        if (row.outcome === 'no') noTotal = Number(row.total);
    }
    return { yes: yesTotal, no: noTotal };
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

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { proof, betTx, walletAddress } = body as {
            proof: ClaimProof;
            betTx: string;
            walletAddress: string;
        };

        // Validate required fields
        if (!proof || !betTx || !walletAddress) {
            return NextResponse.json(
                { success: false, error: "Missing required fields" },
                { status: 400 }
            );
        }

        // Rate limiting - prevent claim spam
        const rateLimit = checkRateLimit(`claim:${walletAddress}`, RATE_LIMITS.CLAIM.maxRequests, RATE_LIMITS.CLAIM.windowMs);
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { success: false, error: "Too many claim requests. Please wait.", retryAfter: Math.ceil(rateLimit.resetIn / 1000) },
                { status: 429 }
            );
        }

        // === ATOMIC CLAIM LOCK START ===
        // Use SELECT FOR UPDATE to prevent race conditions with settlement bot
        // Note: Neon serverless doesn't support traditional transactions, 
        // so we use a claim_lock timestamp approach

        const lockTimestamp = Date.now();
        const LOCK_TIMEOUT_MS = 30000; // 30 second lock timeout

        // Attempt to acquire lock
        const lockResult = await sql`
            UPDATE bets 
            SET claim_lock = ${lockTimestamp}
            WHERE tx = ${betTx} 
            AND (claim_lock IS NULL OR claim_lock < ${lockTimestamp - LOCK_TIMEOUT_MS})
            AND claimed = false
            RETURNING *
        `;

        if (lockResult.length === 0) {
            // Either bet doesn't exist, is already claimed, or is locked
            const checkRows = await sql`SELECT claimed, claim_lock FROM bets WHERE tx = ${betTx}`;
            if (checkRows.length === 0) {
                return NextResponse.json(
                    { success: false, error: "Bet not found" },
                    { status: 404 }
                );
            }
            if (checkRows[0].claimed) {
                return NextResponse.json(
                    { success: false, error: "Already claimed" },
                    { status: 400 }
                );
            }
            return NextResponse.json(
                { success: false, error: "Claim in progress, please wait" },
                { status: 409 }
            );
        }

        const bet = mapRowToBet(lockResult[0]);

        // 2. Verify ownership
        if (bet.wallet !== walletAddress) {
            // Release lock
            await sql`UPDATE bets SET claim_lock = NULL WHERE tx = ${betTx}`;
            return NextResponse.json(
                { success: false, error: "Not your bet" },
                { status: 403 }
            );
        }

        // 3. Check bet status
        if (bet.status === "lost") {
            await sql`UPDATE bets SET claim_lock = NULL WHERE tx = ${betTx}`;
            return NextResponse.json(
                { success: false, error: "Bet was lost - nothing to claim" },
                { status: 400 }
            );
        }

        // 4. Check nullifier hasn't been used
        const nullifierRows = await sql`
            SELECT 1 FROM nullifiers WHERE nullifier = ${proof.nullifier}
        `;
        if (nullifierRows.length > 0) {
            await sql`UPDATE bets SET claim_lock = NULL WHERE tx = ${betTx}`;
            return NextResponse.json(
                { success: false, error: "Nullifier already used - possible double claim attempt" },
                { status: 400 }
            );
        }

        // 5. Fetch market to verify result
        const market = await fetchMarketFresh(bet.marketId);

        if (market.status !== "closed") {
            await sql`UPDATE bets SET claim_lock = NULL WHERE tx = ${betTx}`;
            return NextResponse.json(
                { success: false, error: "Market not yet settled" },
                { status: 400 }
            );
        }

        const result = market.result?.toLowerCase() as "yes" | "no" | undefined;
        if (!result || (result !== "yes" && result !== "no")) {
            await sql`UPDATE bets SET claim_lock = NULL WHERE tx = ${betTx}`;
            return NextResponse.json(
                { success: false, error: "Market has no valid result" },
                { status: 400 }
            );
        }

        // 6. Verify the claim proof
        if (proof.outcome !== bet.outcome) {
            await sql`UPDATE bets SET claim_lock = NULL WHERE tx = ${betTx}`;
            return NextResponse.json(
                { success: false, error: "Proof outcome mismatch" },
                { status: 400 }
            );
        }

        if (proof.outcome !== result) {
            // User's bet lost
            await sql`UPDATE bets SET status = 'lost', claim_lock = NULL WHERE tx = ${betTx}`;
            return NextResponse.json(
                { success: false, error: "Your bet lost - outcome did not match result" },
                { status: 400 }
            );
        }

        // 7. Calculate payout using PARIMUTUEL model (consistent with settlement bot)
        const totals = await getMarketTotals(bet.marketId);
        const winningPool = result === "yes" ? totals.yes : totals.no;
        const losingPool = result === "yes" ? totals.no : totals.yes;
        const payout = calculateClaimAmount(bet.amount, winningPool, losingPool, PROTOCOL_FEE);

        // 8. Execute payout
        if (!bet.mint) {
            await sql`UPDATE bets SET claim_lock = NULL WHERE tx = ${betTx}`;
            return NextResponse.json(
                { success: false, error: "Bet missing mint address" },
                { status: 400 }
            );
        }

        // Setup vault wallet
        let vaultKeypair;
        try {
            vaultKeypair = parseSecretKey("VAULT_SECRET_KEY");
        } catch (e) {
            await sql`UPDATE bets SET claim_lock = NULL WHERE tx = ${betTx}`;
            console.error("Vault key error:", e);
            return NextResponse.json(
                { success: false, error: "Server configuration error" },
                { status: 500 }
            );
        }

        const connection = new Connection(
            process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com",
            "confirmed"
        );

        const vaultWallet = new NodeWallet(vaultKeypair);

        // Verify vault key matches
        if (vaultKeypair.publicKey.toBase58() !== PROTOCOL_VAULT.toBase58()) {
            console.error("Vault key mismatch - check configuration");
        }

        // Execute transfer
        const transferResult = await simpleTransfer(
            connection,
            vaultWallet as Parameters<typeof simpleTransfer>[1],
            async (tx: Transaction, conn: Connection) => {
                tx.sign(vaultWallet.payer);
                return await conn.sendRawTransaction(tx.serialize(), {
                    skipPreflight: false,
                    preflightCommitment: "confirmed",
                });
            },
            bet.wallet,
            payout,
            bet.mint
        );

        if (!transferResult.success) {
            await sql`UPDATE bets SET claim_lock = NULL WHERE tx = ${betTx}`;
            return NextResponse.json(
                { success: false, error: `Payout failed: ${transferResult.error}` },
                { status: 500 }
            );
        }

        // 9. Transfer protocol fee to treasury (using parimutuel model)
        // Fee = PROTOCOL_FEE * share of losing pool
        const userShare = bet.amount / winningPool;
        const protocolFeeAmount = losingPool * PROTOCOL_FEE * userShare;

        if (protocolFeeAmount > 0) {
            console.log(`[Treasury Fee] Transferring ${protocolFeeAmount.toFixed(4)} to treasury`);
            const treasuryResult = await simpleTransfer(
                connection,
                vaultWallet as Parameters<typeof simpleTransfer>[1],
                async (tx: Transaction, conn: Connection) => {
                    tx.sign(vaultWallet.payer);
                    return await conn.sendRawTransaction(tx.serialize(), {
                        skipPreflight: false,
                        preflightCommitment: "confirmed",
                    });
                },
                PROTOCOL_TREASURY.toBase58(),
                protocolFeeAmount,
                bet.mint
            );

            if (!treasuryResult.success) {
                // Queue for retry instead of just logging
                await queueFailedFee(betTx, protocolFeeAmount, bet.mint, treasuryResult.error || "Unknown error");
            } else {
                console.log(`[Treasury Fee] Success: ${treasuryResult.signature}`);
            }
        }

        // 10. Mark as claimed and record nullifier (release lock)
        await sql`UPDATE bets SET status = 'won', claimed = true, claim_lock = NULL WHERE tx = ${betTx}`;
        await sql`
            INSERT INTO nullifiers (nullifier, used_at) 
            VALUES (${proof.nullifier}, ${Date.now()})
            ON CONFLICT (nullifier) DO NOTHING
        `;

        return NextResponse.json({
            success: true,
            payout,
            payoutTx: transferResult.signature,
            message: `Claimed ${payout.toFixed(2)} tokens!`,
            model: "parimutuel", // Indicate which model was used
        });

    } catch (e) {
        console.error("Claim error:", e);
        return NextResponse.json(
            { success: false, error: "Internal server error" },
            { status: 500 }
        );
    }
}

// GET endpoint to check claim status
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const betTx = searchParams.get("betTx");
    const walletAddress = searchParams.get("wallet");

    if (!betTx || !walletAddress) {
        return NextResponse.json(
            { error: "Missing betTx or wallet" },
            { status: 400 }
        );
    }

    // Rate limiting for status checks
    const rateLimit = checkRateLimit(`status:${walletAddress}`, RATE_LIMITS.STATUS.maxRequests, RATE_LIMITS.STATUS.windowMs);
    if (!rateLimit.allowed) {
        return NextResponse.json(
            { error: "Too many requests. Please wait.", retryAfter: Math.ceil(rateLimit.resetIn / 1000) },
            { status: 429 }
        );
    }

    try {
        const rows = await sql`SELECT * FROM bets WHERE tx = ${betTx}`;
        if (rows.length === 0) {
            return NextResponse.json({ claimable: false, reason: "Bet not found" });
        }

        const bet = mapRowToBet(rows[0]);

        if (bet.wallet !== walletAddress) {
            return NextResponse.json({ claimable: false, reason: "Not your bet" });
        }

        if (bet.claimed) {
            return NextResponse.json({ claimable: false, reason: "Already claimed" });
        }

        // Check market status
        const market = await fetchMarketFresh(bet.marketId);

        if (market.status !== "closed") {
            return NextResponse.json({
                claimable: false,
                reason: "Market not settled",
                status: "pending"
            });
        }

        const result = market.result?.toLowerCase() as "yes" | "no" | undefined;
        if (bet.outcome === result) {
            // Calculate potential payout using PARIMUTUEL model (consistent)
            const totals = await getMarketTotals(bet.marketId);
            const winningPool = result === "yes" ? totals.yes : totals.no;
            const losingPool = result === "yes" ? totals.no : totals.yes;
            const payout = calculateClaimAmount(bet.amount, winningPool, losingPool, PROTOCOL_FEE);

            return NextResponse.json({
                claimable: true,
                status: "won",
                estimatedPayout: payout,
                marketResult: result,
                model: "parimutuel",
            });
        } else {
            return NextResponse.json({
                claimable: false,
                reason: "Bet lost",
                status: "lost",
                marketResult: result,
            });
        }

    } catch (e) {
        console.error("Claim status error:", e);
        return NextResponse.json(
            { error: "Failed to check claim status" },
            { status: 500 }
        );
    }
}
