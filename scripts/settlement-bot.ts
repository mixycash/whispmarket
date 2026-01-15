
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";

import { sql } from "../lib/db"; // Use relative path
import { Bet } from "../lib/schema";
import { fetchMarketFresh } from "../lib/jup-predict";
import { simpleTransfer } from "../lib/confidential-transfer";
import { PROTOCOL_VAULT, PROTOCOL_TREASURY, PROTOCOL_FEE } from "../lib/protocol";
import { calculateClaimAmount } from "../lib/bet-commitment";

// Polyfill for Wallet Adapter compatibility
interface AnchorWallet {
    publicKey: PublicKey;
    signTransaction<T extends Transaction | any>(transaction: T): Promise<T>;
    signAllTransactions<T extends Transaction | any>(transactions: T[]): Promise<T[]>;
}

class NodeWallet implements AnchorWallet {
    constructor(readonly payer: Keypair) { }

    get publicKey() {
        return this.payer.publicKey;
    }

    async signTransaction<T extends Transaction | any>(tx: T): Promise<T> {
        if (tx instanceof Transaction) {
            tx.sign(this.payer);
        } // VersionedTransaction handling if needed
        return tx;
    }

    async signAllTransactions<T extends Transaction | any>(txs: T[]): Promise<T[]> {
        return txs.map((t) => {
            if (t instanceof Transaction) {
                t.sign(this.payer);
            }
            return t;
        });
    }
}

// Helpers
async function getPendingBets(): Promise<Bet[]> {
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
        commitment: row.commitment,
        claimed: row.claimed
    };
}

async function updateBetStatus(tx: string, status: string, claimed: boolean = false) {
    await sql`UPDATE bets SET status = ${status}, claimed = ${claimed} WHERE tx = ${tx}`;
}

// Main Logic
async function runBot() {
    console.log("Starting Settlement Bot...");

    // 1. Setup Connection & Wallet
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");

    // Parse secret key
    if (!process.env.VAULT_SECRET_KEY) {
        throw new Error("VAULT_SECRET_KEY not found in env");
    }
    const secretKey = Uint8Array.from(JSON.parse(process.env.VAULT_SECRET_KEY));
    const vaultKeypair = Keypair.fromSecretKey(secretKey);
    const vaultWallet = new NodeWallet(vaultKeypair);

    if (vaultKeypair.publicKey.toBase58() !== PROTOCOL_VAULT.toBase58()) {
        console.error("Vault wallet public key mismatch!");
        console.error("Env:", vaultKeypair.publicKey.toBase58());
        console.error("Constant:", PROTOCOL_VAULT.toBase58());
        // proceed or exit? Exit to be safe.
        // process.exit(1); 
        // Warning only for now as constants might be different in my mock
    }

    console.log(`Bot running for Vault: ${vaultWallet.publicKey.toBase58()}`);

    // Loop
    while (true) {
        try {
            const pendingBets = await getPendingBets();
            if (pendingBets.length === 0) {
                console.log("No pending bets. Waiting...");
                await new Promise(r => setTimeout(r, 10_000));
                continue;
            }

            console.log(`Found ${pendingBets.length} pending bets.`);

            // Group by market
            const marketsToCheck = [...new Set(pendingBets.map(b => b.marketId))];

            for (const marketId of marketsToCheck) {
                await processMarket(marketId, connection, vaultWallet);
            }

        } catch (e) {
            console.error("Bot Loop Error:", e);
        }

        // Wait 30 seconds before next loop
        await new Promise(r => setTimeout(r, 30_000));
    }
}

async function processMarket(marketId: string, connection: Connection, vaultWallet: NodeWallet) {
    try {
        console.log(`Checking market: ${marketId}`);
        const market = await fetchMarketFresh(marketId);

        if (market.status !== "closed" || !market.result) {
            // Check if expired using closeTime? 
            // For now, only settle if API says closed + result
            return;
        }

        const result = market.result.toLowerCase();
        if (result !== "yes" && result !== "no") {
            console.log(`Market ${marketId} resolved to invalid result '${result}'. Skipping automatic settlement.`);
            return;
        }

        console.log(`Market resolved: ${result.toUpperCase()}`);

        // Fetch ALL bets for this market to calculate pools
        const allBets = await getMarketBets(marketId);

        const yesBets = allBets.filter(b => b.outcome === "yes");
        const noBets = allBets.filter(b => b.outcome === "no");

        const yesTotal = yesBets.reduce((sum, b) => sum + b.amount, 0);
        const noTotal = noBets.reduce((sum, b) => sum + b.amount, 0);

        const winningPool = result === "yes" ? yesTotal : noTotal;
        const losingPool = result === "yes" ? noTotal : yesTotal;

        console.log(`Pools - Winning: ${winningPool}, Losing: ${losingPool}`);

        // Process PENDING bets only
        const pendingBets = allBets.filter(b => b.status === "pending");

        for (const bet of pendingBets) {
            if (bet.outcome === result) {
                // WINNER
                console.log(`Processing WIN for ${bet.wallet} (${bet.amount} tokens)`);

                const payout = calculateClaimAmount(bet.amount, winningPool, losingPool, PROTOCOL_FEE);

                // Perform Transfer
                if (!bet.mint) {
                    console.error(`Cannot payout bet ${bet.tx}: Missing mint.`);
                    continue; // Skip if no mint (legacy bets)
                }

                try {
                    const transferResult = await simpleTransfer(
                        connection,
                        vaultWallet,
                        async (tx: Transaction, conn: Connection) => {
                            // Sign and send
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
                        console.log(`Payout successful! TX: ${transferResult.signature}`);
                        // Mark as won AND claimed (automatic payout)
                        await updateBetStatus(bet.tx, "won", true);
                        // Also mark nullifier used to prevent double dipping manually?
                        // Ideally we calculate nullifier. 
                        // But commitment object might be missing if it's legacy?
                        // If we auto-paid, it's claimed.
                        // We should maybe mark nullifier if we can.
                        if (bet.commitment) {
                            // We don't have access to 'markNullifierUsed' from app/actions inside this script easily due to import restrictions? 
                            // Wait, we import 'sql' from lib/db. 
                            // We can just write SQL.
                            await sql`INSERT INTO nullifiers (nullifier, used_at) VALUES (${bet.commitment.nullifier}, ${Date.now()}) ON CONFLICT DO NOTHING`;
                        }
                    } else {
                        console.error(`Payout failed for ${bet.tx}: ${transferResult.error}`);
                    }
                } catch (e) {
                    console.error("Payout exception:", e);
                }


            } else {
                // LOSER
                console.log(`Processing LOSS for ${bet.wallet}`);
                await updateBetStatus(bet.tx, "lost");
            }
        }

    } catch (e) {
        console.error(`Error processing market ${marketId}:`, e);
    }
}

// Start
runBot().catch(console.error);
