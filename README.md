# Whispi 🔒

**Open-Source Privacy-First Confidential Betting Layer on Solana**

A lightweight confidential betting application that wraps prediction market data with privacy-preserving token infrastructure. Uses existing Solana programs (Inco) — no new deployments required.

## ✨ Why Whispi?

| Feature | Whispi | Polymarket |
|---------|-------------|------------|
| Bet amounts | 🔒 Encrypted | 🔓 Public |
| Token balances | 🔒 Confidential | 🔓 Public |
| On-chain verifiable | ✅ Yes | ✅ Yes |
| Self-custody | ✅ Yes | ✅ Yes |

## 🎯 Core Features

- **Client-Side Encryption** — Bet amounts encrypted with wallet-derived keys (AES-256-GCM)
- **Confidential Tokens** — Inco FHE-encrypted balances (server never sees amounts)
- **On-Chain Commitments** — Verifiable bet proofs via transaction memos
- **Fixed-Odds Bookmaker** — Vault honors quoted odds at bet placement
- **User-Initiated Claims** — Claim winnings with proof validation
- **Jupiter Predict Integration** — Real-time markets from Jupiter's API

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT SIDE                          │
├─────────────────────────────────────────────────────────────┤
│  1. Bet encrypted client-side (AES-256-GCM)                 │
│  2. Confidential token transfer to PROTOCOL_VAULT           │
│  3. Commitment hash attached as memo                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        SERVER SIDE                          │
├─────────────────────────────────────────────────────────────┤
│  • Stores ENCRYPTED bet records (cannot decrypt)            │
│  • Validates claim proofs                                   │
│  • Releases fixed-odds payouts from vault                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     ON-CHAIN (SOLANA)                       │
├─────────────────────────────────────────────────────────────┤
│  • Inco confidential token program                          │
│  • Commitment memos (verifiable by anyone)                  │
│  • PROTOCOL_VAULT holds liquidity pool                      │
└─────────────────────────────────────────────────────────────┘
```

## 🔐 Privacy Model

### What the Server CAN'T See
- Actual bet amounts (client-encrypted)
- Wallet balances (Inco FHE encryption)
- Decrypted portfolio data

### What Anyone CAN Verify
- Commitment memos on-chain
- Nullifier usage (prevents double-claims)
- Protocol vault balance

## 💰 Economic Model

- **Fixed-Odds Bookmaker**: Vault honors the odds quoted at bet placement
- **Protocol Fee**: 2% on winning payouts
- **Liquidity Pool**: 1M initial vault liquidity
- **Daily Faucet Limit**: 500 tokens per wallet per day

### Payout Calculation
```
Payout = BetAmount × Odds × (1 - 0.02)
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- pnpm
- Solana wallet (Phantom, Backpack, etc.)

### Installation

```bash
git clone https://github.com/your-org/whispmarket.git
cd whispmarket
pnpm install
cp .env.example .env.local
pnpm dev
```

### Environment Variables

VAULT_WALLET=
TREASURY_WALLET=
VAULT_SECRET_KEY=
TREASURY_SECRET_KEY=
HELIUS_API_KEY=
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
DATABASE_URL

## 📁 Project Structure

```
whispi/
├── app/
│   ├── api/claim/       # User-initiated claim endpoint
│   ├── portfolio/       # Bet portfolio view
│   └── wallet/          # Token faucet & transfers
├── components/
│   ├── market-modal.tsx # Betting interface
│   └── event-grid.tsx   # Market listings
├── lib/
│   ├── confidential-betting.ts  # Betting orchestration
│   ├── confidential-transfer.ts # Inco transfers
│   ├── crypto.ts                # AES-256-GCM encryption
│   ├── nullifier-chain.ts       # On-chain nullifier parsing
│   └── bet-commitment.ts        # Commitment generation
└── scripts/
    └── settlement-bot.ts        # 48h backup settlement
```

## 🔄 Flow

1. **Place Bet** → Encrypt client-side → Transfer to vault → Store commitment
2. **Market Closes** → Result from Jupiter API
3. **Claim** → Generate proof → Server validates → Payout at fixed odds
4. **Backup** → Unclaimed bets auto-settled after 48h

## 🛠️ Development

```bash
pnpm exec tsc --noEmit          # Type check
pnpm build                       # Production build
pnpm exec ts-node scripts/settlement-bot.ts  # Run backup bot
```

## ⚠️ Disclaimer

Experimental devnet software. Not audited. Use at your own risk.

---

**Built with 🔒 for confidential betting on Solana**
