
import { PublicKey } from "@solana/web3.js";

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
