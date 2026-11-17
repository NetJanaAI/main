import { queryWithOrg } from '../lib/database';
import { decryptCredential, encryptCredential } from '../lib/credentialVault';

export interface CmfConfig {
    apiBaseUrl: string;
    apiKey: string;
    hmacSecret: string;
    source: 'tenant' | 'env';
}

export interface CmfConnectionInput {
    apiBaseUrl: string;
    apiKey: string;
    hmacSecret: string;
}

export type CmfConnectionSummary =
    | { configured: false }
    | { configured: true; source: 'tenant' | 'env'; api_base_url: string; key_hint: string; updated_at?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function envFallbackConfig(organizationId: string): CmfConfig | null {
    const allowed = (process.env.CRAFTMYFUNNEL_ENV_FALLBACK_ORGS || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    if (!allowed.includes(organizationId)) return null;

    const apiBaseUrl = process.env.CRAFTMYFUNNEL_API_BASE_URL;
    const apiKey = process.env.CRAFTMYFUNNEL_API_KEY;
    const hmacSecret = process.env.CRAFTMYFUNNEL_NETJANA_HMAC_SECRET;
    if (!apiBaseUrl || !apiKey || !hmacSecret) return null;
    return { apiBaseUrl, apiKey, hmacSecret, source: 'env' };
}

async function resolve(organizationId: string): Promise<(CmfConfig & { updatedAt?: string }) | null> {
    if (!UUID_RE.test(organizationId || '')) return null;

    const result = await queryWithOrg(
        'SELECT api_base_url, api_key_enc, hmac_secret_enc, updated_at FROM craftmyfunnel_connections WHERE organization_id = $1',
        [organizationId],
        organizationId
    );
    const row = result.rows[0];
    if (row) {
        return {
            apiBaseUrl: row.api_base_url,
            apiKey: decryptCredential(row.api_key_enc),
            hmacSecret: decryptCredential(row.hmac_secret_enc),
            source: 'tenant',
            updatedAt: row.updated_at,
        };
    }
    return envFallbackConfig(organizationId);
}

/**
 * The CraftMyFunnel credentials for this tenant, or null. A tenant with no connection of its own
 * only gets the global env credentials when it is named in CRAFTMYFUNNEL_ENV_FALLBACK_ORGS.
 */
export async function getCmfConfig(organizationId: string): Promise<CmfConfig | null> {
    const config = await resolve(organizationId);
    if (!config) return null;
    const { updatedAt: _updatedAt, ...rest } = config;
    if (rest.source === 'env') {
        console.warn(`[CraftMyFunnel] Tenant ${organizationId} is using the global env credentials (CRAFTMYFUNNEL_ENV_FALLBACK_ORGS); give it its own connection.`);
    }
    return rest;
}

export async function saveCmfConnection(organizationId: string, input: CmfConnectionInput): Promise<void> {
    await queryWithOrg(
        `INSERT INTO craftmyfunnel_connections (organization_id, api_base_url, api_key_enc, hmac_secret_enc)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (organization_id) DO UPDATE
         SET api_base_url = EXCLUDED.api_base_url,
             api_key_enc = EXCLUDED.api_key_enc,
             hmac_secret_enc = EXCLUDED.hmac_secret_enc,
             updated_at = NOW()`,
        [organizationId, input.apiBaseUrl, encryptCredential(input.apiKey), encryptCredential(input.hmacSecret)],
        organizationId
    );
}

export async function deleteCmfConnection(organizationId: string): Promise<void> {
    await queryWithOrg(
        'DELETE FROM craftmyfunnel_connections WHERE organization_id = $1',
        [organizationId],
        organizationId
    );
}

/** What the dashboard may show: where the tenant pushes and the last 4 characters of the key. */
export async function getCmfConnectionSummary(organizationId: string): Promise<CmfConnectionSummary> {
    const config = await resolve(organizationId);
    if (!config) return { configured: false };
    return {
        configured: true,
        source: config.source,
        api_base_url: config.apiBaseUrl,
        key_hint: config.apiKey.length <= 4 ? '***' : `***${config.apiKey.slice(-4)}`,
        ...(config.updatedAt ? { updated_at: config.updatedAt } : {}),
    };
}
