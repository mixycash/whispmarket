import { PublicKey, Connection } from "@solana/web3.js";
import { Program, AnchorProvider, Idl, BorshCoder } from "@coral-xyz/anchor";
import { AnchorWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import idl from "./idl.json";
import { rateLimitedGetProgramAccounts } from "@/lib/rpc";

export const PROGRAM_ID = new PublicKey(idl.address);
export const INCO_LIGHTNING_PROGRAM_ID = new PublicKey(
  "5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj"
);

// Fetch discriminators dynamically from IDL to ensure consistency
const findDiscriminator = (name: string) => {
  const acc = (idl.accounts as any[]).find((a) => a.name === name);
  return acc ? acc.discriminator : [];
};

export const INCO_MINT_DISCRIMINATOR = findDiscriminator("IncoMint");
export const INCO_ACCOUNT_DISCRIMINATOR = findDiscriminator("IncoAccount");

// Coder for decoding account data
export const coder = new BorshCoder(idl as Idl);

// Derive allowance PDA for a handle and wallet
export const getAllowancePda = (
  handle: bigint,
  allowedAddress: PublicKey
): [PublicKey, number] => {
  const handleBuffer = Buffer.alloc(16);
  let h = handle;
  for (let i = 0; i < 16; i++) {
    handleBuffer[i] = Number(h & BigInt(0xff));
    h = h >> BigInt(8);
  }
  return PublicKey.findProgramAddressSync(
    [handleBuffer, allowedAddress.toBuffer()],
    INCO_LIGHTNING_PROGRAM_ID
  );
};

// Extract handle from account data bytes
// Update: Use BorshCoder for more robust extraction if needed, but keeping optimized slice for now
// as it avoids full deserialization overhead for just one field.
export const extractHandle = (data: Buffer): bigint => {
  // Offset 72 = 8 (discriminator) + 32 (mint) + 32 (owner)
  const bytes = data.slice(72, 88);
  let result = BigInt(0);
  for (let i = 15; i >= 0; i--) {
    result = result * BigInt(256) + BigInt(bytes[i]);
  }
  return result;
};

export const fetchUserMint = async (
  connection: Connection,
  wallet: PublicKey
): Promise<{ pubkey: PublicKey; data: Buffer } | null> => {
  try {
    const accounts = await rateLimitedGetProgramAccounts(connection, PROGRAM_ID, [
      {
        memcmp: {
          offset: 0,
          bytes: bs58.encode(Buffer.from(INCO_MINT_DISCRIMINATOR)),
        },
      },
      { memcmp: { offset: 9, bytes: wallet.toBase58() } },
    ]);
    return accounts.length
      ? { pubkey: accounts[0].pubkey, data: accounts[0].account.data as Buffer }
      : null;
  } catch (error) {
    console.error("[fetchUserMint] Error:", error);
    return null;
  }
};

export const fetchUserTokenAccount = async (
  connection: Connection,
  wallet: PublicKey,
  mint: PublicKey
): Promise<{ pubkey: PublicKey; data: Buffer } | null> => {
  try {
    const accounts = await rateLimitedGetProgramAccounts(connection, PROGRAM_ID, [
      {
        memcmp: {
          offset: 0,
          bytes: bs58.encode(Buffer.from(INCO_ACCOUNT_DISCRIMINATOR)),
        },
      },
      { memcmp: { offset: 8, bytes: mint.toBase58() } }, // Mint offset
      { memcmp: { offset: 40, bytes: wallet.toBase58() } }, // Owner offset
    ]);
    return accounts.length
      ? { pubkey: accounts[0].pubkey, data: accounts[0].account.data as Buffer }
      : null;
  } catch (error) {
    console.error("[fetchUserTokenAccount] Error:", error);
    return null;
  }
};

export const getProgram = (connection: Connection, wallet: AnchorWallet) => {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  return new Program(idl as Idl, provider);
};
