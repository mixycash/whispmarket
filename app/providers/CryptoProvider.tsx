"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getCachedOrDeriveKey } from "@/lib/crypto";

interface CryptoContextState {
    cryptoKey: CryptoKey | null;
    isDeriving: boolean;
    deriveSessionKey: (
        walletAddress: string,
        signMessage: (message: Uint8Array) => Promise<Uint8Array>
    ) => Promise<CryptoKey | null>;
    clearSessionKey: () => void;
}

const CryptoContext = createContext<CryptoContextState>({
    cryptoKey: null,
    isDeriving: false,
    deriveSessionKey: async () => null,
    clearSessionKey: () => { },
});

export function CryptoProvider({ children }: { children: ReactNode }) {
    const { publicKey } = useWallet();
    const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null);
    const [isDeriving, setIsDeriving] = useState(false);

    // Derived key on mount if available in cache
    useEffect(() => {
        if (!publicKey) {
            setCryptoKey(null);
            return;
        }

        const loadKey = async () => {
            setIsDeriving(true);
            try {
                // Try to get from cache without signing first
                // getCachedOrDeriveKey will return key if cached signature exists
                // We pass undefined for signMessage to ensure we don't trigger popup
                const key = await getCachedOrDeriveKey(publicKey.toBase58());
                if (key) {
                    setCryptoKey(key);
                    console.log("[CryptoProvider] Session key restored from cache");
                }
            } catch (e) {
                console.error("Failed to restore session key:", e);
            } finally {
                setIsDeriving(false);
            }
        };

        loadKey();
    }, [publicKey]);

    const deriveSessionKey = async (
        walletAddress: string,
        signer: (message: Uint8Array) => Promise<Uint8Array>
    ): Promise<CryptoKey | null> => {
        if (cryptoKey) return cryptoKey;

        setIsDeriving(true);
        try {
            const key = await getCachedOrDeriveKey(walletAddress, signer);
            setCryptoKey(key);
            return key;
        } catch (e) {
            console.error("Failed to derive session key:", e);
            return null;
        } finally {
            setIsDeriving(false);
        }
    };

    const clearSessionKey = () => {
        setCryptoKey(null);
    };

    return (
        <CryptoContext.Provider value={{ cryptoKey, isDeriving, deriveSessionKey, clearSessionKey }}>
            {children}
        </CryptoContext.Provider>
    );
}

export const useCrypto = () => useContext(CryptoContext);
