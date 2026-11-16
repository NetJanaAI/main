export {};
// The limiter must key by tenant, so it has to run after tenantContext, and its counters must be shared
// across instances, so they live in Redis.
import fs from 'fs';
import path from 'path';

const multi = { incr: jest.fn(), pttl: jest.fn(), exec: jest.fn() };
const redis = { multi: jest.fn(() => multi), pexpire: jest.fn(), decr: jest.fn(), del: jest.fn() };

jest.mock('../../lib/redis', () => ({ getSharedRedisClient: () => redis }));

import { RedisRateLimitStore } from '../rateLimitStore';

beforeEach(() => {
    jest.clearAllMocks();
    multi.incr.mockReturnValue(multi);
    multi.pttl.mockReturnValue(multi);
    redis.multi.mockReturnValue(multi);
    redis.pexpire.mockResolvedValue(1);
});

describe('RedisRateLimitStore', () => {
    const store = () => {
        const s = new RedisRateLimitStore();
        s.init({ windowMs: 900000 } as any);
        return s;
    };

    it('counts hits under a namespaced key and starts the window on the first hit', async () => {
        multi.exec.mockResolvedValue([[null, 1], [null, -1]]);
        const r = await store().increment('tenant-1');
        expect(multi.incr).toHaveBeenCalledWith('rl:tenant-1');
        expect(redis.pexpire).toHaveBeenCalledWith('rl:tenant-1', 900000);
        expect(r.totalHits).toBe(1);
        expect(r.resetTime!.getTime()).toBeGreaterThan(Date.now());
    });

    it('leaves the window alone on later hits and reports the remaining time', async () => {
        multi.exec.mockResolvedValue([[null, 7], [null, 60000]]);
        const r = await store().increment('tenant-1');
        expect(redis.pexpire).not.toHaveBeenCalled();
        expect(r.totalHits).toBe(7);
        expect(r.resetTime!.getTime()).toBeLessThanOrEqual(Date.now() + 60000);
    });

    it('re-arms a counter that lost its expiry', async () => {
        multi.exec.mockResolvedValue([[null, 9], [null, -1]]);
        await store().increment('tenant-1');
        expect(redis.pexpire).toHaveBeenCalledWith('rl:tenant-1', 900000);
    });

    it('throws when Redis fails, so the limiter can fail open', async () => {
        multi.exec.mockResolvedValue([[new Error('down'), null], [null, null]]);
        await expect(store().increment('tenant-1')).rejects.toThrow('down');
    });

    it('supports decrement and reset', async () => {
        await store().decrement('tenant-1');
        await store().resetKey('tenant-1');
        expect(redis.decr).toHaveBeenCalledWith('rl:tenant-1');
        expect(redis.del).toHaveBeenCalledWith('rl:tenant-1');
    });
});

describe('tenantRateLimiter configuration', () => {
    it('limits by tier: enterprise and paid get more than free', () => {
        jest.resetModules();
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        jest.doMock('../../lib/redis', () => ({ getSharedRedisClient: () => redis }));
        const { tierLimit } = require('../rateLimit');
        process.env.NODE_ENV = prev;
        expect(tierLimit({ tenantTier: 'enterprise' })).toBeGreaterThan(tierLimit({ tenantTier: 'paid' }));
        expect(tierLimit({ tenantTier: 'paid' })).toBeGreaterThan(tierLimit({ tenantTier: 'free' }));
        expect(tierLimit({})).toBe(tierLimit({ tenantTier: 'free' }));
    });
});

describe('server.ts order', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.ts'), 'utf8');
    const at = (re: RegExp) => server.search(re);

    it('mounts the tenant limiter after tenantContext, with a coarse IP limiter before it', () => {
        const tenantCtx = at(/app\.use\(\s*tenantContext\s*\)/);
        const tenantLimiter = at(/app\.use\(\s*'\/api'\s*,\s*tenantRateLimiter\s*\)/);
        const ipLimiter = at(/app\.use\(\s*'\/api'\s*,\s*ipRateLimiter\s*\)/);
        expect(tenantCtx).toBeGreaterThan(-1);
        expect(tenantLimiter).toBeGreaterThan(tenantCtx);
        expect(ipLimiter).toBeGreaterThan(-1);
        expect(ipLimiter).toBeLessThan(tenantCtx);
    });
});
