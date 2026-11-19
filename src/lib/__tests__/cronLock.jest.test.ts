import { runOnce } from '../cronLock';

const set = jest.fn();
jest.mock('../redis', () => ({ getSharedRedisClient: () => ({ set: (...a: any[]) => set(...a) }) }));

describe('runOnce', () => {
    beforeEach(() => set.mockReset());

    it('runs the job when it takes the lock', async () => {
        set.mockResolvedValue('OK');
        const job = jest.fn().mockResolvedValue(undefined);
        await runOnce('x', 30, job);
        expect(set).toHaveBeenCalledWith('lock:cron:x', '1', 'EX', 30, 'NX');
        expect(job).toHaveBeenCalledTimes(1);
    });

    it('skips the job when another instance holds the lock', async () => {
        set.mockResolvedValue(null);
        const job = jest.fn();
        await runOnce('x', 30, job);
        expect(job).not.toHaveBeenCalled();
    });

    it('skips the job when Redis is unreachable', async () => {
        set.mockRejectedValue(new Error('down'));
        const job = jest.fn();
        await runOnce('x', 30, job);
        expect(job).not.toHaveBeenCalled();
    });
});
