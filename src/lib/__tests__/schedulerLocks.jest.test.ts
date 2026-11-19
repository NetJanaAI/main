const ticks: Array<() => unknown> = [];
const set = jest.fn();
const enqueueScrape = jest.fn().mockResolvedValue(undefined);
const decayAdd = jest.fn().mockResolvedValue(undefined);

jest.mock('node-cron', () => ({
    validate: () => true,
    schedule: (_expr: string, fn: () => unknown) => {
        ticks.push(fn);
        return { stop: jest.fn() };
    },
}));
jest.mock('../redis', () => ({ getSharedRedisClient: () => ({ set: (...a: any[]) => set(...a) }) }));
jest.mock('../queue', () => ({ connection: {} }));
jest.mock('../quota', () => ({ enqueueScrape: (...a: any[]) => enqueueScrape(...a) }));
jest.mock('../database', () => ({ query: jest.fn().mockResolvedValue({ rows: [] }) }));
jest.mock('bullmq', () => ({ Queue: jest.fn().mockImplementation(() => ({ add: decayAdd })) }));

import { addSchedule, bootstrapSchedules } from '../scheduler';

describe('scheduler locks', () => {
    beforeEach(() => {
        ticks.length = 0;
        set.mockReset();
        enqueueScrape.mockClear();
        decayAdd.mockClear();
    });

    it('enqueues a scheduled scrape once across instances', async () => {
        addSchedule({
            id: 's1', domain: 'acme.com', cron_expression: '* * * * *',
            use_online_ai: false, spider_mode: false, max_pages: 1, organization_id: 'org_a',
        });
        set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

        await ticks[0]();
        await ticks[0]();

        expect(set).toHaveBeenCalledWith('lock:cron:scrape:s1', '1', 'EX', 30, 'NX');
        expect(enqueueScrape).toHaveBeenCalledTimes(1);
    });

    it('runs the daily decay rescore only on the instance that takes the lock', async () => {
        await bootstrapSchedules();
        set.mockResolvedValueOnce(null);
        await ticks[0]();
        expect(decayAdd).not.toHaveBeenCalled();

        set.mockResolvedValueOnce('OK');
        await ticks[0]();
        expect(decayAdd).toHaveBeenCalledTimes(1);
        expect(set).toHaveBeenLastCalledWith('lock:cron:decay-rescore', '1', 'EX', 60, 'NX');
    });
});
