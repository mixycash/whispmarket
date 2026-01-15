/**
 * Create Shared Protocol Inco Mint
 * 
 * Run once to create the shared wSOL-backed Inco mint.
 * The vault wallet will be the mint authority.
 * 
 * Usage: npx ts-node scripts/create-protocol-mint.ts
 */

import { Connection, Keypair, SystemProgram, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import idl from "../utils/idl.json";

const PROGRAM_ID = new PublicKey(idl.address);

async function main() {
    // Load vault keypair from env
    if (!process.env.VAULT_SECRET_KEY) {
        console.error("❌ VAULT_SECRET_KEY not set in environment");
        process.exit(1);
    }

    // Parse secret key - handle both JSON array and comma-separated formats
    let secretKeyArray: number[];
    const keyStr = process.env.VAULT_SECRET_KEY.trim();
    if (keyStr.startsWith('[')) {
        secretKeyArray = JSON.parse(keyStr);
    } else {
        secretKeyArray = keyStr.split(',').map(n => parseInt(n.trim(), 10));
    }
    const secretKey = Uint8Array.from(secretKeyArray);
    const vaultKeypair = Keypair.fromSecretKey(secretKey);

    console.log("🔑 Vault address:", vaultKeypair.publicKey.toBase58());

    const connection = new Connection(
        process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com",
        "confirmed"
    );

    // Check vault balance
    const balance = await connection.getBalance(vaultKeypair.publicKey);
    console.log("💰 Vault balance:", balance / 1e9, "SOL");

    if (balance < 0.01 * 1e9) {
        console.error("❌ Vault needs at least 0.01 SOL for deployment");
        process.exit(1);
    }

    // Create provider and program
    const wallet = new Wallet(vaultKeypair);
    const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
    const program = new Program(idl as any, provider);

    // Generate new mint keypair
    const mintKeypair = Keypair.generate();
    console.log("\n📝 Creating new shared Inco mint...");
    console.log("   Mint address:", mintKeypair.publicKey.toBase58());

    try {
        // Initialize mint with vault as authority
        const tx = await program.methods
            .initializeMint(
                6, // decimals (same as wSOL)
                vaultKeypair.publicKey, // mint authority
                vaultKeypair.publicKey  // freeze authority
            )
            .accounts({
                mint: mintKeypair.publicKey,
                payer: vaultKeypair.publicKey,
                systemProgram: SystemProgram.programId,
            } as any)
            .signers([mintKeypair])
            .rpc();

        console.log("✅ Mint created!");
        console.log("   Transaction:", tx);
        console.log("\n===========================================");
        console.log("📋 ADD THIS TO YOUR .env.local:");
        console.log("===========================================");
        console.log(`NEXT_PUBLIC_PROTOCOL_INCO_MINT=${mintKeypair.publicKey.toBase58()}`);
        console.log("===========================================\n");

        // Also create vault's token account for this mint
        console.log("📝 Creating vault's token account for this mint...");
        const vaultAccountKeypair = Keypair.generate();

        const accTx = await program.methods
            .initializeAccount()
            .accounts({
                account: vaultAccountKeypair.publicKey,
                mint: mintKeypair.publicKey,
                owner: vaultKeypair.publicKey,
                payer: vaultKeypair.publicKey,
                systemProgram: SystemProgram.programId,
            } as any)
            .signers([vaultAccountKeypair])
            .rpc();

        console.log("✅ Vault token account created!");
        console.log("   Account:", vaultAccountKeypair.publicKey.toBase58());
        console.log("   Transaction:", accTx);

    } catch (error) {
        console.error("❌ Error creating mint:", error);
        process.exit(1);
    }
}

main().catch(console.error);
