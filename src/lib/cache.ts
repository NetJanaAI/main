import { Redis as UpstashRedis } from '@upstash/redis';
import IORedis from 'ioredis';
import { connection } from './queue';

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
    const redis = new IORedis({
        ...(connection as any),
        lazyConnect: false,
        enableOfflineQueue: true,
    });

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

function createCache(): CacheClient {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (url && token) {
        return new UpstashRedis({ url, token }) as unknown as CacheClient;
    }

    return createLocalRedisCache();
}

export const cache = createCache();
