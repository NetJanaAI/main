export {};
const ORG = '11111111-1111-1111-1111-111111111111';
const LEAD = '22222222-2222-2222-2222-222222222222';

const query = jest.fn();
const queryWithOrg = jest.fn();
const redis = {
    incr: jest.fn(), hincrby: jest.fn(), hset: jest.fn(), get: jest.fn(),
    hgetall: jest.fn().mockResolvedValue({ contacted: '1000', converted: '900', total: '1900' }),
};

jest.mock('../../lib/database', () => ({ query: (...a: any[]) => query(...a), queryWithOrg: (...a: any[]) => queryWithOrg(...a), db: { query } }));
jest.mock('../../lib/redis', () => ({ getSharedRedisClient: () => redis }));
jest.mock('../../lib/queue', () => ({ influenceQueue: { add: jest.fn() } }));

const res = () => { const r: any = {}; r.status = jest.fn(() => r); r.json = jest.fn(() => r); return r; };
function handler(method: string, p: string) {
    const router = require('../leads').default;
    const layer = router.stack.find((l: any) => l.route && l.route.path === p && l.route.methods[method]);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

beforeEach(() => {
    query.mockReset();
    queryWithOrg.mockReset().mockResolvedValue({ rows: [] });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('lead feedback', () => {
    it('reports this tenant its own conversion rate, not the shared one across tenants', async () => {
        query.mockImplementation(async (sql: string) => {
            if (/SELECT source_id/.test(sql)) return { rows: [{ source_id: 'gem' }] };
            if (/FILTER/.test(sql)) return { rows: [{ contacted: '3', converted: '1' }] };
            return { rows: [] };
        });
        const r = res();
        await handler('patch', '/:id/feedback')({ organizationId: ORG, params: { id: LEAD }, body: { status: 'converted' } }, r);

        const own = query.mock.calls.find((c) => /FILTER/.test(c[0]))!;
        expect(own[1]).toEqual([ORG, 'gem']);
        expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ conversion_rate: 0.25 }));
    });
});

describe('lead intelligence', () => {
    it('joins scrape results and influence data only within the lead tenant', async () => {
        await handler('get', '/:id/intelligence')({ organizationId: ORG, params: { id: LEAD } }, res());
        const sql = queryWithOrg.mock.calls[0][0] as string;
        expect(sql).toMatch(/scrape_results s ON l\.lead_id = s\.job_id AND s\.organization_id = l\.org_id/);
        expect(sql).toMatch(/lead_influence_data i ON l\.lead_id = i\.lead_id AND i\.organization_id = l\.org_id/);
    });
});
