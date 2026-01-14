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

      {/* Modal for search results */}
      <MarketModal
        event={searchSelectedEvent}
        onClose={() => setSearchSelectedEvent(null)}
      />
    </Padder>
  );
};

export default Page;
