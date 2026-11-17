export {};
// Runs the real initDb DDL in PGlite, seeds two tenants in every tenant table, purges one,
// and checks the other is untouched. A table added to initDb without being purged fails here.
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import os from 'os';
import path from 'path';

jest.setTimeout(120000);

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const DEFAULT_ORG = '00000000-0000-0000-0000-000000000000';

let pg: PGlite;
const clientCalls: string[] = [];
const deleteKeysMatching = jest.fn(async (_pattern: string) => 0);

jest.mock('../../../lib/database', () => ({
    pool: {
        connect: async () => ({
            query: async (sql: string, params?: any[]) => { clientCalls.push(sql); return pg.query(sql, params); },
            release: () => undefined,
        }),
    },
    db: { query: jest.fn() },
}));
jest.mock('../TenantRAGStore', () => ({ TenantRAGStore: class { clearStore = async () => undefined; } }));
jest.mock('../../compliance/AuditTrail', () => ({ AuditTrail: { log: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('../../../lib/cache', () => ({ deleteKeysMatching }));

import { VanishProtocol } from '../VanishProtocol';
import { TENANT_TABLES } from '../../../lib/db/rlsPolicies';

const RETAINED = ['audit_logs', 'rag_audit_log'];
const purgeable = TENANT_TABLES.filter((t) => !RETAINED.includes(t.table));
const ddlSource = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'lib', 'database.ts'), 'utf8');

function schemaStatements(): string[] {
    const creates = [...ddlSource.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\s*\);/g)]
        .map((m) => m[0].replace(/\$\{defaultOrgId\}/g, DEFAULT_ORG));
    const tenantAlters = [...ddlSource.matchAll(/"(ALTER TABLE tenants ADD COLUMN IF NOT EXISTS [^"]+)"/g)].map((m) => m[1]);
    const [tenants, ...rest] = creates;
    return [tenants, ...tenantAlters, ...rest];
}

async function fkParents(table: string) {
    const r = await pg.query<{ col: string; parent: string; parentcol: string }>(`
        SELECT a.attname AS col, cf.relname AS parent, af.attname AS parentcol
        FROM pg_constraint c
        JOIN pg_class cl ON cl.oid = c.conrelid
        JOIN pg_class cf ON cf.oid = c.confrelid
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1]
        WHERE c.contype = 'f' AND cl.relname = $1`, [table]);
    return r.rows;
}

let counter = 0;
async function seedRow(table: string, tenantColumn: string, org: string) {
    const cols = await pg.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
        `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1`, [table]);
    const fks = await fkParents(table);
    const names: string[] = [];
    const values: any[] = [];
    for (const c of cols.rows) {
        const fk = fks.find((f) => f.col === c.column_name);
        const required = c.is_nullable === 'NO' && c.column_default === null;
        if (c.column_name !== tenantColumn && !fk && !required) continue;
        let value: any;
        if (c.column_name === tenantColumn) value = org;
        else if (fk && fk.parent === 'tenants') value = org;
        else if (fk) {
            const parentTable = TENANT_TABLES.find((t) => t.table === fk.parent)!;
            const found = await pg.query(`SELECT ${fk.parentcol} AS v FROM ${fk.parent} WHERE ${parentTable.column} = $1 LIMIT 1`, [org]);
            value = (found.rows[0] as any)?.v;
        } else if (/char|text/.test(c.data_type)) {
            const checks = await pg.query<{ def: string }>(
                `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'c'`, [table]);
            const allowed = checks.rows.map((r) => r.def).find((d) => d.includes(c.column_name))?.match(/'([^']+)'/);
            value = allowed ? allowed[1] : `x${++counter}`;
        }
        else if (/int|numeric|double|real/.test(c.data_type)) value = 1;
        else if (c.data_type === 'uuid') value = crypto.randomUUID();
        else if (c.data_type === 'boolean') value = true;
        else if (/json/.test(c.data_type)) value = '{}';
        else if (/timestamp|date/.test(c.data_type)) value = new Date().toISOString();
        else if (c.data_type === 'ARRAY') value = '{}';
        else throw new Error(`seed: no value for ${table}.${c.column_name} (${c.data_type})`);
        names.push(c.column_name);
        values.push(value);
    }
    await pg.query(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${values.map((_, i) => `$${i + 1}`).join(', ')})`, values);
}

async function countFor(table: string, column: string, org: string) {
    const r = await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`, [org]);
    return r.rows[0].n;
}

let shots: string;
let outside: string;

