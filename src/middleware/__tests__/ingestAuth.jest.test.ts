import { cidrContains, ingestAuthGuard } from '../ingestAuth';
import { query } from '../../lib/database';
import crypto from 'crypto';

jest.mock('../../lib/database', () => ({
    query: jest.fn(),
}));

jest.mock('../../lib/secrets', () => ({
    DEV_HMAC_SECRET: 'dev-secret',
    getHmacSecret: jest.fn(() => 'hash-secret'),
    getApiKeySecret: jest.fn(() => 'hash-secret'),
}));

describe('cidrContains', () => {
    it('matches a client IP inside an IPv4 CIDR block', () => {
        expect(cidrContains('203.0.113.0/24', '203.0.113.45')).toBe(true);
    });

    it('does not match a client IP outside an IPv4 CIDR block', () => {
        expect(cidrContains('203.0.113.0/24', '203.0.114.45')).toBe(false);
    });

    it('still supports exact host entries', () => {
        expect(cidrContains('198.51.100.10', '198.51.100.10')).toBe(true);
        expect(cidrContains('198.51.100.10', '198.51.100.11')).toBe(false);
    });

    it('fails closed for malformed allowlist entries', () => {
        expect(cidrContains('not-a-cidr', '203.0.113.45')).toBe(false);
    });
});

