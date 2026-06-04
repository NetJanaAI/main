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

async function loadAdminAuth(env: NodeJS.ProcessEnv) {
    jest.resetModules();
    process.env = { ...env };
    const mod = await import('../adminAuth');
    return mod.adminAuth;
}

describe('adminAuth', () => {
    const originalEnv = process.env;
    const originalWarn = console.warn;
    const originalError = console.error;

    beforeEach(() => {
        console.warn = jest.fn();
        console.error = jest.fn();
    });

    afterEach(() => {
        process.env = originalEnv;
        console.warn = originalWarn;
        console.error = originalError;
    });

    it('rejects production admin requests when no auth mechanism is configured', async () => {
        const adminAuth = await loadAdminAuth({ NODE_ENV: 'production' });
        const req = { headers: {}, ip: '203.0.113.45' } as Request;
        const res = mockResponse();
        const next: NextFunction = jest.fn();

        await adminAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'ServiceMisconfigured' }));
        expect(next).not.toHaveBeenCalled();
    });

    it('accepts the standalone x-admin-secret fallback when configured', async () => {
        const adminAuth = await loadAdminAuth({
            NODE_ENV: 'production',
            ADMIN_SECRET: 'admin-test-secret',
        });
        const req = {
            headers: { 'x-admin-secret': 'admin-test-secret' },
            ip: '203.0.113.45',
        } as unknown as Request;
        const res = mockResponse();
        const next: NextFunction = jest.fn();

        await adminAuth(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('requires an admin Clerk role when Clerk is configured', async () => {
        const adminAuth = await loadAdminAuth({
            NODE_ENV: 'production',
            CLERK_SECRET_KEY: 'sk_test_clerk',
        });
        const req = {
            headers: {},
            auth: {
                userId: 'user_123',
                sessionClaims: { publicMetadata: { role: 'member' } },
            },
        } as unknown as Request;
        const res = mockResponse();
        const next: NextFunction = jest.fn();

        await adminAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });
});
