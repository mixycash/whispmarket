"use client";

import {
  WalletProvider,
  ConnectionProvider,
} from "@solana/wallet-adapter-react";
import {
  AlphaWalletAdapter,
  LedgerWalletAdapter,
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { useMemo } from "react";
import { clusterApiUrl, Commitment } from "@solana/web3.js";
import dynamic from "next/dynamic";

import "@solana/wallet-adapter-react-ui/styles.css";

const WalletModalProvider = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      ({ WalletModalProvider }) => WalletModalProvider
    ),
  { ssr: false }
);

const WalletConnectionWrapper = dynamic(
  () =>
    import("./wallet-connection-wrapper").then(
      (mod) => mod.WalletConnectionWrapper
    ),
  { ssr: false }
);

export const Wallet = ({ children }: { children: React.ReactNode }) => {
  // Use public devnet RPC for client-side connections
  // Helius API key is kept server-side only via /api/rpc proxy
  const endpoint = "https://api.devnet.solana.com";

  const config: {
    commitment: Commitment;
    wsEndpoint: string;
    confirmTransactionInitialTimeout: number;
  } = {
    commitment: "confirmed",
    wsEndpoint: endpoint.replace("https", "wss"),
    confirmTransactionInitialTimeout: 60000, // 60 seconds
  };

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new AlphaWalletAdapter(),
      new LedgerWalletAdapter(),
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint} config={config}>
      <WalletProvider wallets={wallets} autoConnect={true}>
        <WalletModalProvider>
          <WalletConnectionWrapper>{children}</WalletConnectionWrapper>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

export default Wallet;
