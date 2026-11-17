export {};
// req.tenantTier was read by the rate limiter and the usage route but never set.
const CLERK_TOKEN = { sub: 'user_1', org_id: 'org_clerk' };

async function load(rows: any[]) {
    jest.resetModules();
    const query = jest.fn().mockResolvedValue({ rows });
    jest.doMock('@clerk/backend', () => ({
        createClerkClient: jest.fn(() => ({})),
        verifyToken: jest.fn().mockResolvedValue(CLERK_TOKEN),
    }));
    jest.doMock('../../lib/database', () => ({ query }));
    jest.doMock('../../lib/secrets', () => ({ getHmacSecret: () => 's', getApiKeySecret: () => 's' }));
    jest.doMock('../../core/compliance/AuditTrail', () => ({ AuditTrail: { log: jest.fn() } }));
    const { tenantContext } = await import('../tenant');
    return { tenantContext, query };
}
const res = () => { const r: any = {}; r.status = jest.fn(() => r); r.json = jest.fn(() => r); return r; };

describe('tenantContext tier', () => {
    it.each(['free', 'paid', 'enterprise'])('sets req.tenantTier from tenants.plan (%s) on the Clerk path', async (plan) => {
        const { tenantContext, query } = await load([{ id: 'tenant-1', plan }]);
        const req: any = { path: '/api/leads', headers: { authorization: 'Bearer t' } };
        const next = jest.fn();
        await tenantContext(req, res(), next);
        expect(req.organizationId).toBe('tenant-1');
        expect(req.tenantTier).toBe(plan);
        expect(String(query.mock.calls[0][0])).toMatch(/SELECT id, plan FROM tenants/);
        expect(next).toHaveBeenCalled();
    });

    it('sets req.tenantTier on the API key path', async () => {
        const { tenantContext } = await load([{ id: 'tenant-1', plan: 'enterprise' }]);
        const req: any = { path: '/api/leads', headers: { 'x-api-key': 'k' } };
        await tenantContext(req, res(), jest.fn());
        expect(req.tenantTier).toBe('enterprise');
    });

    it('defaults a missing plan to free', async () => {
        const { tenantContext } = await load([{ id: 'tenant-1', plan: null }]);
        const req: any = { path: '/api/leads', headers: { 'x-api-key': 'k' } };
        await tenantContext(req, res(), jest.fn());
        expect(req.tenantTier).toBe('free');
    });
});
