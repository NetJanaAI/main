export {};
const ORG = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

const queryWithOrg = jest.fn();
const validateTargetUrl = jest.fn();

jest.mock('../../lib/database', () => ({
    query: jest.fn().mockResolvedValue({ rows: [] }),
    db: { queryWithOrg: (...a: any[]) => queryWithOrg(...a) },
}));
jest.mock('../../middleware/tenant', () => ({ requireTenant: (_q: any, _s: any, n: any) => n() }));
jest.mock('../../middleware/urlValidator', () => ({ validateTargetUrl: (...a: any[]) => validateTargetUrl(...a) }));
jest.mock('../../core/CovospanPusher', () => ({ CovospanPusher: { performTestPush: jest.fn() } }));
jest.mock('../../lib/credentialVault', () => ({ encryptCredential: (v: string) => v }));

const member = { organizationId: ORG, auth: { org_role: 'org:member' } };
const admin = { organizationId: ORG, auth: { org_role: 'org:admin' } };
const res = () => { const r: any = {}; r.status = jest.fn(() => r); r.json = jest.fn(() => r); return r; };

function handler(file: string, method: string, p: string) {
    const router = require(`../${file}`).default;
    const layer = router.stack.find((l: any) => l.route && l.route.path === p && l.route.methods[method]);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

beforeEach(() => {
    queryWithOrg.mockReset().mockResolvedValue({ rows: [] });
    validateTargetUrl.mockReset().mockResolvedValue({ isValid: true, resolvedIp: '203.0.113.9' });
});

describe('ConvoSpan settings are for org admins', () => {
    it.each([['post', '/config'], ['delete', '/config'], ['post', '/test']])('%s %s refuses a member', async (m, p) => {
        const r = res();
        await handler('covospan', m, p)({ ...member, body: { endpoint_url: 'https://x.example.com', api_key: 'k' } }, r);
        expect(r.status).toHaveBeenCalledWith(403);
        expect(queryWithOrg).not.toHaveBeenCalled();
    });

    it('lets an admin save a public https endpoint', async () => {
        const r = res();
        await handler('covospan', 'post', '/config')({ ...admin, body: { endpoint_url: 'https://hooks.example.com/in', api_key: 'k' } }, r);
        expect(queryWithOrg).toHaveBeenCalled();
        expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('refuses to save an endpoint that is not a public https address', async () => {
        validateTargetUrl.mockResolvedValue({ isValid: false, error: 'Only HTTPS scheme is allowed.' });
        const r = res();
        await handler('covospan', 'post', '/config')({ ...admin, body: { endpoint_url: 'http://169.254.169.254/latest', api_key: 'k' } }, r);
        expect(r.status).toHaveBeenCalledWith(400);
        expect(queryWithOrg).not.toHaveBeenCalled();
    });
});

describe('API key rotation is for org admins', () => {
    it('refuses a member', async () => {
        const r = res();
        await handler('profile', 'post', '/regenerate-key')({ ...member, body: {} }, r);
        expect(r.status).toHaveBeenCalledWith(403);
    });
});
