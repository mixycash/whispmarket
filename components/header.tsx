"use client";

import { useState, useEffect, useRef } from "react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { decrypt } from "@inco/solana-sdk/attested-decrypt";
import {
  fetchUserTokenAccount,
  extractHandle,
} from "@/utils/constants";
import { PROTOCOL_INCO_MINT } from "@/lib/protocol";
import { searchEvents, PredictEvent } from "@/lib/jup-predict";
import Link from "next/link";

const Header = ({ onSearchSelect }: { onSearchSelect?: (event: PredictEvent) => void }) => {
  const { publicKey, disconnect, connected, signMessage } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();

  // Balances state - track both types
  const [wsolBalance, setWsolBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [lastFetch, setLastFetch] = useState(0);
  const [showBalanceDropdown, setShowBalanceDropdown] = useState(false);
  const balanceRef = useRef<HTMLDivElement>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PredictEvent[]>([]);
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const formatAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  // Get total balance for display
  const totalBalance = (): string => {
    return wsolBalance || "0.00";
  };

  const handleRevealBalance = async () => {
    if (!connected || !publicKey || !signMessage) return;

    const now = Date.now();
    if (now - lastFetch < 5000 && revealed) {
      console.log("[Header] Rate limiting balance reveal request");
      return;
    }

    setLoading(true);
    setLastFetch(now);

    try {
      // Check wSOL-backed protocol mint
      const wsolAcc = await fetchUserTokenAccount(connection, publicKey, PROTOCOL_INCO_MINT);
      if (wsolAcc) {
        const handle = extractHandle(wsolAcc.data);
        if (handle !== BigInt(0)) {
          const result = await decrypt([handle.toString()], { address: publicKey, signMessage });
          setWsolBalance((Number(BigInt(result.plaintexts?.[0] ?? "0")) / 1e6).toFixed(2));
        } else {
          setWsolBalance("0.00");
        }
      } else {
        setWsolBalance(null);
      }

      setRevealed(true);
    } catch (e) {
      console.error(e);
      setWsolBalance("Error");
      setRevealed(true);
    } finally {
      setLoading(false);
    }
  };

  // Close balance dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (balanceRef.current && !balanceRef.current.contains(e.target as Node)) {
        setShowBalanceDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);


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
    setWsolBalance(null);
    setRevealed(false);
  }, [publicKey]);

  // Listen for mint events
  useEffect(() => {
    const onMint = () => {
      setWsolBalance(null);
      setRevealed(false);
    };
    window.addEventListener("token-minted", onMint);
    return () => window.removeEventListener("token-minted", onMint);
  }, []);

  return (
    <header className="flex items-center justify-between py-2 pt-1">
      <div className="flex items-center gap-10">
        <Link href="/" className="hover:opacity-80 transition-opacity">
          <div className="flex items-center gap-2">
            <span className="font-[family-name:var(--font-space)] font-bold text-2xl text-white tracking-tight">WHISPI</span>
          </div>
        </Link>

        <div className="flex items-center gap-6">
          <Link
            href="/wallet"
            className="text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          >
            Wallet
          </Link>

          <Link
            href="/portfolio"
            className="text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          >
            Portfolio
          </Link>
        </div>


      </div>

      <div className="flex items-center gap-3">
        {/* Search Bar */}
        <div ref={searchRef} className="search-container">
          <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
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
        {/* Confidential Balance with Dropdown */}
        {connected && publicKey && (
          <div ref={balanceRef} className="relative">
            <div
              className="flex items-center h-9 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-lg pl-3 pr-1 gap-2 hover:border-[var(--border)] transition-colors cursor-pointer"
              onClick={() => revealed && setShowBalanceDropdown(!showBalanceDropdown)}
            >
              <div className="flex items-center gap-1.5 text-[var(--muted)]" title="Confidential Balance">
                <img
                  src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png"
                  alt="SOL"
                  width="14"
                  height="14"
                  className="rounded-full opacity-80"
                />
              </div>
              <span className="font-mono text-sm font-medium text-[var(--foreground)] min-w-[4ch] text-center">
                {loading ? "..." : revealed ? totalBalance() : "••••"}
              </span>
              {revealed && wsolBalance && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--muted)]">
                  <path d="M6 9l6 6 6-6"></path>
                </svg>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); handleRevealBalance(); }}
                disabled={loading}
                className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--surface-hover)] text-[var(--muted)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
                title={revealed ? "Refresh balance" : "Reveal balance"}
              >
                {loading ? (
                  <span className="animate-spin text-xs">⟳</span>
                ) : revealed ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 4v6h-6"></path>
                    <path d="M1 20v-6h6"></path>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                )}
              </button>
            </div>

            {/* Balance Dropdown */}
            {showBalanceDropdown && revealed && (
              <div className="absolute top-full right-0 mt-2 w-52 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-lg shadow-lg z-50 overflow-hidden">
                <div className="p-3 border-b border-[var(--border-subtle)]">
                  <div className="text-xs text-[var(--muted)] uppercase tracking-wider mb-1">Total Balance</div>
                  <div className="text-xl font-bold font-mono">{totalBalance()}</div>
                </div>

                {wsolBalance !== null && (
                  <div className="p-2 px-3 flex justify-between items-center hover:bg-[var(--surface-hover)] cursor-default">
                    <div className="flex items-center gap-2">
                      <img
                        src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png"
                        alt="SOL"
                        width="16"
                        height="16"
                        className="rounded-full"
                      />
                      <span className="text-sm">wSOL</span>
                    </div>
                    <span className="font-mono text-sm font-medium">{wsolBalance}</span>
                  </div>
                )}

                {!wsolBalance && (
                  <div className="p-3 text-sm text-[var(--muted)] text-center">
                    No tokens found
                  </div>
                )}

                {/* Deposit Link */}
                <div className="border-t border-[var(--border-subtle)]">
                  <a
                    href="/wallet"
                    className="block p-2 px-3 text-sm text-[var(--accent)] hover:bg-[var(--surface-hover)] text-center font-medium"
                  >
                    + Deposit SOL
                  </a>
                </div>
              </div>
            )}
          </div>
        )}


        {/* Wallet Connection */}
        {publicKey ? (
          <div className="flex items-center h-9 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-lg pl-3 pr-1 gap-2 hover:border-[var(--border)] transition-colors">
            <span className="text-sm font-medium text-[var(--foreground)]">
              {formatAddress(publicKey.toBase58())}
            </span>
            <button
              onClick={() => disconnect()}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--danger-bg)] text-[var(--muted)] hover:text-[var(--danger)] transition-colors"
              title="Disconnect"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        ) : (
          <button
            onClick={() => setVisible(true)}
            className="h-9 px-4 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] transition-colors shadow-lg shadow-[rgba(44,156,219,0.2)]"
          >
            Connect Wallet
          </button>
        )}
      </div>
    </header>
  );
};

export default Header;
