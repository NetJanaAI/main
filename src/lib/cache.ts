import { getSharedRedisClient } from './redis';
import { Redis as UpstashRedis } from '@upstash/redis';

type SetOptions = {
    ex?: number;
    nx?: boolean;
};

type CachePipeline = {
    hincrby(key: string, field: string, value: number): CachePipeline;
    expire(key: string, seconds: number): CachePipeline;
    exec(): Promise<unknown>;
};

type CacheClient = {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown, options?: SetOptions): Promise<unknown>;
    del(key: string): Promise<unknown>;
    incr(key: string): Promise<number>;
    incrby(key: string, value: number): Promise<number>;
    decr(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<unknown>;
    lrange<T = unknown>(key: string, start: number, stop: number): Promise<T[]>;
    hgetall<T = Record<string, unknown>>(key: string): Promise<T | null>;
    pipeline(): CachePipeline;
};

function createLocalRedisCache(): CacheClient {
    const redis = getSharedRedisClient();

    return {
        async get<T = unknown>(key: string) {
            const value = await redis.get(key);
            return value as T | null;
        },
        async set(key: string, value: unknown, options?: SetOptions) {
            const serialized = typeof value === 'string' ? value : JSON.stringify(value);
            const args: (string | number)[] = [key, serialized];
            if (options?.ex) args.push('EX', options.ex);
            if (options?.nx) args.push('NX');
            return (redis.set as any)(...args);
        },
        del: (key: string) => redis.del(key),
        incr: (key: string) => redis.incr(key),
        incrby: (key: string, value: number) => redis.incrby(key, value),
        decr: (key: string) => redis.decr(key),
        expire: (key: string, seconds: number) => redis.expire(key, seconds),
        async lrange<T = unknown>(key: string, start: number, stop: number) {
            return (await redis.lrange(key, start, stop)) as T[];
        },
        async hgetall<T = Record<string, unknown>>(key: string) {
            const value = await redis.hgetall(key);
            return (Object.keys(value).length ? value : null) as T | null;
        },
        pipeline() {
            const pipeline = redis.pipeline();
            const wrapper: CachePipeline = {
                hincrby(key: string, field: string, value: number) {
                    pipeline.hincrby(key, field, value);
                    return wrapper;
                },
                expire(key: string, seconds: number) {
                    pipeline.expire(key, seconds);
                    return wrapper;
                },
                exec: () => pipeline.exec(),
            };
            return wrapper;
        },
    };
}

function createUpstash(): UpstashRedis | null {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    return url && token ? new UpstashRedis({ url, token }) : null;
}

const upstash = createUpstash();

function createCache(): CacheClient {
    return upstash ? (upstash as unknown as CacheClient) : createLocalRedisCache();
}

export const cache = createCache();

/**
 * Deletes every key matching a glob pattern, using SCAN so it never blocks Redis.
 * Callers must build the pattern from validated values (e.g. a UUID), never raw input.
 */
export async function deleteKeysMatching(pattern: string): Promise<number> {
    let deleted = 0;
    let cursor = '0';
    do {
        let keys: string[];
        if (upstash) {
            const [next, found] = await upstash.scan(cursor, { match: pattern, count: 200 });
            cursor = String(next);
            keys = found;
            if (keys.length) await upstash.del(...keys);
        } else {
            const redis = getSharedRedisClient();
            const [next, found] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
            cursor = next;
            keys = found;
            if (keys.length) await redis.del(...keys);
        }
        deleted += keys.length;
    } while (cursor !== '0');
    return deleted;
}
