// Runs the store's SQL against real Postgres (PGlite) under the shipped tenant policy:
// tenant A must not read, count, or change tenant B's observations.
import { PGlite } from '@electric-sql/pglite';
import { tenantRlsStatements, TENANT_TABLES } from '../../../lib/db/rlsPolicies';

const A = '11111111-1111-1111-1111-111111111111';
const B = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

let pg: PGlite;

async function asTenant<T>(orgId: string, fn: (run: (sql: string, params?: any[]) => Promise<any>) => Promise<T>): Promise<T> {
    await pg.exec('BEGIN');
    try {
        await pg.exec('SET LOCAL ROLE app_rw');
        await pg.query("SELECT set_config('app.current_organization_id', $1, true)", [orgId]);
        const out = await fn((sql, params) => pg.query(sql, params));
        await pg.exec('COMMIT');
        return out;
    } catch (e) {
        await pg.exec('ROLLBACK');
        throw e;
    }
}

jest.mock('../../../lib/database', () => ({
    queryWithOrg: (sql: string, params: any[], orgId: string) => asTenant(orgId, (run) => run(sql, params)),
    withOrgTransaction: (orgId: string, fn: (client: any) => Promise<void>) =>
        asTenant(orgId, (run) => fn({ query: run })),
}));

import { cohort, getConfirmed, observedCounts, saveObservations, setConfirmed, signalsForDomains } from '../store';

beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(`
        CREATE TABLE signal_observation (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL, company_domain TEXT NOT NULL, signal_key TEXT NOT NULL,
            value JSONB NOT NULL, evidence_url TEXT,
            observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE signal_confirmations (
            organization_id UUID NOT NULL, signal_key TEXT NOT NULL,
            confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (organization_id, signal_key)
        );
        CREATE ROLE app_rw NOLOGIN;
        CREATE ROLE tbl_owner NOLOGIN;
        ALTER TABLE signal_observation OWNER TO tbl_owner;
        ALTER TABLE signal_confirmations OWNER TO tbl_owner;
        GRANT SELECT, INSERT, UPDATE, DELETE ON signal_observation, signal_confirmations TO app_rw;
    `);
    const tables = TENANT_TABLES.filter((t) => t.table === 'signal_observation' || t.table === 'signal_confirmations');
    expect(tables).toHaveLength(2);
    for (const s of tenantRlsStatements({ force: true, tables })) await pg.exec(s);
});
afterAll(() => pg.close());

const obs = (key: any, present: boolean, number?: number) => ({ key, value: { present, ...(number !== undefined ? { number } : {}) }, evidenceUrl: 'https://x.example/' });

describe('website signal store', () => {
    beforeAll(async () => {
        await setConfirmed(A, ['no_online_booking', 'running_ads', 'blog_stale']);
        await setConfirmed(B, ['no_online_booking']);

        await saveObservations(A, 'one.example', [obs('no_online_booking', true), obs('running_ads', true), obs('blog_stale', true, 30)]);
        await saveObservations(A, 'two.example', [obs('no_online_booking', true), obs('running_ads', false), obs('blog_stale', false, 2)]);
        await saveObservations(A, 'three.example', [obs('no_online_booking', false), obs('running_ads', true)]);
        await saveObservations(B, 'one.example', [obs('no_online_booking', true)]);
        await saveObservations(B, 'bees.example', [obs('no_online_booking', true)]);
    });

    it('keeps confirmations per tenant', async () => {
        expect(await getConfirmed(A)).toEqual(['blog_stale', 'no_online_booking', 'running_ads']);
        expect(await getConfirmed(B)).toEqual(['no_online_booking']);
    });

    it('replaces the confirmed set', async () => {
        await setConfirmed(B, ['no_online_booking', 'tech_stack']);
        expect(await getConfirmed(B)).toEqual(['no_online_booking', 'tech_stack']);
        await setConfirmed(B, ['no_online_booking']);
    });

    it('answers "has ads AND no online booking" with a live count', async () => {
        const r = await cohort(A, { mustHave: ['running_ads', 'no_online_booking'], mustNotHave: [], ranges: [] });
        expect(r).toEqual({ count: 1, domains: ['one.example'] });
    });

    it('must_not_have means checked and absent', async () => {
        const r = await cohort(A, { mustHave: ['no_online_booking'], mustNotHave: ['running_ads'], ranges: [] });
        expect(r.domains).toEqual(['two.example']);
    });

    it('filters on numeric ranges', async () => {
        expect((await cohort(A, { mustHave: [], mustNotHave: [], ranges: [{ key: 'blog_stale', min: 12 }] })).domains).toEqual(['one.example']);
        expect((await cohort(A, { mustHave: [], mustNotHave: [], ranges: [{ key: 'blog_stale', max: 12 }] })).domains).toEqual(['two.example']);
    });

    it('an empty filter lists every observed company of that tenant only', async () => {
        expect((await cohort(A, { mustHave: [], mustNotHave: [], ranges: [] })).domains).toEqual(['one.example', 'three.example', 'two.example']);
        expect((await cohort(B, { mustHave: [], mustNotHave: [], ranges: [] })).domains).toEqual(['bees.example', 'one.example']);
    });

    it("tenant A cannot see tenant B's observations, even for the same domain", async () => {
        const forA = await signalsForDomains(A, ['one.example', 'bees.example']);
        expect([...forA.keys()]).toEqual(['one.example']);
        expect(forA.get('one.example')!.map((s) => s.signal_key).sort()).toEqual(['blog_stale', 'no_online_booking', 'running_ads']);

        const forB = await signalsForDomains(B, ['one.example', 'bees.example', 'two.example']);
        expect([...forB.keys()].sort()).toEqual(['bees.example', 'one.example']);
        expect(forB.get('one.example')!.map((s) => s.signal_key)).toEqual(['no_online_booking']);
    });

    it('the pull only returns signals the tenant confirmed', async () => {
        await saveObservations(A, 'one.example', [obs('tech_stack', true, 1)]);
        const sigs = await signalsForDomains(A, ['one.example']);
        expect(sigs.get('one.example')!.map((s) => s.signal_key)).not.toContain('tech_stack');
    });

    it('does not count expired observations', async () => {
        await pg.exec(`UPDATE signal_observation SET expires_at = NOW() - interval '1 day' WHERE company_domain = 'three.example'`);
        expect((await cohort(A, { mustHave: [], mustNotHave: [], ranges: [] })).domains).not.toContain('three.example');
        expect((await observedCounts(A)).running_ads).toBe(2);
    });

    it('a connection with no tenant sees nothing', async () => {
        await pg.exec('BEGIN');
        await pg.exec('SET LOCAL ROLE app_rw');
        const r = await pg.query<{ n: number }>('SELECT count(*)::int AS n FROM signal_observation');
        await pg.exec('ROLLBACK');
        expect(r.rows[0].n).toBe(0);
    });
});
