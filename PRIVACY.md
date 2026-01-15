# Privacy Model

WhispMarket is designed with privacy as a core feature, not an afterthought. This document explains what data is protected, what trust assumptions exist, and how the system achieves confidentiality.

## 🔐 Privacy Guarantees

### 1. Bet Amount Privacy

**Mechanism**: Client-side AES-256-GCM encryption using wallet signature as key material

```
Encryption Key = PBKDF2(WalletSignature, WalletAddress, 100000 iterations)
Encrypted Bet = AES-GCM(Key, {amount, outcome, odds})
```

**Guarantee**: The server stores only encrypted blobs. Without your wallet's signature, the bet amounts cannot be decrypted.

**Trust assumption**: You trust your local browser environment.

### 2. Token Balance Privacy

**Mechanism**: Inco confidential token standard (FHE-based encryption)

**Guarantee**: Token balances are encrypted on-chain. Only the account owner can decrypt their balance.

**Trust assumption**: You trust the Inco cryptographic implementation and network.

### 3. On-Chain Verifiability

**Mechanism**: Commitment memos attached to transfer transactions

```
Memo Format: WM:{"v":1,"c":"<commitment_hash>","n":"<nullifier>","m":"<market_id>"}
```

**Guarantee**: Anyone can verify that a bet commitment exists on-chain without knowing the bet details.

**Trust assumption**: Solana blockchain integrity.

### 4. Double-Claim Prevention

**Mechanism**: Nullifier tracking (on-chain + database)

**Guarantee**: Each bet can only be claimed once. Nullifiers are derived from bet commitments and stored when winnings are paid out.

**Trust assumption**: Database integrity for claim processing.

## 🔓 What IS Visible

| Data | Visible To | Notes |
|------|-----------|-------|
| Market IDs | Server | We know which markets you bet on |
| Bet timestamps | Server | We know when you placed bets |
| Commitment hashes | Public | Proves bet exists, not its contents |
| Claim attempts | Server | We know when you try to claim |
| Transaction signatures | Public | Blockchain transactions are public |

## 🔒 What IS NOT Visible

| Data | Protected By | Notes |
|------|-------------|-------|
| Bet amounts | Client encryption | AES-256-GCM with wallet-derived key |
| Bet outcomes | Client encryption | Encrypted alongside amounts |
| Token balances | Inco FHE | Confidential token standard |
| Decrypted portfolio | User action | Only revealed when user decrypts |

## 🏛️ Trust Model

### Trusted Components

1. **Your Wallet** - Signs messages to derive encryption keys
2. **Your Browser** - Executes encryption/decryption
3. **Inco Network** - Provides confidential token infrastructure
4. **Solana Blockchain** - Transaction finality and memo storage

### Partially Trusted

1. **WhispMarket Server**
   - Sees encrypted data (cannot decrypt)
   - Processes claims (validates proofs)
   - Knows market participation (not amounts)

### Not Trusted (by design)

1. **Other Users** - Cannot see your bets or balances
2. **External Observers** - On-chain data is commitments only

## 🛡️ Attack Vectors & Mitigations

### Server Compromise

**Risk**: Attacker gains database access

**Mitigation**: Bet details are encrypted. Attacker sees only:
- Ciphertext (useless without wallet signature)
- Commitment hashes (reveals nothing)
- Market IDs (only participation data)

**Cannot**: Decrypt amounts, steal funds (vault key separate)

### Vault Key Compromise

**Risk**: Attacker gets VAULT_SECRET_KEY

**Mitigation**: 
- Key should be in secure enclave/HSM in production
- Multi-sig vault recommended for mainnet
- Funds at risk, but bet privacy preserved

### Client-Side Attack (XSS)

**Risk**: Malicious script in browser

**Mitigation**: 
- Standard web security practices (CSP, etc.)
- Signature caching is time-limited
- Users should verify site authenticity

### Correlation Attack

**Risk**: Matching on-chain transfers to bets

**Mitigation**:
- Confidential token amounts are encrypted
- Transfer timing provides some correlation
- Future: Batched/delayed settlement for better privacy

## 📊 Privacy Comparison

| Feature | WhispMarket | Traditional Betting | Polymarket |
|---------|-------------|-------------------|------------|
| Bet amounts | Encrypted | Plaintext | On-chain visible |
| Balances | Confidential | Server knows | On-chain visible |
| Participation | Server knows | Server knows | Public |
| Verifiable | Yes (on-chain) | No | Yes |
| Self-custody | Yes | No | Yes |

## 🔮 Future Improvements

1. **Full ZK Claims** - Replace simplified proofs with real ZK-SNARKs
2. **Mixer Integration** - Break transfer correlation
3. **Multi-sig Vault** - Decentralized fund custody
4. **Client-Side Oracle** - Verify market results locally
5. **Homomorphic Aggregation** - Server computes on encrypted data

## ❓ FAQ

**Q: Can WhispMarket see how much I bet?**
A: No. Bet amounts are encrypted client-side before being stored.

**Q: Can I verify my bet exists?**
A: Yes. The commitment memo is on-chain. You can verify it matches your bet.

**Q: What if I lose my wallet?**
A: Encrypted bets cannot be decrypted without the wallet signature. Unclaimed winnings are auto-settled after 48 hours to the original wallet.

---

