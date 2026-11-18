export {};
const A = '11111111-1111-1111-1111-111111111111';
const B = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

const queryWithOrg = jest.fn();
const cacheSet = jest.fn();

jest.mock('../../lib/database', () => ({ query: jest.fn().mockResolvedValue({ rows: [] }), queryWithOrg: (...a: any[]) => queryWithOrg(...a) }));
jest.mock('../../lib/queue', () => ({ connection: {}, rawSignalsQueue: { add: jest.fn() } }));
jest.mock('../../lib/quota', () => ({ enqueueScrape: jest.fn() }));
jest.mock('bullmq', () => ({ Queue: jest.fn().mockImplementation(() => ({ add: jest.fn() })) }));
jest.mock('../../lib/pdfReport', () => ({ generateReport: jest.fn() }));
jest.mock('../../lib/dataCapsule', () => ({ generateCapsule: jest.fn(), signCapsule: jest.fn() }));
jest.mock('../../middleware/ingestAuth', () => ({ ingestAuthGuard: (_q: any, _s: any, n: any) => n() }));
jest.mock('../../lib/cache', () => ({ cache: { set: (...a: any[]) => cacheSet(...a) } }));
jest.mock('../../lib/schemas', () => new Proxy({}, { get: () => ({ parse: (v: any) => v }) }));
jest.mock('../../core/adapters', () => new Proxy({}, { get: () => async () => null }));

const member = { organizationId: A, auth: { org_role: 'org:member' } };
const res = () => { const r: any = {}; r.status = jest.fn(() => r); r.json = jest.fn(() => r); return r; };

function handler(file: string, method: string, p: string) {
    const router = require(`../${file}`).default;
    const layer = router.stack.find((l: any) => l.route && l.route.path === p && l.route.methods[method]);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

beforeEach(() => {
    queryWithOrg.mockReset().mockResolvedValue({ rows: [] });
    cacheSet.mockReset().mockResolvedValue('OK');
});

describe('schedules of different tenants for one domain', () => {
    it('are tracked separately, and removing one leaves the other running', () => {
        const { addSchedule, removeSchedule, listSchedules } = require('../../lib/scheduler');
        const entry = (id: string, org: string) => ({ id, domain: 'example.com', cron_expression: '0 0 1 1 *', use_online_ai: false, spider_mode: false, max_pages: 5, organization_id: org });

        addSchedule(entry('sched-a', A));
        addSchedule(entry('sched-b', B));
        expect(listSchedules().sort()).toEqual(['sched-a', 'sched-b']);

        removeSchedule('sched-b');
        expect(listSchedules()).toEqual(['sched-a']);
        removeSchedule('sched-a');
    });

    it('refuses a cron expression the scheduler could not run', async () => {
        const r = res();
        await handler('schedules', 'post', '/')({ organizationId: A, body: { domain: 'acme.com', cron_expression: 'every tuesday' } }, r);
        expect(r.status).toHaveBeenCalledWith(400);
    });
});

describe('ingest de-duplication', () => {
    it('is scoped to the tenant, so one tenant cannot suppress another tenant payload', async () => {
        const body = { bid: 'same' };
        await handler('ingest', 'post', '/gem')({ organizationId: A, body }, res());
        await handler('ingest', 'post', '/gem')({ organizationId: B, body }, res());
        const [keyA, keyB] = cacheSet.mock.calls.map((c) => c[0]);
        expect(keyA).toContain(A);
        expect(keyB).toContain(B);
        expect(keyA).not.toBe(keyB);
    });
});

describe('GET /api/results paging', () => {
    it('caps the page size and ignores a negative page', async () => {
        await handler('results', 'get', '/')({ organizationId: A, query: { limit: '100000000', page: '-4' } }, res());
        const [, params] = queryWithOrg.mock.calls[0];
        expect(params).toEqual([A, 200, 0]);
    });
});

describe('integration credentials are for org admins', () => {
    it.each([['post', '/integrations'], ['delete', '/integrations/:id']])('%s %s refuses a member', async (m, p) => {
        const r = res();
        await handler('api-manager', m, p)({ ...member, params: { id: 'x' }, body: { provider: 'p', name: 'n', value: 'v' } }, r);
        expect(r.status).toHaveBeenCalledWith(403);
        expect(queryWithOrg).not.toHaveBeenCalled();
    });
});
