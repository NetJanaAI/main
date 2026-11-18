// Runs the shipped policy SQL against a real Postgres (PGlite, in process).
import { PGlite } from '@electric-sql/pglite';
import { tenantRlsStatements, TenantTable } from '../db/rlsPolicies';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

const tables: TenantTable[] = [
    { table: 'scrape_results', column: 'organization_id', type: 'uuid' },
    { table: 'lead_cards', column: 'org_id', type: 'text' },
];

async function setup(force: boolean) {
    const pg = new PGlite();
    opened.push(pg);
    await pg.exec(`
        CREATE TABLE scrape_results (job_id INT PRIMARY KEY, organization_id UUID);
        CREATE TABLE lead_cards (lead_id INT PRIMARY KEY, org_id TEXT NOT NULL);
        INSERT INTO scrape_results VALUES (1, '${A}'), (2, '${B}');
        INSERT INTO lead_cards VALUES (1, '${A}'), (2, '${B}');
        CREATE ROLE app_rw NOLOGIN;
        CREATE ROLE tbl_owner NOLOGIN;
        ALTER TABLE scrape_results OWNER TO tbl_owner;
        ALTER TABLE lead_cards OWNER TO tbl_owner;
        GRANT SELECT, INSERT, UPDATE, DELETE ON scrape_results, lead_cards TO app_rw;
    `);
    for (const s of tenantRlsStatements({ force, tables })) await pg.exec(s);
    return pg;
}

// Mirrors queryWithOrg: tenant setting and statement share one transaction.
async function countAs(pg: PGlite, role: string, orgId: string | null, table: string) {
    await pg.exec('BEGIN');
    try {
        await pg.exec(`SET LOCAL ROLE ${role}`);
        if (orgId) await pg.query("SELECT set_config('app.current_organization_id', $1, true)", [orgId]);
        const r = await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
        return r.rows[0].n;
    } finally {
        await pg.exec('ROLLBACK');
    }
}

// Booting an in-process Postgres is slow when the machine is busy; the default 5s is not enough.
jest.setTimeout(60_000);

const opened: PGlite[] = [];
afterAll(async () => { await Promise.all(opened.map((p) => p.close())); });

describe('tenant RLS policy', () => {
    it("a second tenant's role reads zero of the first tenant's rows", async () => {
        const pg = await setup(true);
        expect(await countAs(pg, 'app_rw', A, 'scrape_results')).toBe(1);
        const onlyB = await (async () => {
            await pg.exec('BEGIN');
            await pg.exec('SET LOCAL ROLE app_rw');
            await pg.query("SELECT set_config('app.current_organization_id', $1, true)", [B]);
            const r = await pg.query<{ organization_id: string }>('SELECT organization_id FROM scrape_results');
            await pg.exec('ROLLBACK');
            return r.rows;
        })();
        expect(onlyB).toEqual([{ organization_id: B }]);
        expect(await countAs(pg, 'app_rw', B, 'lead_cards')).toBe(1);
    });

    it('a connection with no tenant context reads nothing', async () => {
        const pg = await setup(true);
        expect(await countAs(pg, 'app_rw', null, 'scrape_results')).toBe(0);
        expect(await countAs(pg, 'app_rw', null, 'lead_cards')).toBe(0);
    });

    it('cannot write a row for another tenant', async () => {
        const pg = await setup(true);
        await pg.exec('BEGIN');
        await pg.exec('SET LOCAL ROLE app_rw');
        await pg.query("SELECT set_config('app.current_organization_id', $1, true)", [A]);
        await expect(pg.query(`INSERT INTO lead_cards VALUES (9, '${B}')`)).rejects.toThrow(/row-level security/);
        await pg.exec('ROLLBACK');
    });

    it('FORCE binds the table owner; without it the owner sees every tenant', async () => {
        const forced = await setup(true);
        expect(await countAs(forced, 'tbl_owner', A, 'scrape_results')).toBe(1);
        expect(await countAs(forced, 'tbl_owner', null, 'scrape_results')).toBe(0);

        const unforced = await setup(false);
        expect(await countAs(unforced, 'tbl_owner', A, 'scrape_results')).toBe(2);
    });

    it('a superuser role bypasses RLS even with FORCE, so the app role must not be one', async () => {
        const pg = await setup(true);
        expect(await countAs(pg, 'postgres', A, 'scrape_results')).toBe(2);
    });

    it('is idempotent', async () => {
        const pg = await setup(true);
        for (const s of tenantRlsStatements({ force: true, tables })) await pg.exec(s);
        expect(await countAs(pg, 'app_rw', A, 'lead_cards')).toBe(1);
    });
});
