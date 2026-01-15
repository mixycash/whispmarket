
import { PublicKey } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";

// Protocol wallets - Public keys (safe to expose)
// Vault: Receives all bets, holds funds until settlement
export const PROTOCOL_VAULT = new PublicKey(
    "92Xoz2ZNC4RjTpPCUizwKRgXBAe7tJ1XNtZiFGFXKiMJ"
);

// Treasury: Receives 2% fee on winning payouts
export const PROTOCOL_TREASURY = new PublicKey(
    "EBybdh3Jzjjue48HU6tYhUqPhg1LfEzjkzmcCRqDcbcA"
);

// Protocol fee: 2% taken from winning payouts
export const PROTOCOL_FEE = 0.02;

// Native wSOL mint (standard Solana wrapped SOL)
export const WSOL_MINT = NATIVE_MINT;

// Shared protocol Inco mint for wSOL-backed confidential tokens
// This mint is created once by the protocol operator and shared by all users
// All user deposits create confidential balances under this single mint
export const PROTOCOL_INCO_MINT = new PublicKey(
    process.env.NEXT_PUBLIC_PROTOCOL_INCO_MINT || PROTOCOL_VAULT.toBase58()
);

// Minimum deposit amount (in SOL)
export const MIN_DEPOSIT = 0.01;

// Maximum deposit amount (in SOL) - for devnet safety
export const MAX_DEPOSIT = 10;
