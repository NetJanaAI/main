import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit';
import { getSharedRedisClient } from '../lib/redis';

/**
 * Rate limit counters in Redis, so every API instance counts against the same window
 * (express-rate-limit's default store is per process).
 */
export class RedisRateLimitStore implements Store {
    localKeys = false;
    private windowMs = 15 * 60 * 1000;

    constructor(public prefix = 'rl:') {}

    init(options: Options): void {
        this.windowMs = options.windowMs;
    }

    async increment(key: string): Promise<ClientRateLimitInfo> {
        const redisKey = this.prefix + key;
        const redis = getSharedRedisClient();
        const results = await redis.multi().incr(redisKey).pttl(redisKey).exec();
        const [incrResult, ttlResult] = results ?? [];
        if (!incrResult || incrResult[0]) throw incrResult?.[0] ?? new Error('Redis rate limit increment failed');

        let ttl = Number(ttlResult?.[1] ?? -1);
        if (ttl < 0) {
            // First hit of a window, or a counter that lost its expiry: start the window now.
            await redis.pexpire(redisKey, this.windowMs);
            ttl = this.windowMs;
        }
        return { totalHits: Number(incrResult[1]), resetTime: new Date(Date.now() + ttl) };
    }

    async decrement(key: string): Promise<void> {
        await getSharedRedisClient().decr(this.prefix + key);
    }

    async resetKey(key: string): Promise<void> {
        await getSharedRedisClient().del(this.prefix + key);
    }
}
