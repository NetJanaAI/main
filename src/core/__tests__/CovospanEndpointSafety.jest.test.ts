export {};
const ORG = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

const queryWithOrg = jest.fn();
const validateTargetUrl = jest.fn();
const pinnedPost = jest.fn();

jest.mock('../../lib/database', () => ({ db: { queryWithOrg: (...a: any[]) => queryWithOrg(...a) } }));
jest.mock('../../middleware/urlValidator', () => ({ validateTargetUrl: (...a: any[]) => validateTargetUrl(...a) }));
jest.mock('../../lib/pinnedPost', () => ({ pinnedPost: (...a: any[]) => pinnedPost(...a) }));
jest.mock('../../lib/credentialVault', () => ({ decryptCredential: (v: string) => v, encryptCredential: (v: string) => v }));

const lead = { org_id: ORG, lead_id: '00000000-0000-0000-0000-000000000001', company_name: 'Example', intent_score: 80, verity_tier: 'TIER_1' };

describe('CovospanPusher endpoint safety', () => {
    const originalEnv = process.env;
    const originalFetch = global.fetch;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
        delete process.env.CONVOSPAN_WEBHOOK_URL;
        delete process.env.CONVOSPAN_API_KEY;
        global.fetch = jest.fn();
        queryWithOrg.mockReset();
        validateTargetUrl.mockReset();
        pinnedPost.mockReset();
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        process.env = originalEnv;
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    const tenantConfig = (url: string) =>
        queryWithOrg.mockImplementation(async (sql: string) =>
            /FROM covospan_configs/.test(sql) ? { rows: [{ endpoint_url: url, api_key: 'k', hmac_secret: null, campaign_id: null }] } : { rows: [] });

    it('sends a tenant-set endpoint only to the address that was validated', async () => {
        tenantConfig('https://hooks.example.com/in');
        validateTargetUrl.mockResolvedValue({ isValid: true, resolvedIp: '203.0.113.9' });
        pinnedPost.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });

        const { CovospanPusher } = await import('../CovospanPusher');
        await CovospanPusher.push(lead);

        expect(pinnedPost).toHaveBeenCalledWith('https://hooks.example.com/in', expect.objectContaining({ address: '203.0.113.9' }));
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('never calls a tenant-set endpoint that resolves to a private address', async () => {
        tenantConfig('https://sneaky.example.com/in');
        validateTargetUrl.mockResolvedValue({ isValid: false, error: 'Blocked non-public address: 169.254.169.254' });

        const { CovospanPusher } = await import('../CovospanPusher');
        const result = await CovospanPusher.performTestPush(lead);

        expect(result).toEqual({ ok: false, error: expect.stringContaining('Endpoint refused') });
        expect(pinnedPost).not.toHaveBeenCalled();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('still uses fetch for the operator endpoint set in the environment', async () => {
        process.env.CONVOSPAN_WEBHOOK_URL = 'https://operator.example.com/in';
        process.env.CONVOSPAN_API_KEY = 'operator-key';
        queryWithOrg.mockResolvedValue({ rows: [] });
        (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });

        const { CovospanPusher } = await import('../CovospanPusher');
        await CovospanPusher.push(lead);

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(validateTargetUrl).not.toHaveBeenCalled();
        expect(pinnedPost).not.toHaveBeenCalled();
    });
});
