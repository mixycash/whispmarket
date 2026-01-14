"use client";

import { useState, useEffect, useRef } from "react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { decrypt } from "@inco/solana-sdk/attested-decrypt";
import {
  fetchUserMint,
  fetchUserTokenAccount,
  extractHandle,
} from "@/utils/constants";
import { searchEvents, PredictEvent } from "@/lib/jup-predict";
import Link from "next/link";

const Header = ({ onSearchSelect }: { onSearchSelect?: (event: PredictEvent) => void }) => {
  const { publicKey, disconnect, connected, signMessage } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();

  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PredictEvent[]>([]);
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const formatAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  const handleRevealBalance = async () => {
    if (!connected || !publicKey || !signMessage) return;
    setLoading(true);

    try {
      const mint = await fetchUserMint(connection, publicKey);
      if (!mint) {
        setBalance("No mint");
        setRevealed(true);
        return;
      }

      const acc = await fetchUserTokenAccount(connection, publicKey, mint.pubkey);
      if (!acc) {
        setBalance("No account");
        setRevealed(true);
        return;
      }

      const handle = extractHandle(acc.data);
      if (handle === BigInt(0)) {
        setBalance("0");
        setRevealed(true);
        return;
      }

      const result = await decrypt([handle.toString()], {
        address: publicKey,
        signMessage,
      });
      setBalance((Number(BigInt(result.plaintexts?.[0] ?? "0")) / 1e6).toFixed(2));
      setRevealed(true);
    } catch (e) {
      console.error(e);
      setBalance("Error");
      setRevealed(true);
    } finally {
      setLoading(false);
    }
  };

  // Handle search input
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (query.trim().length >= 2) {
      const results = searchEvents(query);
      setSearchResults(results.slice(0, 8)); // Limit to 8 results
      setShowResults(true);
    } else {
      setSearchResults([]);
      setShowResults(false);
    }
  };

  // Handle result selection
  const handleResultClick = (event: PredictEvent) => {
    setSearchQuery("");
    setShowResults(false);
    onSearchSelect?.(event);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Reset when wallet changes
  useEffect(() => {
    setBalance(null);
    setRevealed(false);
  }, [publicKey]);

  // Listen for mint events
  useEffect(() => {
    const onMint = () => {
      setBalance(null);
      setRevealed(false);
    };
    window.addEventListener("token-minted", onMint);
    return () => window.removeEventListener("token-minted", onMint);
  }, []);

  return (
    <header className="flex items-center justify-between py-4">
      <div className="flex items-center gap-6">
        <Link href="/" className="hover:opacity-80 transition-opacity">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-lg">WhispMarket</span>
          </div>
        </Link>

        <Link
          href="/wallet"
          className="text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
        >
          Wallet
        </Link>

        {/* Search Bar */}
        <div ref={searchRef} className="search-container">
          <input
            type="text"
            placeholder="Search markets..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            onFocus={() => searchQuery.length >= 2 && setShowResults(true)}
            className="search-input"
          />
          {showResults && searchResults.length > 0 && (
            <div
              className="search-dropdown"
              style={{
                top: searchRef.current ? searchRef.current.getBoundingClientRect().bottom + 8 : 'auto',
                left: searchRef.current ? searchRef.current.getBoundingClientRect().left : 'auto'
              }}
            >
              {searchResults.map(event => (
                <button
                  key={event.eventId}
                  onClick={() => handleResultClick(event)}
                  className="search-result"
                >
                  <span className="search-result-category">{event.category}</span>
                  <span className="search-result-title">{event.metadata?.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Confidential Balance - only show when connected */}
        {connected && publicKey && (
          <div className="flex items-center gap-2 bg-[var(--surface)] border border-[var(--border-subtle)] px-3 py-1.5 rounded-lg">
            <span className="text-xs text-[var(--muted)]">CONF</span>
            <span className="font-mono text-sm font-medium">
              {loading ? "..." : revealed ? balance : "••••"}
            </span>
            <button
              onClick={handleRevealBalance}
              disabled={loading}
              className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
              title={revealed ? "Refresh balance" : "Reveal balance"}
            >
              {loading ? (
                <span className="animate-spin">⟳</span>
              ) : revealed ? (
                <span>↻</span>
              ) : (
                <span>👁</span>
              )}
            </button>
          </div>
        )}

        {/* Wallet Connection */}
        {publicKey ? (
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-[var(--foreground)] bg-[var(--surface)] border border-[var(--border-subtle)] px-3 py-1.5 rounded-lg">
              {formatAddress(publicKey.toBase58())}
            </span>
            <button
              onClick={() => disconnect()}
              className="text-sm font-medium text-[var(--muted)] hover:text-[var(--danger)] transition-colors"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={() => setVisible(true)}
            className="rounded-lg bg-[var(--accent)] text-white px-4 py-2 text-sm font-medium hover:bg-[var(--accent-hover)] transition-colors"
          >
            Connect Wallet
          </button>
        )}
      </div>
    </header>
  );
};

export default Header;