beforeAll(async () => {
    pg = new PGlite();
    for (const stmt of schemaStatements()) await pg.exec(stmt);
    await pg.query(`INSERT INTO tenants (id, name) VALUES ($1, 'Default Organization')`, [DEFAULT_ORG]);
    for (const [org, tag] of [[A, 'a'], [B, 'b']]) {
        await pg.query(
            `INSERT INTO tenants (id, name, display_name, clerk_user_id, clerk_org_id, api_key_hash, razorpay_subscription_id)
             VALUES ($1, $2, $2, $3, $4, 'hash', 'sub_' || $2)`,
            [org, `tenant-${tag}`, `user_${tag}`, `org_${tag}`]);
    }
    // Parents first: seed in the order initDb creates the tables.
    const created = [...ddlSource.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
    const seedOrder = [...TENANT_TABLES].sort((x, y) => created.indexOf(x.table) - created.indexOf(y.table));
    for (const t of seedOrder) {
        for (const org of [A, B]) await seedRow(t.table, t.column, org);
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanish-'));
    shots = path.join(root, 'data', 'screenshots');
    fs.mkdirSync(shots, { recursive: true });
    outside = path.join(root, 'outside.txt');
    fs.writeFileSync(outside, 'keep');
    for (const f of ['a_shot.png', 'b_shot.png', 'a_archived.png']) fs.writeFileSync(path.join(shots, f), 'png');
    await pg.query(`UPDATE scrape_results SET screenshot_path = '/screenshots/a_shot.png' WHERE organization_id = $1`, [A]);
    await pg.query(`UPDATE scrape_results SET screenshot_path = '/screenshots/b_shot.png' WHERE organization_id = $1`, [B]);
    await pg.query(`UPDATE archived_scrape_results SET screenshot_path = '/screenshots/a_archived.png' WHERE organization_id = $1`, [A]);
    await pg.query(
        `INSERT INTO scrape_results (job_id, domain, friction_score, organization_id, screenshot_path)
         VALUES (gen_random_uuid(), 'trav', 1, $1, '/screenshots/../outside.txt')`, [A]);
    jest.spyOn(process, 'cwd').mockReturnValue(root);
});

afterAll(async () => { jest.restoreAllMocks(); await pg.close(); });

describe('VanishProtocol.purge', () => {
    it('rolls back everything when any delete fails', async () => {
        await pg.exec('ALTER TABLE lead_cards RENAME TO lead_cards_moved');
        await expect(VanishProtocol.purge(A)).rejects.toThrow();
        await pg.exec('ALTER TABLE lead_cards_moved RENAME TO lead_cards');
        for (const t of purgeable) expect(await countFor(t.table, t.column, A)).toBeGreaterThan(0);
        expect(deleteKeysMatching).not.toHaveBeenCalled();
        expect(fs.existsSync(path.join(shots, 'a_shot.png'))).toBe(true);
    });

    describe('after a purge of tenant A', () => {
        const before: Record<string, number> = {};
        let purgeResult: any;
        let redisPatterns: string[];

        beforeAll(async () => {
            for (const t of TENANT_TABLES) before[t.table] = await countFor(t.table, t.column, B);
            clientCalls.length = 0;
            purgeResult = await VanishProtocol.purge(A);
            redisPatterns = deleteKeysMatching.mock.calls.map(([p]) => p);
        });

        it('succeeds', () => expect(purgeResult).toEqual({ status: 'success', deleted: true }));

        it('covers every tenant table: the purge list is generated from the schema inventory', () => {
            const covered = new Set([...VanishProtocol.PURGED_TABLES.map((t) => t.table), ...RETAINED]);
            expect(covered).toEqual(new Set(TENANT_TABLES.map((t) => t.table)));
        });

        it.each(purgeable.map((t) => [t.table, t.column]))('%s has zero rows for the purged tenant', async (table, column) => {
            expect(await countFor(table, column, A)).toBe(0);
        });

        it.each(TENANT_TABLES.map((t) => [t.table, t.column]))('%s still has the other tenant\'s rows', async (table, column) => {
            expect(before[table]).toBeGreaterThan(0);
            expect(await countFor(table, column, B)).toBe(before[table]);
        });

        it('keeps the tamper-evident audit trail, which is the proof the erasure happened', async () => {
            for (const table of RETAINED) {
                const col = TENANT_TABLES.find((t) => t.table === table)!.column;
                expect(await countFor(table, col, A)).toBeGreaterThan(0);
            }
        });

        it('turns the tenants row into an anonymous tombstone and leaves other tenants alone', async () => {
            const a = (await pg.query<any>('SELECT * FROM tenants WHERE id = $1', [A])).rows[0];
            expect(a.name).toBe(`purged-${A}`);
            expect([a.display_name, a.clerk_user_id, a.clerk_org_id, a.api_key_hash, a.razorpay_subscription_id]).toEqual([null, null, null, null, null]);
            expect(a.deactivated_at).not.toBeNull();
            expect(a.purged_at).not.toBeNull();
            const b = (await pg.query<any>('SELECT * FROM tenants WHERE id = $1', [B])).rows[0];
            expect([b.name, b.clerk_org_id, b.api_key_hash]).toEqual(['tenant-b', 'org_b', 'hash']);
            expect(b.purged_at).toBeNull();
        });

        it('does everything on one connection, in one transaction, with the RLS bypass set inside it', () => {
            const begin = clientCalls.findIndex((s) => /^BEGIN/i.test(s.trim()));
            const bypass = clientCalls.findIndex((s) => /app\.bypass_rls/.test(s));
            const commit = clientCalls.findIndex((s) => /^COMMIT/i.test(s.trim()));
            expect(begin).toBe(0);
            expect(bypass).toBeGreaterThan(begin);
            expect(commit).toBe(clientCalls.length - 1);
        });

        it('deletes only the purged tenant\'s Redis keys', () => {
            const patterns = redisPatterns;
            expect(patterns).toEqual(expect.arrayContaining([
                `org:${A}:*`, `sources:${A}`, `usage:${A}:*`, `outreach:${A}:*`, `gemini_calls:${A}:*`,
            ]));
            expect(patterns.every((p) => p.includes(A) && !p.includes(B))).toBe(true);
        });

        it('deletes the purged tenant\'s screenshot files, not the other tenant\'s, and never follows a path out of the folder', () => {
            expect(fs.existsSync(path.join(shots, 'a_shot.png'))).toBe(false);
            expect(fs.existsSync(path.join(shots, 'a_archived.png'))).toBe(false);
            expect(fs.existsSync(path.join(shots, 'b_shot.png'))).toBe(true);
            expect(fs.existsSync(outside)).toBe(true);
        });
    });
});
