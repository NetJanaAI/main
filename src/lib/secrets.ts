const DEV_HMAC_SECRET = 'dev-safety-fallback-do-not-use-in-prod';
const LEGACY_DEV_SECRETS = new Set([
    DEV_HMAC_SECRET,
    'dev-placeholder-long-random-string-32-chars',
    'outreach-dev-secret',
    'audit_secret',
    'netjana_alpha_secret_2026',
    'dev-safety-fallback',
    'dev-safety-fallback-api-key-secret-do-not-use-in-prod'
]);

export function isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
}

// The dev fallbacks below are public in the repo, so they are only for development and test.
// Any other NODE_ENV (including unset) must configure real secrets.
export function devFallbacksAllowed(): boolean {
    return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
}

export function getHmacSecret(purpose: string = 'HMAC signing'): string {
    const secret = process.env.HMAC_SECRET;

    if (!devFallbacksAllowed() && (!secret || LEGACY_DEV_SECRETS.has(secret))) {
        throw new Error(`[Secrets] HMAC_SECRET must be set to a strong non-development value for ${purpose}.`);
    }

    return secret || DEV_HMAC_SECRET;
}

/**
 * P0-B Fix: Returns the 32-byte encryption key for credential storage.
 * Uses a DEDICATED env var (CREDENTIAL_ENCRYPTION_KEY) — intentionally separate
 * from HMAC_SECRET so that key rotation of one does not invalidate the other.
 *
 * Generate a key: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
export function getEncryptionKey(): Buffer {
    const keyHex = process.env.CREDENTIAL_ENCRYPTION_KEY;

    if (!devFallbacksAllowed() && !keyHex) {
        throw new Error(
            '[Secrets] CREDENTIAL_ENCRYPTION_KEY must be set outside development and test. ' +
            'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
        );
    }

    const DEV_FALLBACK = 'dead'.repeat(16);
    const hex = keyHex || DEV_FALLBACK;

    if (hex.length !== 64) {
        throw new Error('[Secrets] CREDENTIAL_ENCRYPTION_KEY must be 32 bytes (64 hex characters).');
    }

    return Buffer.from(hex, 'hex');
}

export function getApiKeySecret(): string {
    const secret = process.env.API_KEY_SECRET;

    if (!devFallbacksAllowed() && (!secret || LEGACY_DEV_SECRETS.has(secret))) {
        throw new Error(`[Secrets] API_KEY_SECRET must be set to a strong non-development value outside development and test.`);
    }

    return secret || 'dev-safety-fallback-api-key-secret-do-not-use-in-prod';
}

export { DEV_HMAC_SECRET };

