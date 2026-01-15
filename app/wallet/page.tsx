"use client";

import { useState } from "react";
import Header from "@/components/header";
import Padder from "@/components/padder";
import EncryptedInput from "@/components/encrypted-input";
import Transfer from "@/components/transfer";

type Tab = "mint" | "transfer";

export default function WalletPage() {
    const [activeTab, setActiveTab] = useState<Tab>("mint");

    return (
        <Padder>
            <Header />
            <div className="header-separator" />

            <div className="page-container">
                <div style={{ marginBottom: "1.25rem" }}>
                    <h1 className="page-title">Wallet</h1>
                    <p className="page-subtitle">Manage your confidential tokens</p>
                </div>

                <div className="page-card">
                    <div className="page-card-header">
                        <button
                            onClick={() => setActiveTab("mint")}
                            className={`page-tab ${activeTab === "mint" ? "active" : ""}`}
                        >
                            🪙 Mint
                        </button>
                        <button
                            onClick={() => setActiveTab("transfer")}
                            className={`page-tab ${activeTab === "transfer" ? "active" : ""}`}
                        >
                            📤 Transfer
                        </button>
                    </div>

                    <div className="page-card-body">
                        {activeTab === "mint" && (
                            <div>
                                <h2 className="page-section-title">Mint Tokens</h2>
                                <p className="page-section-desc">Create encrypted confidential tokens</p>
                                <EncryptedInput />
                            </div>
                        )}

                        {activeTab === "transfer" && (
                            <div>
                                <h2 className="page-section-title">Transfer Tokens</h2>
                                <p className="page-section-desc">Send tokens to another wallet</p>
                                <Transfer />
                            </div>
                        )}
                    </div>
                </div>

                <div className="info-notice">
                    <span className="info-notice-icon">🔐</span>
                    <p>All token amounts are encrypted on-chain using Inco Network.</p>
                </div>
            </div>
        </Padder>
    );
}
