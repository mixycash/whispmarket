"use client";

import Header from "@/components/header";
import Padder from "@/components/padder";
import DepositSol from "@/components/deposit-sol";

export default function WalletPage() {
    return (
        <Padder>
            <Header />
            <div className="header-separator" />

            <div className="page-container">
                <div style={{ marginBottom: "1.25rem" }}>
                    <h1 className="page-title">Deposit</h1>
                    <p className="page-subtitle">Convert SOL to confidential betting balance</p>
                </div>

                <div className="page-card">
                    <div className="page-card-body">
                        <DepositSol />
                    </div>
                </div>

                <div className="info-notice" style={{ marginTop: "1rem" }}>
                    <span className="info-notice-icon">🔐</span>
                    <p>Your SOL is wrapped and encrypted on-chain. Only you can see your balance.</p>
                </div>
            </div>
        </Padder>
    );
}
