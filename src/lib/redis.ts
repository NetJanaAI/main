import IORedis from 'ioredis';
import { connection } from './queue';

let _redis: IORedis | null = null;

/**
 * Returns a shared, singleton IORedis instance to prevent connection bloat.
 * Intended for standard KV cache operations, dedup keys, and logs.
 * 
 * Note: BullMQ queues and workers manage their own connection instances automatically.
 */
export function getSharedRedisClient(): IORedis {
    if (!_redis) {
        _redis = new IORedis({
            ...(connection as any),
            lazyConnect: true, // Don't block event loop on startup
            enableOfflineQueue: true,
        });
        _redis.on('error', (err) => {
            // Suppress duplicate connection warnings to avoid log spam
            if ((_redis as any)._lastErrorLogged !== err.message) {
                console.warn('[Redis] Connection warning:', err.message);
                (_redis as any)._lastErrorLogged = err.message;
            }
        });
    }
    return _redis;
}
