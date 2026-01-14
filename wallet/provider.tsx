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
  const endpoint =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://devnet.helius-rpc.com/?api-key=3738ac42-c712-4b79-9384-c5ce9037efed";

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
