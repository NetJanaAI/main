// Advisory locks belong to one database session, so lock and unlock must run on the same connection.
const locks = new Map<number, string>();
let pooledTurn = 0;
let clientSeq = 0;

function run(connId: string, sql: string, params: any[] = []) {
    if (sql.includes('pg_try_advisory_lock')) {
        const holder = locks.get(params[0]);
        if (holder && holder !== connId) return { rows: [{ pg_try_advisory_lock: false }] };
        locks.set(params[0], connId);
        return { rows: [{ pg_try_advisory_lock: true }] };
    }
    if (sql.includes('pg_advisory_unlock')) {
        const ok = locks.get(params[0]) === connId;
        if (ok) locks.delete(params[0]);
        return { rows: [{ pg_advisory_unlock: ok }] };
    }
    if (sql.includes('FROM org_registry WHERE canonical_name')) return { rows: [{ org_id: 'ORG1' }] };
    return { rows: [] };
}

const release = jest.fn();
jest.mock('../../lib/database', () => ({
    // A pool hands each statement to whichever connection is free.
    query: async (sql: string, params?: any[]) => run(`pooled-${pooledTurn++ % 7}`, sql, params),
    pool: {
        connect: async () => {
            const id = `client-${clientSeq++}`;
            return { query: async (sql: string, params?: any[]) => run(id, sql, params), release };
        },
    },
}));
jest.mock('../../lib/cache', () => ({ cache: { get: jest.fn().mockResolvedValue(null), set: jest.fn() } }));
jest.mock('double-metaphone', () => ({ doubleMetaphone: (w: string) => [w.toUpperCase().slice(0, 4), ''] }));

import { resolveEntitySafe } from '../entity-resolver';

describe('entity resolver advisory lock', () => {
    it('releases the lock it took, so later resolutions are not left waiting', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        for (let i = 0; i < 3; i++) expect(await resolveEntitySafe('Acme Steel', 'MH')).toBe('ORG1');

        expect(locks.size).toBe(0);
        expect(warn).not.toHaveBeenCalled();
        expect(release).toHaveBeenCalledTimes(3);
        warn.mockRestore();
    });
});
