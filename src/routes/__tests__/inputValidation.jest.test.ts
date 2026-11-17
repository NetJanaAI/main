// Write endpoints reject malformed bodies and params before they reach the database.
export {};
const query = jest.fn();
const queryWithOrg = jest.fn();

jest.mock('../../lib/database', () => ({ query, queryWithOrg, queryAsSystem: jest.fn(), db: { query, queryWithOrg } }));
jest.mock('../../lib/scheduler', () => ({ addSchedule: jest.fn(), removeSchedule: jest.fn(), listSchedules: jest.fn() }));
jest.mock('../../lib/queue', () => ({
    rawSignalsQueue: { add: jest.fn() },
    scrapeQueue: { add: jest.fn() },
}));
jest.mock('../../lib/redis', () => ({ getSharedRedisClient: () => ({ incr: jest.fn(), get: jest.fn() }) }));
jest.mock('../../lib/cache', () => ({ cache: { set: jest.fn(), del: jest.fn() } }));
jest.mock('../../middleware/adminAuth', () => ({ adminAuth: (_q: any, _s: any, n: any) => n() }));
jest.mock('../../middleware/tenant', () => ({ requireTenant: (_q: any, _s: any, n: any) => n() }));
jest.mock('../../core/CraftMyFunnelPusher', () => ({
    sendCraftMyFunnelLeadSignal: jest.fn(),
    sendSampleCraftMyFunnelSignal: jest.fn(),
}));
jest.mock('../../core/rag/VanishProtocol', () => ({ VanishProtocol: { purge: jest.fn() } }));
jest.mock('../../lib/DeadLetterQueue', () => ({ DeadLetterQueue: {} }));
jest.mock('../../core/compliance/AuditTrail', () => ({ AuditTrail: { log: jest.fn() } }));
jest.mock('../../standalone/services/ShareService', () => ({ ShareService: { generateShareUrl: jest.fn() } }));
jest.mock('../../standalone/services/CampaignROIAggregator', () => ({ CampaignROIAggregator: {} }));
jest.mock('../../standalone/services/ROIPDFGenerator', () => ({ ROIPDFGenerator: {} }));
jest.mock('../../standalone/services/RazorpayService', () => ({ RazorpayService: { verifyWebhook: () => true } }));
jest.mock('../../core/ingest/csv-ingestion-service', () => ({ CsvIngestionService: { ingestCsv: jest.fn() } }));
jest.mock('../../lib/secrets', () => ({ getHmacSecret: () => 'h', getApiKeySecret: () => 'k' }));

const ORG = '11111111-1111-1111-1111-111111111111';

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

beforeEach(() => {
    query.mockReset().mockResolvedValue({ rows: [] });
    queryWithOrg.mockReset().mockResolvedValue({ rows: [] });
});

async function rejects(router: any, method: string, path: string, req: any) {
    const res = mockRes();
    await handler(router, method, path)({ organizationId: ORG, ...req }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(query).not.toHaveBeenCalled();
    expect(queryWithOrg).not.toHaveBeenCalled();
}

describe('write endpoints reject malformed input', () => {
    it('admin: tenant create needs a name and a positive integer quota', async () => {
        const router = require('../admin').default;
        await rejects(router, 'post', '/tenants', { body: { name: '' } });
        await rejects(router, 'post', '/tenants', { body: { name: 'Acme', quota_limit: -5 } });
    });

    it('admin: key rotation needs a uuid tenant id', async () => {
        await rejects(require('../admin').default, 'post', '/tenants/:id/rotate-key', { params: { id: "1' OR '1'='1" } });
    });

    it('admin: IP allowlist needs a cidr and a uuid organisation', async () => {
        const router = require('../admin').default;
        await rejects(router, 'post', '/security/ips', { body: {} });
        await rejects(router, 'post', '/security/ips', { body: { cidr: '10.0.0.0/8', organization_id: 'nope' } });
    });

    it('admin: CraftMyFunnel test only accepts a known event', async () => {
        await rejects(require('../admin').default, 'post', '/integrations/craftmyfunnel/test', { body: { event: 'DROP_TABLE' } });
    });

    it('campaigns: advance only accepts a known state', async () => {
        await rejects(require('../campaigns').default, 'post', '/:domain/advance', { params: { domain: 'acme.com' }, body: { state: 'WON' } });
    });

    it('csv ingest: type must be company, employee or unified', async () => {
        await rejects(require('../csv-ingest').default, 'post', '/process', { body: { csvText: 'a,b', type: 'everything' } });
    });

    it('profile: key regeneration takes no body', async () => {
        await rejects(require('../profile').default, 'post', '/regenerate-key', { body: { org: 'other' } });
    });

    it('schedules: domain and cron are required and max_pages is bounded', async () => {
        const router = require('../schedules').default;
        await rejects(router, 'post', '/', { body: { domain: 'acme.com' } });
        await rejects(router, 'post', '/', { body: { domain: 'acme.com', cron_expression: '0 * * * *', max_pages: 100000 } });
    });

    it('share: lead id cannot be empty', async () => {
        await rejects(require('../share').default, 'post', '/:id', { params: { id: '' } });
    });

    it('sources: toggle needs a string source and a boolean', async () => {
        const router = require('../sources').default;
        await rejects(router, 'post', '/toggle', { body: { sourceId: 'gem' } });
        await rejects(router, 'post', '/toggle', { body: { sourceId: 'gem', enabled: 'yes' } });
    });

    it('watch profiles: keywords must be a list of strings', async () => {
        const router = require('../watch-profiles').default;
        await rejects(router, 'post', '/', { body: { keywords: 'steel' } });
        await rejects(router, 'post', '/', { body: { keywords: ['steel'], min_amount: -1 } });
    });
});
