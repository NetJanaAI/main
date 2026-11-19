const queryWithOrg = jest.fn();
const dbQuery = jest.fn();
const getDedupStats = jest.fn();

jest.mock('../../lib/database', () => ({
    db: { query: (...a: any[]) => dbQuery(...a) },
    queryWithOrg: (...a: any[]) => queryWithOrg(...a),
}));
jest.mock('../../lib/ai/token-tracker', () => ({ TokenTracker: { getStats: jest.fn().mockResolvedValue([]) } }));
jest.mock('../../core/collectors/indiamart-dedup', () => ({ getDedupStats: (...a: any[]) => getDedupStats(...a) }));
jest.mock('../../middleware/tenant', () => ({ requireTenant: (_q: any, _s: any, n: any) => n() }));

import router from '../telemetry';

function handler(path: string) {
    const layer = (router as any).stack.find((l: any) => l.route?.path === path);
    const stack = layer.route.stack;
    return stack[stack.length - 1].handle;
}

const res = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() }) as any;

describe('telemetry tenant scope', () => {
    beforeEach(() => {
        queryWithOrg.mockReset().mockResolvedValue({ rows: [{ count: '3' }] });
        dbQuery.mockReset().mockResolvedValue({ rows: [] });
        getDedupStats.mockReset().mockResolvedValue([]);
    });

    it('counts only the caller organization audit events', async () => {
        const r = res();
        await handler('/health')({ organizationId: 'org_a' }, r);
        for (const call of queryWithOrg.mock.calls) {
            expect(call[0]).toContain('organization_id = $1');
            expect(call[1]).toEqual(['org_a']);
            expect(call[2]).toBe('org_a');
        }
        expect(queryWithOrg).toHaveBeenCalledTimes(2);
        expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ blocked_ips_24h: 3, audit_events_1h: 3 }));
    });

    it('reads token usage through the organization context', async () => {
        await handler('/tokens')({ organizationId: 'org_a', query: {} }, res());
        expect(queryWithOrg).toHaveBeenCalledTimes(2);
        for (const call of queryWithOrg.mock.calls) expect(call[2]).toBe('org_a');
    });

    it('asks for ingestion stats of the caller organization only', async () => {
        await handler('/sources')({ organizationId: 'org_a' }, res());
        expect(getDedupStats).toHaveBeenCalledWith('org_a', 7);
    });
});
