const DEV_HMAC_SECRET = 'dev-safety-fallback-do-not-use-in-prod';
const LEGACY_DEV_SECRETS = new Set([
    DEV_HMAC_SECRET,
    'dev-placeholder-long-random-string-32-chars',
    'outreach-dev-secret',
    'audit_secret',
    'netjana_alpha_secret_2026',
    'dev-safety-fallback'
]);

export function isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
}

export function getHmacSecret(purpose: string = 'HMAC signing'): string {
    const secret = process.env.HMAC_SECRET;

    if (isProduction() && (!secret || LEGACY_DEV_SECRETS.has(secret))) {
        throw new Error(`[Secrets] HMAC_SECRET must be set to a strong non-development value for ${purpose}.`);
    }

    return secret || DEV_HMAC_SECRET;
}

export function getEncryptionKey(): string {
    return getHmacSecret('credential encryption').slice(0, 32).padEnd(32, '0');
}

export { DEV_HMAC_SECRET };
