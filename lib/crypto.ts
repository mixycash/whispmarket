/**
 * Client-Side Encryption for Confidential Bets
 * 
 * Uses wallet signature as encryption key source.
 * Only the user with their wallet can decrypt their own bets.
 * Server sees only encrypted blobs + commitments.
 */

// Derive AES key from wallet signature (deterministic per wallet)
const ENCRYPTION_MESSAGE = "WhispMarket-Encrypt-Bets-v1";

export interface EncryptedBetData {
    ciphertext: string;     // Base64 encrypted data
    iv: string;             // Initialization vector
    salt: string;           // Salt for key derivation
}

export interface DecryptedBetData {
    amount: number;
    outcome: "yes" | "no";
    odds?: number;
    potentialPayout?: number;
}

/**
 * Sign a message with the wallet to derive encryption material
 * This creates a deterministic key per wallet
 */
export async function deriveKeyFromWallet(
    signMessage: (message: Uint8Array) => Promise<Uint8Array>,
    walletAddress: string
): Promise<CryptoKey> {
    // Sign a deterministic message to get wallet-specific material
    const messageBytes = new TextEncoder().encode(`${ENCRYPTION_MESSAGE}:${walletAddress}`);
    const signature = await signMessage(messageBytes);

    // Use signature as key material
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        signature.slice(0, 32), // Use first 32 bytes
        "PBKDF2",
        false,
        ["deriveKey"]
    );

    // Derive AES-GCM key
    const salt = new TextEncoder().encode(walletAddress);
    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt,
            iterations: 100000,
            hash: "SHA-256",
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

/**
 * Derive key using cached signature from localStorage
 * Falls back if no cached signature available
 */
export async function getCachedOrDeriveKey(
    walletAddress: string,
    signMessage?: (message: Uint8Array) => Promise<Uint8Array>
): Promise<CryptoKey | null> {
    const cacheKey = `whisp_sig_${walletAddress}`;

    // Try to get cached signature
    if (typeof window !== "undefined") {
        const cachedSig = localStorage.getItem(cacheKey);
        if (cachedSig) {
            const sigBytes = Uint8Array.from(atob(cachedSig), c => c.charCodeAt(0));
            const keyMaterial = await crypto.subtle.importKey(
                "raw",
                sigBytes.slice(0, 32),
                "PBKDF2",
                false,
                ["deriveKey"]
            );
            const salt = new TextEncoder().encode(walletAddress);
            return crypto.subtle.deriveKey(
                {
                    name: "PBKDF2",
                    salt,
                    iterations: 100000,
                    hash: "SHA-256",
                },
                keyMaterial,
                { name: "AES-GCM", length: 256 },
                false,
                ["encrypt", "decrypt"]
            );
        }
    }

    // If no cache and signMessage provided, create new
    if (signMessage) {
        const messageBytes = new TextEncoder().encode(`${ENCRYPTION_MESSAGE}:${walletAddress}`);
        const signature = await signMessage(messageBytes);

        // Cache the signature
        if (typeof window !== "undefined") {
            localStorage.setItem(cacheKey, btoa(String.fromCharCode(...signature)));
        }

        return deriveKeyFromWallet(signMessage, walletAddress);
    }

    return null;
}

/**
 * Encrypt bet data using wallet-derived key
 */
export async function encryptBetData(
    data: DecryptedBetData,
    key: CryptoKey
): Promise<EncryptedBetData> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(data));

    const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        plaintext
    );

    return {
        ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
        iv: btoa(String.fromCharCode(...iv)),
        salt: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))),
    };
}

/**
 * Decrypt bet data using wallet-derived key
 */
export async function decryptBetData(
    encrypted: EncryptedBetData,
    key: CryptoKey
): Promise<DecryptedBetData | null> {
    try {
        const ciphertext = Uint8Array.from(atob(encrypted.ciphertext), c => c.charCodeAt(0));
        const iv = Uint8Array.from(atob(encrypted.iv), c => c.charCodeAt(0));

        const plaintext = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            key,
            ciphertext
        );

        return JSON.parse(new TextDecoder().decode(plaintext));
    } catch (e) {
        console.error("Decryption failed:", e);
        return null;
    }
}

/**
 * Check if user has encryption key cached
 */
export function hasEncryptionKey(walletAddress: string): boolean {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(`whisp_sig_${walletAddress}`) !== null;
}

/**
 * Clear cached encryption key (on wallet disconnect)
 */
export function clearEncryptionKey(walletAddress: string): void {
    if (typeof window === "undefined") return;
    localStorage.removeItem(`whisp_sig_${walletAddress}`);
}
