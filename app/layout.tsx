import type { Metadata } from "next";
import { Urbanist, Space_Grotesk } from "next/font/google";
import "./globals.css";
import WalletProvider from "@/wallet/provider";

const urbanist = Urbanist({
  variable: "--font-urbanist",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
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
      <body className={`${urbanist.variable} ${spaceGrotesk.variable} font-sans antialiased`} suppressHydrationWarning>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}