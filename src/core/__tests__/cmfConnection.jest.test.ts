export {};
// Each tenant pushes to its own CraftMyFunnel workspace. The global env credentials only
// serve tenants named in CRAFTMYFUNNEL_ENV_FALLBACK_ORGS.
const queryWithOrg = jest.fn();
jest.mock('../../lib/database', () => ({ queryWithOrg, query: jest.fn() }));

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

const env = { ...process.env };
let mod: typeof import('../cmfConnection');
let vault: typeof import('../../lib/credentialVault');

beforeEach(async () => {
    jest.resetModules();
    process.env = { ...env, CREDENTIAL_ENCRYPTION_KEY: 'ab'.repeat(32) };
    delete process.env.CRAFTMYFUNNEL_ENV_FALLBACK_ORGS;
    process.env.CRAFTMYFUNNEL_API_BASE_URL = 'https://env.example.com';
    process.env.CRAFTMYFUNNEL_API_KEY = 'env-key';
    process.env.CRAFTMYFUNNEL_NETJANA_HMAC_SECRET = 'env-secret';
    queryWithOrg.mockReset().mockResolvedValue({ rows: [] });
    vault = await import('../../lib/credentialVault');
    mod = await import('../cmfConnection');
});
afterAll(() => { process.env = env; });

describe('getCmfConfig', () => {
    it('returns the tenant own decrypted credentials, looked up under that tenant', async () => {
        queryWithOrg.mockResolvedValue({ rows: [{
            api_base_url: 'https://a.example.com',
            api_key_enc: vault.encryptCredential('key-a'),
            hmac_secret_enc: vault.encryptCredential('secret-a'),
        }] });
        const cfg = await mod.getCmfConfig(ORG_A);
        expect(cfg).toEqual({ apiBaseUrl: 'https://a.example.com', apiKey: 'key-a', hmacSecret: 'secret-a', source: 'tenant' });
        expect(queryWithOrg.mock.calls[0][1]).toEqual([ORG_A]);
        expect(queryWithOrg.mock.calls[0][2]).toBe(ORG_A);
    });

    it('does not hand the global env credentials to a tenant with no connection', async () => {
        expect(await mod.getCmfConfig(ORG_B)).toBeNull();
    });

    it('uses the env credentials for an allowlisted tenant and says so in the log', async () => {
        process.env.CRAFTMYFUNNEL_ENV_FALLBACK_ORGS = ` ${ORG_B} , other `;
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const cfg = await mod.getCmfConfig(ORG_B);
        expect(cfg).toEqual({ apiBaseUrl: 'https://env.example.com', apiKey: 'env-key', hmacSecret: 'env-secret', source: 'env' });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(ORG_B));
        expect(await mod.getCmfConfig(ORG_A)).toBeNull();
        warn.mockRestore();
    });

    it('prefers the tenant own connection over the env fallback', async () => {
        process.env.CRAFTMYFUNNEL_ENV_FALLBACK_ORGS = ORG_A;
        queryWithOrg.mockResolvedValue({ rows: [{
            api_base_url: 'https://a.example.com',
            api_key_enc: vault.encryptCredential('key-a'),
            hmac_secret_enc: vault.encryptCredential('secret-a'),
        }] });
        expect((await mod.getCmfConfig(ORG_A))?.source).toBe('tenant');
    });

    it('returns null and skips the database for an id that is not a tenant uuid', async () => {
        expect(await mod.getCmfConfig('default')).toBeNull();
        expect(await mod.getCmfConfig('')).toBeNull();
        expect(queryWithOrg).not.toHaveBeenCalled();
    });
});

describe('saveCmfConnection', () => {
    it('stores the key and secret encrypted, never in plaintext', async () => {
        await mod.saveCmfConnection(ORG_A, { apiBaseUrl: 'https://a.example.com', apiKey: 'key-a', hmacSecret: 'secret-a' });
        const [sql, params, org] = queryWithOrg.mock.calls[0];
        expect(sql).toMatch(/INSERT INTO craftmyfunnel_connections/);
        expect(sql).toMatch(/ON CONFLICT \(organization_id\) DO UPDATE/);
        expect(org).toBe(ORG_A);
        expect(params).not.toContain('key-a');
        expect(params).not.toContain('secret-a');
        expect(params.map((p: any) => (vault.isEncrypted(String(p)) ? vault.decryptCredential(String(p)) : p)))
            .toEqual(expect.arrayContaining(['key-a', 'secret-a']));
    });
});

describe('getCmfConnectionSummary', () => {
    it('reports the connection without any secret', async () => {
        queryWithOrg.mockResolvedValue({ rows: [{
            api_base_url: 'https://a.example.com',
            api_key_enc: vault.encryptCredential('key-abcdef1234'),
            hmac_secret_enc: vault.encryptCredential('secret-a'),
            updated_at: '2026-06-01T00:00:00.000Z',
        }] });
        const s = await mod.getCmfConnectionSummary(ORG_A);
        expect(s).toEqual({ configured: true, source: 'tenant', api_base_url: 'https://a.example.com', key_hint: '***1234', updated_at: '2026-06-01T00:00:00.000Z' });
        expect(JSON.stringify(s)).not.toContain('abcdef');
    });

    it('is not configured for a tenant with nothing, even when env credentials exist', async () => {
        expect(await mod.getCmfConnectionSummary(ORG_A)).toEqual({ configured: false });
    });
});
