"use client";

import { useState, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { decrypt } from "@inco/solana-sdk/attested-decrypt";
import {
  fetchUserTokenAccount,
  extractHandle,
} from "@/utils/constants";
import { PROTOCOL_INCO_MINT } from "@/lib/protocol";
import { useSolPrice } from "@/hooks/use-sol-price";

export default function Balance() {
  const { publicKey, connected, signMessage } = useWallet();
  const { connection } = useConnection();
  const [balance, setBalance] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { formatUsd, isLoading: priceLoading } = useSolPrice();

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

  const numericBalance = balance ? parseFloat(balance) : 0;

  return (
    <div className="balance-section">
      <div className="balance-header">
        <span className="balance-label">Confidential Balance</span>
        <button
          onClick={handleReadBalance}
          disabled={loading || !connected}
          className="balance-refresh-btn"
        >
          {loading ? (
            <span className="refresh-icon spinning">⟳</span>
          ) : (
            <span className="refresh-icon">⟳</span>
          )}
          {loading ? "Decrypting..." : "Reveal"}
        </button>
      </div>

      <div className="balance-display">
        <div className="balance-icon-wrapper">
          <img
            src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png"
            alt="SOL"
            className="balance-sol-icon"
          />
          <span className="balance-icon-badge">🔒</span>
        </div>
        <div className="balance-values">
          <div className="balance-primary">
            {balance ? `${parseFloat(balance).toFixed(4)} SOL` : "••••"}
          </div>
          {balance && !priceLoading && (
            <div className="balance-secondary">
              ≈ {formatUsd(numericBalance)}
            </div>
          )}
        </div>
      </div>

      {error && <p className="balance-error">{error}</p>}
    </div>
  );
}

