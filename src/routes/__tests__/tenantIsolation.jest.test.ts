// Tenant A must never read or change tenant B's rows through these routes.
const query = jest.fn();
const queryWithOrg = jest.fn();
const queueAdd = jest.fn();

jest.mock('../../lib/database', () => ({ query, queryWithOrg, queryAsSystem: jest.fn(), db: { query } }));
jest.mock('../../lib/scheduler', () => ({ addSchedule: jest.fn(), removeSchedule: jest.fn(), listSchedules: jest.fn() }));
jest.mock('../../standalone/services/RazorpayService', () => ({ RazorpayService: { billExtraUsage: jest.fn() } }));
jest.mock('../../lib/queue', () => ({
    rawSignalsQueue: { add: queueAdd },
    scrapeQueue: { add: queueAdd },
    outreachQueue: { add: queueAdd },
    influenceQueue: { add: queueAdd },
}));
jest.mock('../../lib/redis', () => ({ getSharedRedisClient: () => ({ incr: jest.fn(), get: jest.fn() }) }));
jest.mock('../../lib/cache', () => ({ cache: { set: jest.fn().mockResolvedValue('OK') } }));
jest.mock('../../middleware/rateLimit', () => ({ pullApiRateLimiter: (_q: any, _s: any, n: any) => n() }));
jest.mock('../../middleware/ingestAuth', () => ({ ingestAuthGuard: (_q: any, _s: any, n: any) => n() }));
jest.mock('../../core/adapters', () => ({
    adaptGeM: jest.fn().mockResolvedValue({ signal_id: 'sig-1' }),
    adaptIndiaMART: jest.fn(), adaptFunding: jest.fn(), adaptNaukri: jest.fn(),
    adaptZauba: jest.fn(), adaptMca: jest.fn(), adaptParivesh: jest.fn(), adaptRera: jest.fn(),
}));
jest.mock('../../lib/schemas', () => new Proxy({}, { get: () => ({ parse: (b: any) => b }) }));

const ORG_A = '11111111-1111-1111-1111-111111111111';
const LEAD = '22222222-2222-2222-2222-222222222222';

function handler(router: any, method: string, path: string) {
    const layer = router.stack.find((l: any) => l.route && l.route.path === path && l.route.methods[method]);
    const stack = layer.route.stack;
    return stack[stack.length - 1].handle;
}
function mockRes() {
    const res: any = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
}
function sqlCalls(fn: jest.Mock) {
    return fn.mock.calls.map((c) => ({ sql: String(c[0]), params: c[1] as any[] }));
}

beforeEach(() => {
    query.mockReset().mockResolvedValue({ rows: [] });
    queryWithOrg.mockReset().mockResolvedValue({ rows: [] });
    queueAdd.mockReset();
});

describe('DLQ', () => {
    const router = require('../dlq').default;

    it('lists only the caller tenant rows', async () => {
        query.mockResolvedValue({ rows: [{ count: '0' }] });
        await handler(router, 'get', '/')({ organizationId: ORG_A, query: {} }, mockRes());
        for (const c of sqlCalls(query)) {
            expect(c.sql).toMatch(/organization_id = \$\d/);
            expect(c.params).toContain(ORG_A);
        }
    });

    it('refuses a caller with no tenant', async () => {
        const res = mockRes();
        await handler(router, 'get', '/')({ query: {} }, res);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(query).not.toHaveBeenCalled();
    });

    it('does not retry or delete another tenant item', async () => {
        const res = mockRes();
        await handler(router, 'post', '/:id/retry')({ organizationId: ORG_A, params: { id: 'dlq-of-B' } }, res);
        const calls = sqlCalls(query);
        expect(calls).toHaveLength(1);
        expect(calls[0].sql).toMatch(/id = \$1 AND organization_id = \$2/);
        expect(calls[0].params).toEqual(['dlq-of-B', ORG_A]);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(queueAdd).not.toHaveBeenCalled();
    });
});

describe('Leads', () => {
    const router = require('../leads').default;

    it('feedback cannot touch another tenant lead', async () => {
        const res = mockRes();
        await handler(router, 'patch', '/:id/feedback')(
            { organizationId: ORG_A, params: { id: LEAD }, body: { status: 'wrong' } }, res);
        const calls = sqlCalls(query);
        expect(calls).toHaveLength(1);
        expect(calls[0].sql).toMatch(/lead_id = \$1 AND org_id = \$2/);
        expect(calls[0].params).toEqual([LEAD, ORG_A]);
        expect(res.status).toHaveBeenCalledWith(404);
    });

    it('feedback update is scoped to the tenant', async () => {
        query.mockResolvedValue({ rows: [{ source_id: 'gem' }] });
        await handler(router, 'patch', '/:id/feedback')(
            { organizationId: ORG_A, params: { id: LEAD }, body: { status: 'wrong' } }, mockRes());
        const update = sqlCalls(query).find((c) => c.sql.includes('UPDATE lead_cards'))!;
        expect(update.sql).toMatch(/org_id = \$4/);
        expect(update.params[3]).toBe(ORG_A);
    });

    it('enrich-influence cannot probe or queue another tenant lead', async () => {
        const res = mockRes();
        await handler(router, 'post', '/:id/enrich-influence')({ organizationId: ORG_A, params: { id: LEAD } }, res);
        const calls = sqlCalls(query);
        expect(calls[0].sql).toMatch(/job_id = \$1 AND organization_id = \$2/);
        expect(calls[0].params).toEqual([LEAD, ORG_A]);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(queueAdd).not.toHaveBeenCalled();
    });
});

