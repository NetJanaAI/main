export {};
// /api/integrations/craftmyfunnel/connection: a tenant admin stores their own workspace credentials.
const saveCmfConnection = jest.fn();
const deleteCmfConnection = jest.fn();
const getCmfConnectionSummary = jest.fn();
const validateTargetUrl = jest.fn();

jest.mock('../../core/cmfConnection', () => ({ saveCmfConnection, deleteCmfConnection, getCmfConnectionSummary }));
jest.mock('../../middleware/urlValidator', () => ({ validateTargetUrl }));
jest.mock('../../lib/database', () => ({ query: jest.fn(), queryWithOrg: jest.fn().mockResolvedValue({ rows: [] }) }));
jest.mock('../../core/CraftMyFunnelPusher', () => ({ sendSampleCraftMyFunnelSignal: jest.fn() }));

const ORG = '11111111-1111-1111-1111-111111111111';
const body = { api_base_url: 'https://cmf.example.com', api_key: 'k'.repeat(12), hmac_secret: 's'.repeat(12) };

function handler(method: string) {
    const router = require('../api-manager').default;
    const layer = router.stack.find((l: any) => l.route && l.route.path === '/craftmyfunnel/connection' && l.route.methods[method]);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}
const res = () => { const r: any = {}; r.status = jest.fn(() => r); r.json = jest.fn(() => r); return r; };

beforeEach(() => {
    saveCmfConnection.mockReset().mockResolvedValue(undefined);
    deleteCmfConnection.mockReset().mockResolvedValue(undefined);
    getCmfConnectionSummary.mockReset().mockResolvedValue({ configured: true, source: 'tenant', api_base_url: 'https://cmf.example.com', key_hint: '***kkkk' });
    validateTargetUrl.mockReset().mockResolvedValue({ isValid: true });
});

describe('PUT /craftmyfunnel/connection', () => {
    it('saves the credentials for the authenticated tenant and answers without secrets', async () => {
        const r = res();
        await handler('put')({ organizationId: ORG, auth: { org_role: 'org:admin' }, body }, r);
        expect(saveCmfConnection).toHaveBeenCalledWith(ORG, { apiBaseUrl: body.api_base_url, apiKey: body.api_key, hmacSecret: body.hmac_secret });
        const out = JSON.stringify(r.json.mock.calls[0][0]);
        expect(out).not.toContain(body.api_key);
        expect(out).not.toContain(body.hmac_secret);
    });

    it('refuses a base URL that points at a private or non-https address', async () => {
        validateTargetUrl.mockResolvedValue({ isValid: false, error: 'Blocked non-public address: 169.254.169.254' });
        const r = res();
        await handler('put')({ organizationId: ORG, auth: { org_role: 'org:admin' }, body: { ...body, api_base_url: 'https://169.254.169.254' } }, r);
        expect(r.status).toHaveBeenCalledWith(400);
        expect(saveCmfConnection).not.toHaveBeenCalled();
    });

    it('rejects a body with missing fields', async () => {
        const r = res();
        await handler('put')({ organizationId: ORG, auth: { org_role: 'org:admin' }, body: { api_base_url: body.api_base_url } }, r);
        expect(r.status).toHaveBeenCalledWith(400);
        expect(saveCmfConnection).not.toHaveBeenCalled();
    });

    it('is for org admins only', async () => {
        const r = res();
        await handler('put')({ organizationId: ORG, auth: { org_role: 'org:member' }, body }, r);
        expect(r.status).toHaveBeenCalledWith(403);
        expect(saveCmfConnection).not.toHaveBeenCalled();
    });

    it('refuses a caller with no tenant', async () => {
        const r = res();
        await handler('put')({ body }, r);
        expect(r.status).toHaveBeenCalledWith(401);
    });
});

describe('GET and DELETE /craftmyfunnel/connection', () => {
    it('returns the summary for the caller tenant only', async () => {
        const r = res();
        await handler('get')({ organizationId: ORG }, r);
        expect(getCmfConnectionSummary).toHaveBeenCalledWith(ORG);
        expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ configured: true }));
    });

    it('removes the connection for the caller tenant, admins only', async () => {
        const denied = res();
        await handler('delete')({ organizationId: ORG, auth: { org_role: 'org:member' } }, denied);
        expect(denied.status).toHaveBeenCalledWith(403);
        expect(deleteCmfConnection).not.toHaveBeenCalled();

        await handler('delete')({ organizationId: ORG, auth: { org_role: 'org:admin' } }, res());
        expect(deleteCmfConnection).toHaveBeenCalledWith(ORG);
    });
});
