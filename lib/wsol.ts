/**
 * wSOL Wrapping/Unwrapping Utilities
 * Handles SOL ↔ wSOL conversions for confidential betting
 */

import {
    Connection,
    PublicKey,
    Transaction,
    SystemProgram,
    LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
    createSyncNativeInstruction,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    getAccount,
    NATIVE_MINT,
    createCloseAccountInstruction,
} from "@solana/spl-token";

/**
 * Get or create the user's wSOL Associated Token Account
 */
export async function getOrCreateWsolAta(
    connection: Connection,
    wallet: PublicKey,
    payer: PublicKey
): Promise<{ ata: PublicKey; instruction?: ReturnType<typeof createAssociatedTokenAccountInstruction> }> {
    const ata = await getAssociatedTokenAddress(NATIVE_MINT, wallet);

    try {
        await getAccount(connection, ata);
        return { ata };
    } catch {
        // Account doesn't exist, create it
        const instruction = createAssociatedTokenAccountInstruction(
            payer,
            ata,
            wallet,
            NATIVE_MINT
        );
        return { ata, instruction };
    }
}

/**
 * Create transaction to wrap SOL → wSOL
 * @param connection - Solana connection
 * @param wallet - User's wallet public key
 * @param amountSol - Amount in SOL to wrap
 * @returns Transaction ready to sign
 */
export async function createWrapSolTransaction(
    connection: Connection,
    wallet: PublicKey,
    amountSol: number
): Promise<{ transaction: Transaction; wsolAta: PublicKey }> {
    const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
    const { ata: wsolAta, instruction: createAtaIx } = await getOrCreateWsolAta(
        connection,
        wallet,
        wallet
    );

    const tx = new Transaction();

    // Create ATA if needed
    if (createAtaIx) {
        tx.add(createAtaIx);
    }

    // Transfer SOL to wSOL ATA
    tx.add(
        SystemProgram.transfer({
            fromPubkey: wallet,
            toPubkey: wsolAta,
            lamports,
        })
    );

    // Sync native balance to update wSOL amount
    tx.add(createSyncNativeInstruction(wsolAta));

    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.feePayer = wallet;

    return { transaction: tx, wsolAta };
}

/**
 * Create transaction to unwrap wSOL → SOL
 * Closes the wSOL account and returns SOL to wallet
 */
export async function createUnwrapSolTransaction(
    connection: Connection,
    wallet: PublicKey
): Promise<Transaction> {
    const wsolAta = await getAssociatedTokenAddress(NATIVE_MINT, wallet);

    const tx = new Transaction();
    tx.add(
        createCloseAccountInstruction(
            wsolAta,
            wallet, // Destination for SOL
            wallet  // Authority
        )
    );

    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.feePayer = wallet;

    return tx;
}

/**
 * Get user's wSOL balance
 */
export async function getWsolBalance(
    connection: Connection,
    wallet: PublicKey
): Promise<number> {
    try {
        const ata = await getAssociatedTokenAddress(NATIVE_MINT, wallet);
        const account = await getAccount(connection, ata);
        return Number(account.amount) / LAMPORTS_PER_SOL;
    } catch {
        return 0;
    }
}
