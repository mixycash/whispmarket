import type { Metadata } from "next";
import { Urbanist, Outfit } from "next/font/google";
import "./globals.css";
import WalletProvider from "@/wallet/provider";
import { CryptoProvider } from "@/app/providers/CryptoProvider";

const urbanist = Urbanist({
  variable: "--font-urbanist",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "WHISPI | Confidential Prediction Markets",
  description: "Trade privately on prediction markets with Inco network.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${urbanist.variable} ${outfit.variable} font-sans antialiased`} suppressHydrationWarning>
        <WalletProvider>
          <CryptoProvider>{children}</CryptoProvider>
        </WalletProvider>
      </body>
    </html>
  );
}