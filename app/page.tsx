"use client";

import { useState } from "react";
import Header from "@/components/header";
import Padder from "@/components/padder";
import EventGrid from "@/components/event-grid";
import MarketModal from "@/components/market-modal";
import { PredictEvent } from "@/lib/jup-predict";

const Page = () => {
  const [searchSelectedEvent, setSearchSelectedEvent] = useState<PredictEvent | null>(null);

  return (
    <Padder>
      <Header onSearchSelect={setSearchSelectedEvent} />
      <div className="header-separator" />
      <EventGrid />

      {/* Footer */}
      <footer className="app-footer">
        <div className="footer-content">
          <span className="footer-brand">© {new Date().getFullYear()} WHISPI</span>
          <span className="footer-divider">•</span>
          <span className="footer-powered">
            Powered by
            <img
              src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png"
              alt="Solana"
              className="footer-solana-icon"
            />
            Solana
          </span>
        </div>
      </footer>

      {/* Modal for search results */}
      <MarketModal
        event={searchSelectedEvent}
        onClose={() => setSearchSelectedEvent(null)}
      />
    </Padder>
  );
};

export default Page;

