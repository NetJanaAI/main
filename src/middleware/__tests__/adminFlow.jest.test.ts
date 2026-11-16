// End to end through the real middleware chain: Clerk JWT -> tenantContext -> adminAuth.
// Platform admin = Clerk user id in PLATFORM_ADMIN_USER_IDS. Nothing a tenant controls can grant it.
import { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

const ADMIN = 'user_platform_admin';
const TENANT_USER = 'user_tenant_member';
const TENANT_ORG_ADMIN = 'user_tenant_org_admin';

// What @clerk/backend verifyToken really returns: the raw JWT payload, no sessionClaims/userId.
const claims: Record<string, any> = {
    t_admin: { sub: ADMIN },
    t_member: { sub: TENANT_USER, org_id: 'clerk_org_1', org_role: 'org:member' },
    t_orgadmin: { sub: TENANT_ORG_ADMIN, org_id: 'clerk_org_1', org_role: 'org:admin', public_metadata: { role: 'admin' }, metadata: { role: 'super_admin' } },
    t_lookalike: { sub: `${ADMIN}_2` },
};
// Tenant rows by Clerk org / user id. The platform admin has no tenant of their own.
const tenantRows: Record<string, string> = { clerk_org_1: 'tenant-uuid-1' };

async function load(env: NodeJS.ProcessEnv) {
    jest.resetModules();
    process.env = { ...env };
    jest.doMock('@clerk/backend', () => ({
        createClerkClient: jest.fn(() => ({})),
        verifyToken: jest.fn(async (token: string) => { if (!claims[token]) throw new Error('bad token'); return claims[token]; }),
    }));
    jest.doMock('../../lib/database', () => ({
        query: jest.fn(async (_sql: string, params: any[]) => (tenantRows[params[0]] ? { rows: [{ id: tenantRows[params[0]] }] } : { rows: [] })),
    }));
    jest.doMock('../../lib/secrets', () => ({ getHmacSecret: jest.fn(() => 's'), getApiKeySecret: jest.fn(() => 's') }));
    jest.doMock('../../core/compliance/AuditTrail', () => ({ AuditTrail: { log: jest.fn().mockResolvedValue(undefined) } }));
    const { tenantContext } = await import('../tenant');
    const { adminAuth } = await import('../adminAuth');
    return { tenantContext, adminAuth };
}

function res() {
    const r: any = { status: jest.fn(() => r), json: jest.fn(() => r) };
    return r as Response & { status: jest.Mock; json: jest.Mock };
}

/** Runs a request through tenantContext and, if it passes, adminAuth. Returns the HTTP status (200 = reached the handler). */
async function call(env: NodeJS.ProcessEnv, token: string | null, urlPath = '/api/admin/tenants', headers: Record<string, string> = {}) {
    const { tenantContext, adminAuth } = await load(env);
    const req: any = { path: urlPath, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, ip: '203.0.113.9' };
    const r = res();
    let reached = false;
    await new Promise<void>((resolve) => {
        const finish = () => resolve();
        r.json.mockImplementation(() => { finish(); return r; });
        const afterTenant: NextFunction = () => {
            if (!urlPath.startsWith('/api/admin')) { reached = true; return finish(); }
            Promise.resolve(adminAuth(req as Request, r, (() => { reached = true; finish(); }) as NextFunction));
        };
        Promise.resolve(tenantContext(req, r, afterTenant));
    });
    return { status: reached ? 200 : r.status.mock.calls[0]?.[0], req };
}

const clerkEnv = { NODE_ENV: 'production', CLERK_SECRET_KEY: 'sk_test_x', PLATFORM_ADMIN_USER_IDS: ` ${ADMIN} , user_other_admin ` };

describe('admin routes with Clerk configured', () => {
    it('lets a platform admin reach /api/admin/tenants, with no tenant of their own', async () => {
        const { status, req } = await call(clerkEnv, 't_admin');
        expect(status).toBe(200);
        expect(req.adminRole).toBe('super_admin');
        expect(req.adminActorId).toBe(ADMIN);
    });

    it('returns 403 to an ordinary tenant user', async () => {
        expect((await call(clerkEnv, 't_member')).status).toBe(403);
    });

    it('returns 403 to a tenant org admin, whatever role claims the tenant controls', async () => {
        expect((await call(clerkEnv, 't_orgadmin')).status).toBe(403);
    });

    it('matches user ids exactly, not by prefix (denied before adminAuth: no tenant, not a listed admin)', async () => {
        expect((await call(clerkEnv, 't_lookalike')).status).toBe(401);
    });

    it('returns 401 with no credentials', async () => {
        expect((await call(clerkEnv, null)).status).toBe(401);
    });

    it('fails closed for everyone when PLATFORM_ADMIN_USER_IDS is unset or blank', async () => {
        for (const ids of [undefined, ' , ']) {
            const { PLATFORM_ADMIN_USER_IDS, ...base } = clerkEnv;
            const { adminAuth } = await load(ids === undefined ? base : { ...base, PLATFORM_ADMIN_USER_IDS: ids });
            const r = res();
            const next = jest.fn();
            await adminAuth({ path: '/api/admin/tenants', headers: {}, auth: { sub: ADMIN } } as any, r, next);
            expect(next).not.toHaveBeenCalled();
            expect(r.status).toHaveBeenCalledWith(403);
        }
    });

    it('does not turn the platform admin into a tenant outside /api/admin', async () => {
        const { tenantContext } = await load(clerkEnv);
        const r = res();
        const next = jest.fn();
        await tenantContext({ path: '/api/leads', headers: { authorization: 'Bearer t_admin' } } as any, r, next);
        expect(next).not.toHaveBeenCalled();
        expect(r.status).toHaveBeenCalledWith(401);
    });

    it('does not accept the standalone x-admin-secret while Clerk is configured', async () => {
        const { status } = await call({ ...clerkEnv, ADMIN_SECRET: 'letmein' }, null, '/api/admin/tenants', { 'x-admin-secret': 'letmein' });
        expect(status).toBe(401);
    });
});

describe('x-admin-secret (standalone, no Clerk)', () => {
    const env = { NODE_ENV: 'production', ADMIN_SECRET: 'correct-horse-battery' };
    const run = async (provided?: string) => {
        const { adminAuth } = await load(env);
        const r = res();
        const next = jest.fn();
        await adminAuth({ headers: provided === undefined ? {} : { 'x-admin-secret': provided }, ip: '203.0.113.9' } as any, r, next);
        return { r, next };
    };

    it('accepts the right secret', async () => expect((await run('correct-horse-battery')).next).toHaveBeenCalled());
    it('rejects wrong, shorter, longer and missing secrets with 401', async () => {
        for (const bad of ['wrong', 'correct-horse-batter', 'correct-horse-battery!', '', undefined]) {
            const { r, next } = await run(bad);
            expect(next).not.toHaveBeenCalled();
            expect(r.status).toHaveBeenCalledWith(401);
        }
    });
    it('compares in constant time', async () => {
        const crypto = require('crypto');
        const spy = jest.spyOn(crypto, 'timingSafeEqual');
        await run('wrong');
        await run('correct-horse-battery');
        expect(spy).toHaveBeenCalledTimes(2);
        spy.mockRestore();
    });
});

describe('admin audit trail', () => {
    it('attributes admin actions to the verified admin, not a field Clerk never sets', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'admin.ts'), 'utf8');
        expect(src).not.toMatch(/auth\?\.userId/);
        expect(src).toMatch(/adminActorId/);
    });
    it('records vanish, DLQ retry and DLQ dismiss as admin actions', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'admin.ts'), 'utf8');
        for (const action of ['ADMIN_TENANT_VANISH', 'ADMIN_DLQ_RETRY', 'ADMIN_DLQ_DISMISS']) expect(src).toContain(action);
    });
});
