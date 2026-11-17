export {};
// tenants.quota_limit is the monthly scrape allowance in every mode. It is reserved atomically at
// enqueue, so concurrent requests cannot overshoot it, and given back if the job is never queued.
import fs from 'fs';
import path from 'path';

const query = jest.fn();
const incr = jest.fn();
const decr = jest.fn();
const expire = jest.fn();
const queueAdd = jest.fn();

jest.mock('../database', () => ({ query }));
jest.mock('../redis', () => ({ getSharedRedisClient: () => ({ incr, decr, expire }) }));
jest.mock('../queue', () => ({ scrapeQueue: { add: queueAdd } }));

import { enqueueScrape, QuotaExceededError } from '../quota';

const ORG = '11111111-1111-1111-1111-111111111111';
const job = { jobId: 'j1', url: 'https://a.example', organizationId: ORG };

beforeEach(() => {
    query.mockReset().mockResolvedValue({ rows: [{ quota_limit: 100 }] });
    incr.mockReset().mockResolvedValue(1);
    decr.mockReset().mockResolvedValue(0);
    expire.mockReset().mockResolvedValue(1);
    queueAdd.mockReset().mockResolvedValue({});
});

describe('enqueueScrape', () => {
    it('reads the limit from tenants.quota_limit for the tenant', async () => {
        await enqueueScrape(ORG, job);
        expect(String(query.mock.calls[0][0])).toMatch(/SELECT quota_limit FROM tenants WHERE id = \$1/);
        expect(query.mock.calls[0][1]).toEqual([ORG]);
    });

    it('queues the job and counts it in a per-tenant monthly key', async () => {
        await enqueueScrape(ORG, job, { jobId: 'j1' });
        expect(incr.mock.calls[0][0]).toMatch(new RegExp(`^quota:${ORG}:scrapes:\\d{4}-\\d{2}$`));
        expect(queueAdd).toHaveBeenCalledWith('scrape', job, { jobId: 'j1' });
    });

    it('sets the counter to expire when it is first created', async () => {
        await enqueueScrape(ORG, job);
        expect(expire).toHaveBeenCalledTimes(1);
        incr.mockResolvedValue(2);
        expire.mockClear();
        await enqueueScrape(ORG, job);
        expect(expire).not.toHaveBeenCalled();
    });

    it('allows exactly quota_limit scrapes and rejects the next without queueing', async () => {
        query.mockResolvedValue({ rows: [{ quota_limit: 3 }] });
        incr.mockResolvedValue(3);
        await expect(enqueueScrape(ORG, job)).resolves.toBeUndefined();
        incr.mockResolvedValue(4);
        queueAdd.mockClear();
        await expect(enqueueScrape(ORG, job)).rejects.toBeInstanceOf(QuotaExceededError);
        expect(queueAdd).not.toHaveBeenCalled();
        expect(decr).toHaveBeenCalledTimes(1);
    });

    it('is not capped at the old hardcoded 5 when the tenant allows more', async () => {
        incr.mockResolvedValue(6);
        await expect(enqueueScrape(ORG, job)).resolves.toBeUndefined();
    });

    it('reports the limit and usage on the error', async () => {
        query.mockResolvedValue({ rows: [{ quota_limit: 2 }] });
        incr.mockResolvedValue(3);
        await expect(enqueueScrape(ORG, job)).rejects.toMatchObject({ limit: 2, used: 2 });
    });

    it('gives the reservation back when the job cannot be queued', async () => {
        queueAdd.mockRejectedValue(new Error('redis down'));
        await expect(enqueueScrape(ORG, job)).rejects.toThrow('redis down');
        expect(decr).toHaveBeenCalledTimes(1);
    });

    it('refuses an unknown tenant without reserving anything', async () => {
        query.mockResolvedValue({ rows: [] });
        await expect(enqueueScrape(ORG, job)).rejects.toThrow(/tenant/i);
        expect(incr).not.toHaveBeenCalled();
        expect(queueAdd).not.toHaveBeenCalled();
    });
});

describe('who enqueues scrapes', () => {
    const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');

    it('routes, the scheduler and the decay hunter go through the quota guard', () => {
        for (const f of [['routes', 'scrape.ts'], ['lib', 'scheduler.ts'], ['workers', 'decayRescoreWorker.ts']]) {
            const src = read(...f);
            expect(src).toMatch(/enqueueScrape\(/);
            expect(src).not.toMatch(/scrapeQueue\.add\('scrape'/);
        }
    });

    it('the engine no longer carries the hardcoded 5-scrape gate', () => {
        const src = read('engines', 'b2bScraper.ts');
        expect(src).not.toMatch(/FreeLimitReached/);
        expect(src).not.toMatch(/usage >= 5/);
    });
});
