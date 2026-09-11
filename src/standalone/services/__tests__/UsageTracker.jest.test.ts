import { UsageTracker } from '../UsageTracker';
import { getSharedRedisClient } from '../../../lib/redis';

jest.mock('../../../lib/redis', () => {
    const mockRedis = {
        incr: jest.fn(),
        get: jest.fn(),
        expire: jest.fn().mockResolvedValue(1)
    };
    return {
        getSharedRedisClient: jest.fn(() => mockRedis)
    };
});

describe('UsageTracker Standalone Service', () => {
    let mockRedis: any;

    beforeEach(() => {
        jest.clearAllMocks();
        mockRedis = getSharedRedisClient();
    });

    it('should increment usage, set expire on first use, and check limitReached', async () => {
        mockRedis.incr.mockResolvedValueOnce(1); // used = 1

        const status = await UsageTracker.increment('org-test', 'scrapes');

        expect(status.used).toBe(1);
        expect(status.limitReached).toBe(false);
        expect(mockRedis.expire).toHaveBeenCalledWith(
            expect.stringMatching(/^usage:org-test:scrapes:\d{4}-\d{2}$/),
            expect.any(Number)
        );
    });

    it('should report limitReached as true when usage exceeds freemium limit', async () => {
        mockRedis.incr.mockResolvedValueOnce(6); // scrapes limit is 5

        const status = await UsageTracker.increment('org-test', 'scrapes');

        expect(status.used).toBe(6);
        expect(status.limitReached).toBe(true);
        expect(status.remaining).toBe(0);
    });

    it('should return correct usage count via getUsage', async () => {
        mockRedis.get.mockResolvedValueOnce('4');
        const count = await UsageTracker.getUsage('org-test', 'scrapes');
        expect(count).toBe(4);
    });

    it('should trigger SparkToro nudge threshold when usage reaches 60% of limit', async () => {
        // Limit for scrapes is 5. 60% = 3
        mockRedis.get.mockResolvedValueOnce('3');
        const isNudge = await UsageTracker.isNudgeThreshold('org-test', 'scrapes');
        expect(isNudge).toBe(true);

        mockRedis.get.mockResolvedValueOnce('1');
        const isNudgeLow = await UsageTracker.isNudgeThreshold('org-test', 'scrapes');
        expect(isNudgeLow).toBe(false);
    });
});
