let processor: (job: any) => Promise<any>;
const redisKeys: string[] = [];

jest.mock('bullmq', () => ({
    Worker: jest.fn().mockImplementation((_name: string, fn: any) => {
        processor = fn;
        return { on: jest.fn() };
    }),
}));

const tier1Add = jest.fn().mockResolvedValue({});
const tier2Add = jest.fn().mockResolvedValue({});
const tier3Add = jest.fn().mockResolvedValue({});
jest.mock('../../lib/queue', () => ({
    connection: {},
    RAW_SIGNALS_QUEUE_NAME: 'raw_signals',
    tier1Queue: { add: (...a: any[]) => tier1Add(...a) },
    tier2Queue: { add: (...a: any[]) => tier2Add(...a) },
    tier3Queue: { add: (...a: any[]) => tier3Add(...a) },
}));

jest.mock('../../lib/redis', () => {
    const track = (k: string) => { redisKeys.push(k); };
    const pipe: any = {};
    for (const m of ['zremrangebyscore', 'zadd', 'expire', 'zrange', 'lpush', 'ltrim']) {
        pipe[m] = (k: string) => { track(k); return pipe; };
    }
    pipe.exec = async () => [[null, 0], [null, 1], [null, 1], [null, []]];
    const client: any = {
        on: jest.fn(),
        get: async (k: string) => { track(k); return null; },
        setex: async (k: string) => { track(k); },
        lpush: async (k: string) => { track(k); },
        ltrim: async (k: string) => { track(k); },
        pipeline: () => pipe,
    };
    return { getSharedRedisClient: () => client };
});

const resolveEntity = jest.fn();
jest.mock('../entity-resolver', () => ({ resolveEntity: (...a: any[]) => resolveEntity(...a) }));

const syncSignal = jest.fn().mockResolvedValue(undefined);
jest.mock('../knowledge-graph', () => ({ KnowledgeGraphService: { syncSignal: (...a: any[]) => syncSignal(...a) } }));

const dbQuery = jest.fn();
jest.mock('../../lib/database', () => ({ db: { query: (...a: any[]) => dbQuery(...a) } }));

import { setupRouterWorker } from '../router';

const TENANT = '11111111-1111-1111-1111-111111111111';

function signal(extra: Record<string, unknown> = {}) {
    return {
        signal_id: 's-1', source_id: 'gem', source_tier: 'TIER_2',
        collected_at: new Date().toISOString(),
        company_name_raw: 'Acme Steel', company_name_clean: 'Acme Steel', cin: null,
        geo_state: 'MH', sector_inferred: 'Steel', signal_strength_I0: 0.8, lambda: 0.1,
        raw_payload: {}, pii_safe: true, geo_market: 'IN', ...extra,
    };
}

describe('router attributes signals to the tenant, not the company', () => {
    beforeAll(() => { setupRouterWorker(); });
    beforeEach(() => {
        redisKeys.length = 0;
        [tier1Add, tier2Add, tier3Add, syncSignal, dbQuery, resolveEntity].forEach((m) => m.mockClear());
        resolveEntity.mockResolvedValue('ENTITY-1');
        dbQuery.mockResolvedValue({ rows: [] });
    });

    it('uses the tenant for source settings, graph sync, Redis keys and the routed job', async () => {
        const out = await processor({ id: 's-1', data: signal({ tenant_id: TENANT }) });

        expect(dbQuery).toHaveBeenCalledWith(expect.stringContaining('source_configs'), [TENANT]);
        expect(syncSignal).toHaveBeenCalledWith(expect.objectContaining({ signal_id: 's-1' }), TENANT);
        const job = tier2Add.mock.calls[0][1];
        expect(job.org_id).toBe(TENANT);
        expect(job.entity_id).toBe('ENTITY-1');
        expect(out.org_id).toBe(TENANT);
        expect(redisKeys.some((k) => k.includes('ENTITY-1'))).toBe(false);
        expect(redisKeys).toContain(`org:${TENANT}:recent_signals`);
    });

    it('keeps the company id as owner for a signal that has no tenant, and skips the graph', async () => {
        await processor({ id: 's-1', data: signal() });

        expect(tier2Add.mock.calls[0][1].org_id).toBe('ENTITY-1');
        expect(syncSignal).not.toHaveBeenCalled();
    });
});
