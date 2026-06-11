/**
 * CredentialVault — AES-256-GCM encryption for data_source_credentials.
 *
 * P0-B Fix: Credentials were stored in plaintext. This module provides
 * encrypt/decrypt helpers used by api-manager routes on every read/write.
 *
 * Storage format: `iv:authTag:ciphertext` (all hex-encoded, colon-separated).
 *
 * Key: 32-byte buffer derived from CREDENTIAL_ENCRYPTION_KEY env var (64 hex chars).
 * In development without the key, uses a deterministic dev fallback with a loud warning.
 *
 * IMPORTANT: Rotating the key requires re-encrypting all stored credentials.
 * Run `scripts/migrate-credentials.ts` after any key rotation.
 */

import crypto from 'crypto';

const DEV_FALLBACK_KEY = 'dev0000000000000000000000000000000000000000000000000000000000000000';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;  // 96-bit IV — GCM recommended size
const TAG_LENGTH = 16; // 128-bit auth tag

function getKeyBuffer(): Buffer {
    const keyHex = process.env.CREDENTIAL_ENCRYPTION_KEY;
    const isProd = process.env.NODE_ENV === 'production';

    if (!keyHex) {
        if (isProd) {
            throw new Error(
                '[CredentialVault] CREDENTIAL_ENCRYPTION_KEY must be set in production. ' +
                'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
            );
        }
        // Dev only — warn once per process
        if (!_devWarnShown) {
            console.warn('[CredentialVault] ⚠️  CREDENTIAL_ENCRYPTION_KEY not set. Using dev fallback — NOT for production.');
            _devWarnShown = true;
        }
        return Buffer.from(DEV_FALLBACK_KEY, 'hex');
    }

    if (keyHex.length !== 64) {
        throw new Error('[CredentialVault] CREDENTIAL_ENCRYPTION_KEY must be 32 bytes (64 hex chars).');
    }

    return Buffer.from(keyHex, 'hex');
}

let _devWarnShown = false;

/**
 * Encrypts a plaintext credential string.
 * Returns a storage-safe string in the format: `iv:authTag:ciphertext` (hex).
 */
export function encryptCredential(plaintext: string): string {
    const key = getKeyBuffer();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
        iv.toString('hex'),
        authTag.toString('hex'),
        encrypted.toString('hex')
    ].join(':');
}

/**
 * Decrypts a credential string produced by `encryptCredential()`.
 * Throws on authentication failure (tampered ciphertext).
 */
export function decryptCredential(stored: string): string {
    // Handle plaintext legacy values that were stored before encryption was enabled.
    // A valid encrypted value always contains exactly 2 colons separating iv:tag:ciphertext.
    const parts = stored.split(':');
    if (parts.length !== 3) {
        // Not in encrypted format — treat as plaintext (migration pending)
        console.warn('[CredentialVault] ⚠️  Decrypting a value that does not appear to be encrypted. Run the migration script.');
        return stored;
    }

    const [ivHex, authTagHex, encryptedHex] = parts;

    try {
        const key = getKeyBuffer();
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const encrypted = Buffer.from(encryptedHex, 'hex');

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
        decipher.setAuthTag(authTag);

        return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
    } catch (e: any) {
        throw new Error(`[CredentialVault] Decryption failed — ciphertext may be tampered or key mismatch: ${e.message}`);
    }
}

/**
 * Returns true if a stored value is already in encrypted format.
 * Used by the migration script to skip already-encrypted rows.
 */
export function isEncrypted(stored: string): boolean {
    const parts = stored.split(':');
    if (parts.length !== 3) return false;
    // Check that all three parts are valid hex strings of expected lengths
    const [ivHex, authTagHex] = parts;
    return ivHex.length === IV_LENGTH * 2 && authTagHex.length === TAG_LENGTH * 2;
}
