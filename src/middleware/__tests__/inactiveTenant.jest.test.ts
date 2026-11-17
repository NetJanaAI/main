export {};
// A deactivated tenant (Clerk user or organisation deleted) must not authenticate by any route:
// Clerk session, API key, ingest key or socket. Every credential lookup has to exclude it.
import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return e.name === '__tests__' ? [] : sourceFiles(full);
        return e.name.endsWith('.ts') ? [full] : [];
    });
}

const CREDENTIAL_LOOKUP = /SELECT[^;`'"]*FROM tenants WHERE (?:api_key_hash|clerk_org_id|clerk_user_id)\s*=\s*\$1[^;`'"]*/g;

describe('tenant credential lookups', () => {
    const lookups = sourceFiles(SRC).flatMap((file) =>
        [...fs.readFileSync(file, 'utf8').matchAll(CREDENTIAL_LOOKUP)].map((m) => ({ file: path.relative(SRC, file), sql: m[0] })));

    it('finds the lookups this test is meant to guard', () => {
        const files = new Set(lookups.map((l) => l.file.replace(/\\/g, '/')));
        for (const expected of ['middleware/tenant.ts', 'middleware/ingestAuth.ts', 'middleware/socketAuth.ts', 'routes/netjana-intel.ts']) {
            expect(files).toContain(expected);
        }
    });

    it.each(lookups.map((l) => [l.file, l.sql]))('%s excludes deactivated tenants: %s', (_file, sql) => {
        expect(sql).toMatch(/deactivated_at IS NULL/);
    });
});

describe('tenantContext with a deactivated Clerk tenant', () => {
    it('returns 401 because the lookup finds no active tenant', async () => {
        jest.resetModules();
        process.env = { NODE_ENV: 'production', CLERK_SECRET_KEY: 'sk_test' };
        const query = jest.fn(async (sql: string) => ({ rows: /deactivated_at IS NULL/.test(sql) ? [] : [{ id: 'tenant-1' }] }));
        jest.doMock('@clerk/backend', () => ({
            createClerkClient: jest.fn(() => ({})),
            verifyToken: jest.fn(async () => ({ sub: 'user_gone', org_id: 'org_gone' })),
        }));
        jest.doMock('../../lib/database', () => ({ query }));
        jest.doMock('../../lib/secrets', () => ({ getHmacSecret: () => 's', getApiKeySecret: () => 's' }));
        jest.doMock('../../core/compliance/AuditTrail', () => ({ AuditTrail: { log: jest.fn() } }));
        const { tenantContext } = await import('../tenant');
        const res: any = { status: jest.fn(() => res), json: jest.fn(() => res) };
        const next = jest.fn();
        await tenantContext({ path: '/api/leads', headers: { authorization: 'Bearer t' } } as any, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });
});
