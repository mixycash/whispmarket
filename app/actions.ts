"use server";

import { Bet } from "@/lib/schema";
import { sql } from "@/lib/db";


// Initialize tables if they don't exist
export async function setupDatabase() {
    try {
        await sql`
            CREATE TABLE IF NOT EXISTS bets (
                tx TEXT PRIMARY KEY,
                market_id TEXT NOT NULL,
                market_title TEXT NOT NULL,
                outcome TEXT NOT NULL,
                amount DOUBLE PRECISION NOT NULL,
                wallet TEXT NOT NULL,
                timestamp BIGINT NOT NULL,
                status TEXT NOT NULL,
                odds DOUBLE PRECISION,
                potential_payout DOUBLE PRECISION,
                image_url TEXT,
                commitment JSONB,
                claimed BOOLEAN DEFAULT FALSE
            );
        `;

        await sql`
            CREATE TABLE IF NOT EXISTS nullifiers (
                nullifier TEXT PRIMARY KEY,
                used_at BIGINT NOT NULL
            );
        `;

        // Migration: Add mint column if not exists
        await sql`ALTER TABLE bets ADD COLUMN IF NOT EXISTS mint TEXT`;

        console.log("Database initialized successfully");

    } catch (e) {
        console.error("Database initialization failed:", e);
    }
}

function mapRowToBet(row: any): Bet {
    return {
        tx: row.tx,
        marketId: row.market_id,
        marketTitle: row.market_title,
        outcome: row.outcome as "yes" | "no",
        amount: Number(row.amount),
        wallet: row.wallet,
        timestamp: Number(row.timestamp),
        status: row.status,
        odds: row.odds ? Number(row.odds) : undefined,
        potentialPayout: row.potential_payout ? Number(row.potential_payout) : undefined,
        imageUrl: row.image_url,
        commitment: row.commitment,
        claimed: row.claimed,
        mint: row.mint
    };
}


export async function getBets(wallet?: string): Promise<Bet[]> {
    try {
        let rows;
        if (wallet) {
            rows = await sql`SELECT * FROM bets WHERE wallet = ${wallet} ORDER BY timestamp DESC`;
        } else {
            rows = await sql`SELECT * FROM bets ORDER BY timestamp DESC`;
        }
        return rows.map(mapRowToBet);
    } catch (e: any) {
        if (e.message?.includes('relation "bets" does not exist')) {
            await setupDatabase();
            return getBets(wallet);
        }
        console.error("Error fetching bets:", e);
        return [];
    }
}

export async function getBetByTx(tx: string): Promise<Bet | null> {
    try {
        const rows = await sql`SELECT * FROM bets WHERE tx = ${tx}`;
        if (rows.length === 0) return null;
        return mapRowToBet(rows[0]);
    } catch (e) {
        console.error("Error fetching bet:", e);
        return null;
    }
}

export async function saveBet(bet: Bet): Promise<void> {
    try {
        await sql`
            INSERT INTO bets (
                tx, market_id, market_title, outcome, amount, wallet, 
                timestamp, status, odds, potential_payout, image_url, commitment, claimed, mint
            ) VALUES (
                ${bet.tx}, ${bet.marketId}, ${bet.marketTitle}, ${bet.outcome}, 
                ${bet.amount}, ${bet.wallet}, ${bet.timestamp}, ${bet.status || 'pending'}, 
                ${bet.odds || null}, ${bet.potentialPayout || null}, ${bet.imageUrl || null}, 
                ${bet.commitment ? JSON.stringify(bet.commitment) : null}, ${bet.claimed || false},
                ${bet.mint || null}
            )
            ON CONFLICT (tx) DO UPDATE SET
                status = EXCLUDED.status,
                claimed = EXCLUDED.claimed
        `;

    } catch (e: any) {
        if (e.message?.includes('relation "bets" does not exist')) {
            await setupDatabase();
            await saveBet(bet);
            return;
        }
        console.error("Error saving bet:", e);
        throw e;
    }
}

export async function updateBetStatus(tx: string, status: string, claimed?: boolean) {
    if (claimed !== undefined) {
        await sql`UPDATE bets SET status = ${status}, claimed = ${claimed} WHERE tx = ${tx}`;
    } else {
        await sql`UPDATE bets SET status = ${status} WHERE tx = ${tx}`;
    }
}

export async function checkNullifierUsed(nullifier: string): Promise<boolean> {
    try {
        const rows = await sql`SELECT 1 FROM nullifiers WHERE nullifier = ${nullifier}`;
        return rows.length > 0;
    } catch (e: any) {
        if (e.message?.includes('relation "nullifiers" does not exist')) {
            await setupDatabase();
            return false;
        }
        return false;
    }
}

export async function markNullifierUsed(nullifier: string): Promise<void> {
    await sql`
        INSERT INTO nullifiers (nullifier, used_at) 
        VALUES (${nullifier}, ${Date.now()})
        ON CONFLICT (nullifier) DO NOTHING
    `;
}

// For the settlement bot
export async function getAllPendingBets(): Promise<Bet[]> {
    try {
        const rows = await sql`SELECT * FROM bets WHERE status = 'pending'`;
        return rows.map(mapRowToBet);
    } catch (e) {
        console.error("Error fetching pending bets:", e);
        return [];
    }
}

export async function getBetsByMarket(marketId: string): Promise<Bet[]> {
    try {
        const rows = await sql`SELECT * FROM bets WHERE market_id = ${marketId}`;
        return rows.map(mapRowToBet);
    } catch (e) {
        console.error("Error fetching bets by market:", e);
        return [];
    }
}

export async function clearLostBets(wallet: string): Promise<void> {
    try {
        await sql`DELETE FROM bets WHERE wallet = ${wallet} AND status = 'lost'`;
    } catch (e) {
        console.error("Error clearing lost bets:", e);
    }
}

