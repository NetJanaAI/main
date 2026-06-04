import { NextFunction, Request, Response } from 'express';

jest.mock('@clerk/backend', () => ({
    createClerkClient: jest.fn(() => ({})),
    verifyToken: jest.fn(),
}));

jest.mock('../../lib/database', () => ({
    query: jest.fn(),
}));

jest.mock('../../lib/secrets', () => ({
    getHmacSecret: jest.fn(() => 'hash-secret'),
}));

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

async function loadTenantContext(env: NodeJS.ProcessEnv) {
    jest.resetModules();
    process.env = { ...env };
    jest.doMock('@clerk/backend', () => ({
        createClerkClient: jest.fn(() => ({})),
        verifyToken: jest.fn(),
    }));
    jest.doMock('../../lib/database', () => ({
        query: jest.fn(),
    }));
    jest.doMock('../../lib/secrets', () => ({
        getHmacSecret: jest.fn(() => 'hash-secret'),
    }));
    const mod = await import('../tenant');
    return mod.tenantContext;
}

describe('tenantContext public route policy', () => {
    const originalEnv = process.env;

    afterEach(() => {
        process.env = originalEnv;
    });

    it('allows unauthenticated access to aggregate lead stats', async () => {
        const tenantContext = await loadTenantContext({ NODE_ENV: 'production' });
        const req = { path: '/api/leads/stats', headers: {} } as Request;
        const res = mockResponse();
        const next: NextFunction = jest.fn();

        await tenantContext(req as any, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('does not allow unauthenticated access to lead match details', async () => {
        const tenantContext = await loadTenantContext({ NODE_ENV: 'production' });
        const req = { path: '/api/leads/match', headers: {} } as Request;
        const res = mockResponse();
        const next: NextFunction = jest.fn();

        await tenantContext(req as any, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ error: expect.stringContaining('Unauthorized') })
        );
        expect(next).not.toHaveBeenCalled();
    });
});