describe('Intel pull', () => {
    const router = require('../netjana-intel').default;
    const pull = handler(router, 'get', '/leads/:lead_id');

    it('rejects a key that matches no tenant', async () => {
        const res = mockRes();
        await pull({ params: { lead_id: LEAD }, headers: { 'x-api-key': 'nope' } }, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(queryWithOrg).not.toHaveBeenCalled();
    });

    it('rejects a missing key', async () => {
        const res = mockRes();
        await pull({ params: { lead_id: LEAD }, headers: {} }, res);
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('only looks up the lead inside the key owner tenant', async () => {
        query.mockResolvedValue({ rows: [{ id: ORG_A }] });
        const res = mockRes();
        await pull({ params: { lead_id: LEAD }, headers: { 'x-api-key': 'sk_live_a' } }, res);
        const calls = sqlCalls(queryWithOrg);
        expect(calls[0].sql).toMatch(/lead_id = \$1 AND org_id = \$2/);
        expect(calls[0].params).toEqual([LEAD, ORG_A]);
        expect(queryWithOrg.mock.calls[0][2]).toBe(ORG_A);
        expect(res.status).toHaveBeenCalledWith(404);
    });
});

describe('Ingest ticker', () => {
    const router = require('../ingest').default;

    it('emits only to the ingesting tenant room', async () => {
        const emit = jest.fn();
        const to = jest.fn(() => ({ emit }));
        const io = { to, emit: jest.fn() };
        await handler(router, 'post', '/gem')({ organizationId: ORG_A, body: {}, io }, mockRes());
        expect(to).toHaveBeenCalledWith(`org:${ORG_A}`);
        expect(emit).toHaveBeenCalledWith('ingest_signal', expect.any(Object));
        expect(io.emit).not.toHaveBeenCalled();
    });
});

describe('Shared null-tenant rows', () => {
    it('vault export reads only the caller tenant rows', async () => {
        const router = require('../vault').default;
        const res = mockRes();
        await handler(router, 'get', '/export')({ organizationId: ORG_A }, res);
        const call = sqlCalls(queryWithOrg)[0];
        expect(call.sql).not.toMatch(/IS NULL/);
        expect(call.params).toEqual([ORG_A]);
    });

    it('schedules list and delete never match null-tenant rows', async () => {
        const router = require('../schedules').default;
        await handler(router, 'get', '/')({ organizationId: ORG_A }, mockRes());
        const res = mockRes();
        await handler(router, 'delete', '/:id')({ organizationId: ORG_A, params: { id: 'sched-of-nobody' } }, res);
        for (const c of sqlCalls(query)) {
            expect(c.sql).not.toMatch(/IS NULL/);
            expect(c.params).toContain(ORG_A);
        }
        expect(res.status).toHaveBeenCalledWith(404);
    });
});

describe('Seats', () => {
    const router = require('../enterprise').default;
    const add = handler(router, 'post', '/seats/add');
    const body = { userEmail: 'new@a.example', userName: 'New' };

    it('adds the seat to the caller tenant', async () => {
        query.mockResolvedValue({ rows: [{ count: '1' }] });
        await add({ organizationId: ORG_A, body }, mockRes());
        const insert = sqlCalls(query).find((c) => c.sql.includes('INSERT INTO organization_seats'))!;
        expect(insert.params[1]).toBe(ORG_A);
    });

    it('refuses a seat aimed at another tenant', async () => {
        const res = mockRes();
        await add({ organizationId: ORG_A, body: { ...body, organizationId: 'org-b' } }, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(query).not.toHaveBeenCalled();
    });

    it('refuses a non-admin member of a Clerk organization', async () => {
        const res = mockRes();
        await add({ organizationId: ORG_A, auth: { org_role: 'org:member' }, body }, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(query).not.toHaveBeenCalled();
    });

    it('refuses a caller with no tenant', async () => {
        const res = mockRes();
        await add({ body }, res);
        expect(res.status).toHaveBeenCalledWith(401);
    });
});
