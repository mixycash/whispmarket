"use client";

import Header from "@/components/header";
import Padder from "@/components/padder";
import DepositSol from "@/components/deposit-sol";
import Balance from "@/components/balance";

export default function WalletPage() {
    return (
        <Padder>
            <Header />
            <div className="header-separator" />

            <div className="page-container">
                <div style={{ marginBottom: "1.25rem" }}>
                    <h1 className="page-title">Deposit</h1>
                </div>

                <div className="page-card">
                    <div className="page-card-body">
                        <div style={{ marginBottom: "1.5rem" }}>
                            <Balance />
                        </div>
                        <div className="card-separator" style={{ margin: "1.5rem 0", height: "1px", background: "var(--border-subtle)" }} />
                        <DepositSol />
                    </div>
                </div>

                <div className="info-notice">
                    <p>🔐 Your SOL is wrapped and encrypted on-chain. Only you decrypt your balance.</p>
                </div>
            </div>
        </Padder>
    );
}
