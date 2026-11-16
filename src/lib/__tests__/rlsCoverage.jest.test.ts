// A table that stores tenant data but has no RLS policy is readable across tenants.
// This reads every CREATE TABLE in the codebase and fails when one is left out of TENANT_TABLES.
import fs from 'fs';
import path from 'path';
import { TENANT_TABLES } from '../db/rlsPolicies';

const root = path.join(__dirname, '..', '..');
const ddlFiles = [
    path.join(root, 'lib', 'database.ts'),
    path.join(root, 'lib', 'DeadLetterQueue.ts'),
    ...fs.readdirSync(path.join(root, 'lib', 'db', 'migrations'))
        .filter((f) => f.endsWith('.sql'))
        .map((f) => path.join(root, 'lib', 'db', 'migrations', f)),
];

// org_id in org_registry is the canonical company id, not a tenant column: it is shared reference data.
const SHARED_TABLES = new Set(['org_registry']);

interface Ddl { table: string; columns: string[]; likeOf?: string }

function parseTables(): Ddl[] {
    const tables: Ddl[] = [];
    for (const file of ddlFiles) {
        const sql = fs.readFileSync(file, 'utf8');
        const re = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(sql))) {
            let depth = 1;
            let i = re.lastIndex;
            while (depth > 0 && i < sql.length) {
                if (sql[i] === '(') depth++;
                else if (sql[i] === ')') depth--;
                i++;
            }
            const body = sql.slice(re.lastIndex, i - 1);
            tables.push({
                table: m[1],
                columns: [...body.matchAll(/^\s*(\w+)\s+[A-Za-z]/gm)].map((c) => c[1]),
                likeOf: body.match(/LIKE\s+(\w+)/)?.[1],
            });
        }
    }
    return tables;
}

const ddl = parseTables();
const tenantByName = new Map(TENANT_TABLES.map((t) => [t.table, t]));

describe('RLS coverage', () => {
    it('finds the tables (guards against the parser silently matching nothing)', () => {
        expect(ddl.length).toBeGreaterThan(30);
    });

    it('every table with organization_id or org_id has a tenant policy', () => {
        const tenantOwned = (t: Ddl) =>
            t.columns.some((c) => c === 'organization_id' || c === 'org_id') ||
            (t.likeOf !== undefined && tenantByName.has(t.likeOf));
        const missing = ddl
            .filter((t) => !SHARED_TABLES.has(t.table) && tenantOwned(t) && !tenantByName.has(t.table))
            .map((t) => t.table);
        expect([...new Set(missing)]).toEqual([]);
    });

    it('the policy column matches the column the table really has', () => {
        const wrong = TENANT_TABLES.filter((t) => {
            const defs = ddl.filter((d) => d.table === t.table);
            return defs.length > 0 && !defs.some((d) => d.columns.includes(t.column) || d.likeOf !== undefined);
        }).map((t) => `${t.table}.${t.column}`);
        expect(wrong).toEqual([]);
    });

    it('lists no table that is never created', () => {
        const created = new Set(ddl.map((d) => d.table));
        expect(TENANT_TABLES.filter((t) => !created.has(t.table)).map((t) => t.table)).toEqual([]);
    });
});
