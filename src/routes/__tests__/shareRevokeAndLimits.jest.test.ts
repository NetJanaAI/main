export {};
const A = '11111111-1111-1111-1111-111111111111';
const B = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

const store = new Map<string, string>();
const redis = {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => { store.set(k, v); return 'OK'; }),
    del: jest.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
};
const query = jest.fn();

jest.mock('../../lib/redis', () => ({ getSharedRedisClient: () => redis }));
jest.mock('../../lib/database', () => ({ query: (...a: any[]) => query(...a) }));
jest.mock('../../lib/secrets', () => ({ getHmacSecret: () => 'secret' }));
jest.mock('../../lib/ai/SovereignFirewall', () => ({
    SovereignFirewall: jest.fn().mockImplementation(() => ({ maskData: async (s: string) => s })),
}));

const res = () => { const r: any = {}; r.status = jest.fn(() => r); r.json = jest.fn(() => r); return r; };
function handler(method: string, p: string) {
    const router = require('../share').default;
    const layer = router.stack.find((l: any) => l.route && l.route.path === p && l.route.methods[method]);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

beforeEach(() => { store.clear(); query.mockReset().mockResolvedValue({ rows: [{ job_id: 'l1', domain: 'acme.com' }] }); });

describe('share links', () => {
    it('can be revoked by the organization that made them, after which they stop resolving', async () => {
        const { ShareService } = require('../../standalone/services/ShareService');
        const url: string = await ShareService.generateShareUrl('l1', A);
        const token = url.replace('/share/', '');
        expect(await ShareService.getSharedContent(token)).not.toBeNull();

        const r = res();
        await handler('delete', '/:token')({ organizationId: A, params: { token } }, r);
        expect(r.json).toHaveBeenCalledWith({ revoked: true });
        expect(await ShareService.getSharedContent(token)).toBeNull();
    });

    it('cannot be revoked by another organization, or without one', async () => {
        const { ShareService } = require('../../standalone/services/ShareService');
        const token = (await ShareService.generateShareUrl('l1', A)).replace('/share/', '');

        const other = res();
        await handler('delete', '/:token')({ organizationId: B, params: { token } }, other);
        expect(other.status).toHaveBeenCalledWith(404);

        const anon = res();
        await handler('delete', '/:token')({ params: { token } }, anon);
        expect(anon.status).toHaveBeenCalledWith(401);
        expect(await ShareService.getSharedContent(token)).not.toBeNull();
    });

    it('expose a fixed list of columns, not the whole row', async () => {
        const { ShareService } = require('../../standalone/services/ShareService');
        const token = (await ShareService.generateShareUrl('l1', A)).replace('/share/', '');
        await ShareService.getSharedContent(token);
        const sql = query.mock.calls[0][0] as string;
        expect(sql).not.toMatch(/SELECT \*/);
        expect(sql).not.toMatch(/screenshot_path|spider_stats|organization_id,/);
    });
});

describe('/v1/intel limits', () => {
    it('are applied per IP, so inventing api key values does not give a new bucket', async () => {
        const { intelIpRateLimiter } = require('../../middleware/rateLimit');
        const next = jest.fn();
        let blocked = 0;
        for (let i = 0; i < 125; i++) {
            const r: any = { status: jest.fn(() => r), json: jest.fn(() => { blocked++; return r; }), setHeader: jest.fn(), set: jest.fn(), getHeader: jest.fn(), headersSent: false };
            await new Promise<void>((done) => {
                const n = () => { next(); done(); };
                r.json = jest.fn(() => { blocked++; done(); return r; });
                intelIpRateLimiter({ ip: '203.0.113.5', headers: { 'x-api-key': `invented-${i}` }, app: { get: () => undefined } } as any, r, n);
            });
        }
        expect(next).toHaveBeenCalledTimes(120);
        expect(blocked).toBe(5);
    });
});
