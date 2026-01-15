/**
 * Retry Failed Treasury Fees API
 * 
 * Cron-callable endpoint to retry failed treasury transfers.
 * Should be called periodically (e.g., every hour) to process queued fees.
 */

import { NextRequest, NextResponse } from "next/server";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { sql } from "@/lib/db";
import { simpleTransfer } from "@/lib/confidential-transfer";
import { PROTOCOL_VAULT, PROTOCOL_TREASURY } from "@/lib/protocol";

// Maximum retry attempts before giving up
const MAX_RETRIES = 5;

// Server wallet wrapper
class NodeWallet {
    constructor(readonly payer: Keypair) { }
    get publicKey() { return this.payer.publicKey; }
    async signTransaction<T extends Transaction>(tx: T): Promise<T> {
        if (tx instanceof Transaction) tx.sign(this.payer);
        return tx;
    }
    async signAllTransactions<T extends Transaction>(txs: T[]): Promise<T[]> {
        return txs.map(t => { if (t instanceof Transaction) t.sign(this.payer); return t; });
    }
}

export async function POST(request: NextRequest) {
    try {
        // Optional: Verify cron secret for security
        const authHeader = request.headers.get("authorization");
        const cronSecret = process.env.CRON_SECRET;

        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        // Fetch pending fees
        let pendingFees;
        try {
            pendingFees = await sql`
                SELECT * FROM pending_fees 
                WHERE retry_count < ${MAX_RETRIES}
                ORDER BY created_at ASC
                LIMIT 10
            `;
        } catch (e: unknown) {
            if (e instanceof Error && e.message?.includes('relation "pending_fees" does not exist')) {
                // Create table if it doesn't exist
                await sql`
                    CREATE TABLE IF NOT EXISTS pending_fees (
                        bet_tx TEXT PRIMARY KEY,
                        amount DOUBLE PRECISION NOT NULL,
                        mint TEXT NOT NULL,
                        error TEXT,
                        created_at BIGINT NOT NULL,
                        updated_at BIGINT,
                        retry_count INTEGER DEFAULT 0,
                        success_tx TEXT
                    )
                `;
                return NextResponse.json({
                    success: true,
                    processed: 0,
                    message: "Table created, no pending fees",
                });
            }
            throw e;
        }

        if (pendingFees.length === 0) {
            return NextResponse.json({
                success: true,
                processed: 0,
                message: "No pending fees to process",
            });
        }

        // Setup vault wallet
        if (!process.env.VAULT_SECRET_KEY) {
            return NextResponse.json(
                { success: false, error: "Server configuration error" },
                { status: 500 }
            );
        }

        const connection = new Connection(
            process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com",
            "confirmed"
        );

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

        // Process each pending fee
        const results: { betTx: string; success: boolean; error?: string }[] = [];

        for (const fee of pendingFees) {
            try {
                console.log(`[Retry Fee] Processing ${fee.bet_tx}, amount: ${fee.amount}`);

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
                    PROTOCOL_TREASURY.toBase58(),
                    fee.amount,
                    fee.mint
                );

                if (transferResult.success) {
                    // Mark as successful
                    await sql`
                        UPDATE pending_fees 
                        SET success_tx = ${transferResult.signature}, updated_at = ${Date.now()}
                        WHERE bet_tx = ${fee.bet_tx}
                    `;
                    results.push({ betTx: fee.bet_tx, success: true });
                    console.log(`[Retry Fee] Success: ${transferResult.signature}`);
                } else {
                    // Increment retry count
                    await sql`
                        UPDATE pending_fees 
                        SET retry_count = retry_count + 1, 
                            error = ${transferResult.error || 'Unknown error'},
                            updated_at = ${Date.now()}
                        WHERE bet_tx = ${fee.bet_tx}
                    `;
                    results.push({ betTx: fee.bet_tx, success: false, error: transferResult.error });
                    console.error(`[Retry Fee] Failed: ${transferResult.error}`);
                }
            } catch (e) {
                const errorMsg = e instanceof Error ? e.message : "Unknown error";
                await sql`
                    UPDATE pending_fees 
                    SET retry_count = retry_count + 1, 
                        error = ${errorMsg},
                        updated_at = ${Date.now()}
                    WHERE bet_tx = ${fee.bet_tx}
                `;
                results.push({ betTx: fee.bet_tx, success: false, error: errorMsg });
                console.error(`[Retry Fee] Exception:`, e);
            }
        }

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        return NextResponse.json({
            success: true,
            processed: results.length,
            successful: successCount,
            failed: failCount,
            results,
        });

    } catch (e) {
        console.error("Retry fees error:", e);
        return NextResponse.json(
            { success: false, error: e instanceof Error ? e.message : "Internal error" },
            { status: 500 }
        );
    }
}

// GET endpoint to check pending fees status
export async function GET() {
    try {
        const pending = await sql`
            SELECT COUNT(*) as count, SUM(amount) as total 
            FROM pending_fees 
            WHERE success_tx IS NULL AND retry_count < ${MAX_RETRIES}
        `.catch(() => [{ count: 0, total: 0 }]);

        const failed = await sql`
            SELECT COUNT(*) as count, SUM(amount) as total 
            FROM pending_fees 
            WHERE success_tx IS NULL AND retry_count >= ${MAX_RETRIES}
        `.catch(() => [{ count: 0, total: 0 }]);

        const successful = await sql`
            SELECT COUNT(*) as count, SUM(amount) as total 
            FROM pending_fees 
            WHERE success_tx IS NOT NULL
        `.catch(() => [{ count: 0, total: 0 }]);

        return NextResponse.json({
            pending: {
                count: Number(pending[0]?.count || 0),
                total: Number(pending[0]?.total || 0),
            },
            failed: {
                count: Number(failed[0]?.count || 0),
                total: Number(failed[0]?.total || 0),
            },
            successful: {
                count: Number(successful[0]?.count || 0),
                total: Number(successful[0]?.total || 0),
            },
        });

    } catch (e) {
        console.error("Pending fees status error:", e);
        return NextResponse.json(
            { error: "Failed to get status" },
            { status: 500 }
        );
    }
}
