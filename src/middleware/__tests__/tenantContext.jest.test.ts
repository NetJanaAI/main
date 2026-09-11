import { NextFunction, Request, Response } from 'express';

type MockResponse = Response & {
    status: jest.Mock;
    json: jest.Mock;
};

function mockResponse(): MockResponse {
    const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
    };
    return res as unknown as MockResponse;
}

async function loadTenantContext(env: NodeJS.ProcessEnv, mockQueryImpl?: any) {
    jest.resetModules();
    process.env = { ...env };
    
    const mockQuery = mockQueryImpl || jest.fn().mockResolvedValue({ rows: [] });

    jest.doMock('@clerk/backend', () => ({
        createClerkClient: jest.fn(() => ({})),
        verifyToken: jest.fn(),
    }));
    jest.doMock('../../lib/database', () => ({
        query: mockQuery,
    }));
    jest.doMock('../../lib/secrets', () => ({
        getHmacSecret: jest.fn(() => 'hash-secret'),
        getApiKeySecret: jest.fn(() => 'hash-secret'),
    }));
    jest.doMock('../../core/compliance/AuditTrail', () => ({
        AuditTrail: { log: jest.fn().mockResolvedValue(undefined) }
    }));

    const mod = await import('../tenant');
    return { tenantContext: mod.tenantContext, mockQuery };
}

describe('tenantContext public route policy', () => {
    const originalEnv = process.env;

    afterEach(() => {
        process.env = originalEnv;
    });

    it('does not allow unauthenticated access to aggregate lead stats', async () => {
        const { tenantContext } = await loadTenantContext({ NODE_ENV: 'production' });
        const req = { path: '/api/leads/stats', headers: {} } as Request;
        const res = mockResponse();
        const next: NextFunction = jest.fn();

        await tenantContext(req as any, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ error: expect.stringContaining('Unauthorized') })
        );
        expect(next).not.toHaveBeenCalled();
    });

    it('allows /api/ingest routes to pass through', async () => {
        const { tenantContext } = await loadTenantContext({ NODE_ENV: 'production' });
        const req = { path: '/api/ingest/indiamart', headers: {} } as Request;
        const res = mockResponse();
        const next: NextFunction = jest.fn();

        await tenantContext(req as any, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('authenticates request via valid API key', async () => {
        const mockQuery = jest.fn().mockResolvedValueOnce({ rows: [{ id: 'tenant-123' }] });
        const { tenantContext } = await loadTenantContext({ NODE_ENV: 'production' }, mockQuery);

        const req = { path: '/api/leads', headers: { 'x-api-key': 'valid-api-key' } } as unknown as Request;
        const res = mockResponse();
        const next: NextFunction = jest.fn();

        await tenantContext(req as any, res, next);

        expect((req as any).organizationId).toBe('tenant-123');
        expect(next).toHaveBeenCalled();
    });

    it('performs dynamic hash migration when API key matches old secret hash', async () => {
        const mockQuery = jest.fn()
            .mockResolvedValueOnce({ rows: [] }) // new secret hash miss
            .mockResolvedValueOnce({ rows: [{ id: 'migrated-tenant-456' }] }) // old secret hash hit
            .mockResolvedValueOnce({ rows: [] }); // update tenant hash

        const { tenantContext } = await loadTenantContext({
            NODE_ENV: 'production',
            OLD_HMAC_SECRET: 'old-secret-key'
        }, mockQuery);

        const req = { path: '/api/leads', headers: { 'x-api-key': 'legacy-api-key' } } as unknown as Request;
        const res = mockResponse();
        const next: NextFunction = jest.fn();

        await tenantContext(req as any, res, next);

        expect((req as any).organizationId).toBe('migrated-tenant-456');
        expect(next).toHaveBeenCalled();
    });

    it('uses dev fallback Default Organization in non-production when no auth provided', async () => {
        const mockQuery = jest.fn().mockResolvedValueOnce({ rows: [{ id: 'default-dev-tenant-id' }] });
        const { tenantContext } = await loadTenantContext({ NODE_ENV: 'development' }, mockQuery);

        const req = { path: '/api/leads', headers: {} } as Request;
        const res = mockResponse();
        const next: NextFunction = jest.fn();

        await tenantContext(req as any, res, next);

        expect((req as any).organizationId).toBe('default-dev-tenant-id');
        expect(next).toHaveBeenCalled();
    });
});
