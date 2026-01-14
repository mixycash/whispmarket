"use client";

import { useState } from "react";
import Header from "@/components/header";
import Padder from "@/components/padder";
import EncryptedInput from "@/components/encrypted-input";
import Transfer from "@/components/transfer";

type Tab = "mint" | "transfer";

const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "mint", label: "Mint", icon: "🪙" },
    { id: "transfer", label: "Transfer", icon: "📤" },
];

export default function WalletPage() {
    const [activeTab, setActiveTab] = useState<Tab>("mint");

    return (
        <Padder>
            <Header />
            <div className="max-w-lg mx-auto mt-8">
                {/* Modal Container - Dark theme */}
                <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden">
                    {/* Tab Header */}
                    <div className="flex border-b border-[var(--border-subtle)]">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex-1 py-4 px-4 text-sm font-medium transition-all duration-200 relative ${activeTab === tab.id
                                        ? "text-[var(--accent)] bg-[var(--background)]"
                                        : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-hover)]"
                                    }`}
                            >
                                <span className="flex items-center justify-center gap-2">
                                    <span>{tab.icon}</span>
                                    <span>{tab.label}</span>
                                </span>
                                {activeTab === tab.id && (
                                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--accent)]" />
                                )}
                            </button>
                        ))}
                    </div>

                    {/* Tab Content */}
                    <div className="p-6">
                        {activeTab === "mint" && (
                            <div className="animate-fade-in">
                                <h2 className="text-xl font-semibold text-[var(--foreground)] mb-2">
                                    Mint Confidential Tokens
                                </h2>
                                <p className="text-sm text-[var(--muted)] mb-6">
                                    Encrypt and mint confidential tokens to your wallet.
                                </p>
                                <EncryptedInput />
                            </div>
                        )}

                        {activeTab === "transfer" && (
                            <div className="animate-fade-in">
                                <h2 className="text-xl font-semibold text-[var(--foreground)] mb-2">
                                    Transfer Tokens
                                </h2>
                                <p className="text-sm text-[var(--muted)] mb-6">
                                    Send confidential tokens to another wallet.
                                </p>
                                <Transfer />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <style jsx>{`
                .animate-fade-in {
                    animation: fadeIn 0.2s ease-in-out;
                }
                @keyframes fadeIn {
                    from {
                        opacity: 0;
                        transform: translateY(4px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
            `}</style>
        </Padder>
    );
}
