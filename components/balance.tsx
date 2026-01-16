"use client";

import { useState, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { decrypt } from "@inco/solana-sdk/attested-decrypt";
import {
  fetchUserTokenAccount,
  extractHandle,
} from "@/utils/constants";
import { PROTOCOL_INCO_MINT } from "@/lib/protocol";

export default function Balance() {
  const { publicKey, connected, signMessage } = useWallet();
  const { connection } = useConnection();
  const [balance, setBalance] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReadBalance = async () => {
    if (!connected || !publicKey || !signMessage) return;
    setLoading(true);
    setError(null);

    try {
      // Use the shared protocol mint for wSOL confidential tokens
      const acc = await fetchUserTokenAccount(
        connection,
        publicKey,
        PROTOCOL_INCO_MINT
      );

      if (!acc) return setBalance("0"); // No account means 0 balance

      const handle = extractHandle(acc.data);
      if (handle === BigInt(0)) return setBalance("0");

      const result = await decrypt([handle.toString()], {
        address: publicKey,
        signMessage,
      });
      setBalance(
        (Number(BigInt(result.plaintexts?.[0] ?? "0")) / 1e6).toString()
      );
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setBalance(undefined);
    setError(null);
  }, [publicKey]);
  useEffect(() => {
    const onMint = () => setBalance(undefined);
    window.addEventListener("token-minted", onMint);
    return () => window.removeEventListener("token-minted", onMint);
  }, []);

  return (
    <div className="mt-8 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--muted)]">Confidential Balance:</span>
          <div className="flex items-center gap-2 bg-[var(--surface)] px-3 py-1.5 rounded-lg border border-[var(--border-subtle)]">
            <img
              src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png"
              alt="SOL"
              width="16"
              height="16"
              className="rounded-full"
            />
            <span className="font-mono font-semibold">{balance ? `${balance} SOL` : "****"}</span>
          </div>
        </div>
        <button
          onClick={handleReadBalance}
          disabled={loading || !connected}
          className="bg-gray-600 text-white py-2 px-4 rounded-full hover:bg-gray-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
