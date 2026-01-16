/**
 * Server-Side Node Wallet
 * 
 * Shared wallet implementation for server-side transaction signing.
 * Used by settlement bot, claim API, and deposit API.
 */

import { Keypair, Transaction, VersionedTransaction, PublicKey } from "@solana/web3.js";

/**
 * Anchor-compatible wallet interface for server-side operations
 */
export interface AnchorWallet {
    publicKey: PublicKey;
    signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T>;
    signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]>;
}

/**
 * Node.js wallet implementation using Keypair
 * Compatible with Anchor's wallet interface
 */
export class NodeWallet implements AnchorWallet {
    constructor(readonly payer: Keypair) { }

    get publicKey(): PublicKey {
        return this.payer.publicKey;
    }

    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
        if (tx instanceof Transaction) {
            tx.sign(this.payer);
        }
        return tx;
    }

    async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
        return txs.map((tx) => {
            if (tx instanceof Transaction) {
                tx.sign(this.payer);
            }
            return tx;
        });
    }
}
