// Worker events must reach only the owning tenant's room, over both the local and Redis paths.
export {};

const handlers: Record<string, (...a: any[]) => void> = {};
let processor: (job: any) => Promise<any>;
const publish = jest.fn().mockResolvedValue(1);

jest.mock('bullmq', () => ({
    Worker: jest.fn((_name: string, proc: any) => {
        processor = proc;
        return { on: (evt: string, cb: any) => { handlers[evt] = cb; } };
    }),
}));
jest.mock('../../lib/queue', () => ({ connection: {}, SCRAPE_QUEUE_NAME: 'scrape', ENTITY_ENRICHMENT_QUEUE_NAME: 'entity' }));
jest.mock('../../lib/redis', () => ({
    getSharedRedisClient: () => ({ on: jest.fn(), publish, get: jest.fn().mockResolvedValue(null), setex: jest.fn() }),
}));
jest.mock('../../lib/database', () => ({
    db: { query: jest.fn().mockResolvedValue({ rows: [{ source_id: 'webscrape', is_enabled: true }] }) },
    query: jest.fn().mockResolvedValue({ rows: [] }),
}));
jest.mock('../../lib/cache', () => ({ cache: {} }));
jest.mock('../../engines/b2bScraper', () => ({
    scrapeB2BSignals: jest.fn(async (_u: string, _n: number, onLog: (m: string, t: string) => void) => {
        onLog('working', 'info');
        return { domain: 'a.example' };
    }),
}));
jest.mock('../../core/entity-resolution/insta-client', () => ({
    getInstaClient: () => ({
        runEnrichmentLifecycle: jest.fn().mockResolvedValue({
            entityId: 'e1', canonicalName: 'Acme', cin: 'CIN1', companyStatus: 'ACTIVE',
        }),
    }),
}));
jest.mock('../../core/entity-resolution/mermaid-organogram', () => ({
    buildMermaidOrganogram: () => ({ diagram: 'graph', nodeCount: 1, isTruncated: false }),
}));
jest.mock('../../core/rag/EntityIndexer', () => ({ EntityIndexer: { enqueueEntityIndex: jest.fn().mockResolvedValue(undefined) } }));

const ORG_A = '11111111-1111-1111-1111-111111111111';

function fakeIo() {
    const roomEmit = jest.fn();
    const to = jest.fn(() => ({ emit: roomEmit }));
    return { io: { to, emit: jest.fn() } as any, to, roomEmit };
}

beforeEach(() => {
    publish.mockClear();
    for (const k of Object.keys(handlers)) delete handlers[k];
});

describe('scrape worker', () => {
    const { setupScrapeWorker } = require('../scrapeWorker');
    const job = (extra: any = {}) => ({ data: { url: 'https://a.example', jobId: 'job-1', organizationId: ORG_A, ...extra } });

    it("emits log and complete only to the job's tenant room", async () => {
        const { io, to, roomEmit } = fakeIo();
        setupScrapeWorker(io);
        await processor(job());
        expect(io.emit).not.toHaveBeenCalled();
        expect(to).toHaveBeenCalledWith(`org:${ORG_A}`);
        expect(roomEmit.mock.calls.map((c) => c[0])).toEqual(['log', 'complete']);
    });

    it('publishes worker events with the organizationId for the Redis relay', async () => {
        setupScrapeWorker(null);
        await processor(job());
        const messages = publish.mock.calls.filter((c) => c[0] === 'worker_events').map((c) => JSON.parse(c[1]));
        expect(messages.length).toBeGreaterThan(0);
        for (const m of messages) expect(m.organizationId).toBe(ORG_A);
    });

    it('emits the failure event to the tenant room only', () => {
        const { io, to, roomEmit } = fakeIo();
        setupScrapeWorker(io);
        handlers.failed({ data: { jobId: 'job-1', organizationId: ORG_A } }, new Error('boom'));
        expect(io.emit).not.toHaveBeenCalled();
        expect(to).toHaveBeenCalledWith(`org:${ORG_A}`);
        expect(roomEmit).toHaveBeenCalledWith('error', { jobId: 'job-1', error: 'boom' });
    });

    it('drops events for a job that has no organizationId', async () => {
        const { io, to } = fakeIo();
        setupScrapeWorker(io);
        await processor(job({ organizationId: undefined }));
        handlers.failed({ data: { jobId: 'job-2' } }, new Error('boom'));
        expect(io.emit).not.toHaveBeenCalled();
        expect(to).not.toHaveBeenCalled();
        const relayed = publish.mock.calls.filter((c) => c[0] === 'worker_events');
        expect(relayed).toEqual([]);
    });
});

describe('entity enrichment worker', () => {
    const { setupEntityEnrichmentWorker } = require('../entityEnrichmentWorker');
    const base = { cin: 'CIN1', entityId: 'e1', canonicalName: 'Acme' };

    beforeAll(() => { process.env.NODE_ENV = 'development'; });
    afterAll(() => { process.env.NODE_ENV = 'test'; });

    it('emits enrichment events to the requesting tenant room only', async () => {
        const { io, to, roomEmit } = fakeIo();
        setupEntityEnrichmentWorker(io);
        await processor({ id: 'j', data: { ...base, organizationId: ORG_A } });
        expect(io.emit).not.toHaveBeenCalled();
        expect(to).toHaveBeenCalledWith(`org:${ORG_A}`);
        expect(roomEmit).toHaveBeenCalledWith('entity:enriched', expect.objectContaining({ entityId: 'e1' }));
    });

    it('drops the event when the job carries no tenant', async () => {
        const { io, to } = fakeIo();
        setupEntityEnrichmentWorker(io);
        await processor({ id: 'j', data: base });
        expect(io.emit).not.toHaveBeenCalled();
        expect(to).not.toHaveBeenCalled();
    });
});
