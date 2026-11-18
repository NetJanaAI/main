// A deactivated tenant must not authenticate. Every lookup that resolves a tenant from a credential
// (API key hash or Clerk id) has to filter on deactivated_at, so a new lookup cannot silently skip it.
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '..', '..');
const CREDENTIAL_LOOKUP = /FROM tenants WHERE (api_key_hash|clerk_org_id|clerk_user_id)\b[^'"`]*/g;

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
        return entry.name.endsWith('.ts') ? [full] : [];
    });
}

describe('tenant credential lookups', () => {
    const found: Array<{ file: string; sql: string }> = [];
    for (const file of sourceFiles(SRC)) {
        const text = fs.readFileSync(file, 'utf-8');
        for (const match of text.matchAll(CREDENTIAL_LOOKUP)) {
            found.push({ file: path.relative(SRC, file).split(path.sep).join('/'), sql: match[0] });
        }
    }

    it('finds the lookups it is meant to guard', () => {
        const files = new Set(found.map((f) => f.file));
        for (const expected of ['middleware/tenant.ts', 'middleware/socketAuth.ts', 'middleware/ingestAuth.ts', 'routes/netjana-intel.ts']) {
            expect(files.has(expected)).toBe(true);
        }
    });

    it.each(found.map((f) => [f.file, f.sql]))('%s filters on deactivated_at: %s', (_file, sql) => {
        expect(sql).toMatch(/deactivated_at IS NULL/);
    });
});