describe('ingestAuthGuard', () => {
    let mockReq: any;
    let mockRes: any;
    let mockNext: any;
    const originalEnv = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
        mockReq = {
            ip: '192.168.1.50',
            headers: {},
            socket: {},
        };
        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };
        mockNext = jest.fn();
        (query as jest.Mock).mockReset();
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('allows localhost immediately in dev environment', async () => {
        process.env.NODE_ENV = 'development';
        mockReq.ip = '127.0.0.1';

        // Mock queries for allowed_ips and Default Organization lookup
        (query as jest.Mock).mockImplementation((sql: string) => {
            if (sql.includes('allowed_ips')) {
                return Promise.resolve({ rows: [] });
            }
            if (sql.includes('tenants') && sql.includes('Default Organization')) {
                return Promise.resolve({ rows: [{ id: 'default-org-id' }] });
            }
            return Promise.resolve({ rows: [] });
        });

        await ingestAuthGuard(mockReq, mockRes, mockNext);

        expect(mockNext).toHaveBeenCalled();
        expect(mockReq.organizationId).toBe('default-org-id');
    });

    it('blocks unauthorized IP in production', async () => {
        process.env.NODE_ENV = 'production';
        process.env.ALLOWED_INGEST_IPS = '192.168.1.10';
        mockReq.ip = '192.168.1.50';

        (query as jest.Mock).mockResolvedValue({ rows: [] }); // DB dynamic allowlist empty

        await ingestAuthGuard(mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(403);
        expect(mockRes.json).toHaveBeenCalledWith({ error: 'Forbidden: IP not in allowlist' });
        expect(mockNext).not.toHaveBeenCalled();
    });

    it('allows allowed IP from DB allowlist with proper HMAC and API Key', async () => {
        process.env.NODE_ENV = 'production';
        mockReq.ip = '192.168.1.50';

        // Mock database queries
        (query as jest.Mock).mockImplementation((sql: string) => {
            if (sql.includes('allowed_ips')) {
                return Promise.resolve({ rows: [{ cidr: '192.168.1.0/24' }] });
            }
            if (sql.includes('tenants') && sql.includes('api_key_hash')) {
                return Promise.resolve({ rows: [{ id: 'org-123' }] });
            }
            return Promise.resolve({ rows: [] });
        });

        // HMAC verification block config
        const secret = 'real-production-secret';
        process.env.HMAC_SECRET = secret;
        mockReq.rawBody = '{"test": true}';
        const validSig = crypto.createHmac('sha256', secret).update(mockReq.rawBody).digest('hex');
        mockReq.headers['x-source-signature'] = validSig;

        // API Key lookup config
        mockReq.headers['x-api-key'] = 'test-key';

        await ingestAuthGuard(mockReq, mockRes, mockNext);

        expect(mockNext).toHaveBeenCalled();
        expect(mockReq.organizationId).toBe('org-123');
    });

    it('requires HMAC signature verification if configured in production', async () => {
        process.env.NODE_ENV = 'production';
        process.env.ALLOWED_INGEST_IPS = '192.168.1.50';
        process.env.HMAC_SECRET = 'real-production-secret';
        mockReq.ip = '192.168.1.50';

        (query as jest.Mock).mockResolvedValue({ rows: [] });

        await ingestAuthGuard(mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
            error: expect.stringContaining('x-source-signature header is required')
        }));
        expect(mockNext).not.toHaveBeenCalled();
    });

    it('fails on invalid HMAC signature', async () => {
        process.env.NODE_ENV = 'production';
        process.env.ALLOWED_INGEST_IPS = '192.168.1.50';
        process.env.HMAC_SECRET = 'real-production-secret';
        mockReq.ip = '192.168.1.50';
        // Provide incorrect signature of the exact same length (64 hex characters) to trigger mismatch, not malformed
        mockReq.headers['x-source-signature'] = 'a'.repeat(64);
        mockReq.rawBody = '{"test": true}';

        (query as jest.Mock).mockResolvedValue({ rows: [] });

        await ingestAuthGuard(mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockRes.json).toHaveBeenCalledWith({ error: 'Unauthorized: Invalid HMAC signature' });
        expect(mockNext).not.toHaveBeenCalled();
    });

    it('allows request with valid HMAC signature and valid API key', async () => {
        process.env.NODE_ENV = 'production';
        process.env.ALLOWED_INGEST_IPS = '192.168.1.50';
        const secret = 'real-production-secret';
        process.env.HMAC_SECRET = secret;
        mockReq.ip = '192.168.1.50';
        mockReq.rawBody = '{"test": true}';

        const validSig = crypto.createHmac('sha256', secret).update(mockReq.rawBody).digest('hex');
        mockReq.headers['x-source-signature'] = validSig;

        // Mock dynamic IP and API key database check
        (query as jest.Mock).mockImplementation((sql: string) => {
            if (sql.includes('allowed_ips')) {
                return Promise.resolve({ rows: [] });
            }
            if (sql.includes('tenants') && sql.includes('api_key_hash')) {
                return Promise.resolve({ rows: [{ id: 'org-456' }] });
            }
            return Promise.resolve({ rows: [] });
        });

        mockReq.headers['x-api-key'] = 'valid-api-key';

        await ingestAuthGuard(mockReq, mockRes, mockNext);

        expect(mockNext).toHaveBeenCalled();
        expect(mockReq.organizationId).toBe('org-456');
    });

    it('performs dynamic hash migration from old HMAC secret key to new API Key secret key', async () => {
        process.env.NODE_ENV = 'production';
        process.env.ALLOWED_INGEST_IPS = '192.168.1.50';
        
        // Mock secrets env
        const oldSecret = 'old-legacy-secret';
        const newSecret = 'new-api-key-secret';
        process.env.HMAC_SECRET = oldSecret;
        process.env.API_KEY_SECRET = newSecret;
        
        // Mock getApiKeySecret to return newSecret
        const secretsMod = require('../../lib/secrets');
        (secretsMod.getApiKeySecret as jest.Mock).mockReturnValue(newSecret);

        mockReq.ip = '192.168.1.50';
        mockReq.rawBody = '{"test": true}';

        // Mock HMAC signature header with old secret (no HMAC secret config check is fine if it bypasses or matches)
        // Actually, HMAC verification is active if HMAC_SECRET is set:
        const validSig = crypto.createHmac('sha256', oldSecret).update(mockReq.rawBody).digest('hex');
        mockReq.headers['x-source-signature'] = validSig;

        mockReq.headers['x-api-key'] = 'legacy-key-123';

        const newHash = crypto.createHmac('sha256', newSecret).update('legacy-key-123').digest('hex');
        const oldHash = crypto.createHmac('sha256', oldSecret).update('legacy-key-123').digest('hex');

        // Capture SQL queries
        const executedQueries: Array<{ sql: string; params: any[] }> = [];
        (query as jest.Mock).mockImplementation((sql: string, params?: any[]) => {
            executedQueries.push({ sql, params: params || [] });
            if (sql.includes('allowed_ips')) {
                return Promise.resolve({ rows: [] });
            }
            if (sql.includes('tenants') && sql.includes('api_key_hash')) {
                if (params && params[0] === newHash) {
                    // First lookup with new hash fails
                    return Promise.resolve({ rows: [] });
                }
                if (params && params[0] === oldHash) {
                    // Second lookup with old hash succeeds
                    return Promise.resolve({ rows: [{ id: 'org-migrated-123' }] });
                }
            }
            return Promise.resolve({ rows: [] });
        });

        await ingestAuthGuard(mockReq, mockRes, mockNext);

        expect(mockNext).toHaveBeenCalled();
        expect(mockReq.organizationId).toBe('org-migrated-123');

        // Verify UPDATE and INSERT audit_logs queries were run
        const updateQuery = executedQueries.find(q => q.sql.includes('UPDATE tenants SET api_key_hash'));
        expect(updateQuery).toBeDefined();
        expect(updateQuery?.params).toEqual([newHash, 'org-migrated-123']);

        const insertAuditQuery = executedQueries.find(q => q.sql.includes('INSERT INTO audit_logs'));
        expect(insertAuditQuery).toBeDefined();
        expect(insertAuditQuery?.params[2]).toBe('org-migrated-123'); // organizationId
        expect(insertAuditQuery?.params[3]).toBe('API_KEY_HASH_MIGRATED'); // action
    });
});
