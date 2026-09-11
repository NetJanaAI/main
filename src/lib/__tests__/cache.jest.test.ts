import { cache } from '../cache';
import { getSharedRedisClient } from '../redis';

jest.mock('../redis', () => {
    const mockPipeline = {
        hincrby: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(['OK', 1])
    };

    const mockRedis = {
        get: jest.fn(),
        set: jest.fn().mockResolvedValue('OK'),
        del: jest.fn().mockResolvedValue(1),
        incr: jest.fn().mockResolvedValue(1),
        incrby: jest.fn().mockResolvedValue(10),
        decr: jest.fn().mockResolvedValue(0),
        expire: jest.fn().mockResolvedValue(1),
        lrange: jest.fn().mockResolvedValue(['a', 'b']),
        hgetall: jest.fn().mockResolvedValue({ field1: 'val1' }),
        pipeline: jest.fn().mockReturnValue(mockPipeline)
    };

    return {
        getSharedRedisClient: jest.fn(() => mockRedis)
    };
});

describe('Cache Wrapper Unit Tests', () => {
    let mockRedis: any;

    beforeEach(() => {
        jest.clearAllMocks();
        mockRedis = getSharedRedisClient();
    });

    it('should set key with JSON serialization and EX/NX options', async () => {
        await cache.set('key-1', { a: 1 }, { ex: 3600, nx: true });
        expect(mockRedis.set).toHaveBeenCalledWith('key-1', '{"a":1}', 'EX', 3600, 'NX');
    });

    it('should set raw string key without double serialization', async () => {
        await cache.set('key-2', 'plain-string');
        expect(mockRedis.set).toHaveBeenCalledWith('key-2', 'plain-string');
    });

    it('should get value from redis client', async () => {
        mockRedis.get.mockResolvedValueOnce('stored-val');
        const val = await cache.get('key-3');
        expect(val).toBe('stored-val');
    });

    it('should support atomic incr, incrby, decr operations', async () => {
        await cache.incr('counter');
        expect(mockRedis.incr).toHaveBeenCalledWith('counter');

        await cache.incrby('counter', 5);
        expect(mockRedis.incrby).toHaveBeenCalledWith('counter', 5);

        await cache.decr('counter');
        expect(mockRedis.decr).toHaveBeenCalledWith('counter');
    });

    it('should support hgetall returning null when empty object', async () => {
        mockRedis.hgetall.mockResolvedValueOnce({});
        const res = await cache.hgetall('empty-hash');
        expect(res).toBeNull();
    });

    it('should execute pipeline operations', async () => {
        const pipe = cache.pipeline();
        pipe.hincrby('hash-key', 'field-1', 1);
        pipe.expire('hash-key', 60);
        await pipe.exec();

        expect(mockRedis.pipeline).toHaveBeenCalled();
    });
});
