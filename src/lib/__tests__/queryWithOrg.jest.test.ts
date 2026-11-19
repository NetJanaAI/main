// The tenant setting must live in the same transaction as the statement it protects.
const calls: string[] = [];
const client = {
    query: jest.fn(async (sql: string) => { calls.push(sql.trim().split(/\s+/)[0].toUpperCase() + ':' + sql.trim()); return { rows: [] }; }),
    release: jest.fn(),
};

jest.mock('pg', () => ({ Pool: jest.fn(() => ({ connect: async () => client, on: jest.fn(), query: jest.fn() })) }));

process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db';
const database = require('../database');

beforeEach(() => { calls.length = 0; client.query.mockClear(); client.release.mockClear(); });

describe('queryWithOrg', () => {
    it('sets the tenant inside BEGIN..COMMIT on one client', async () => {
        await database.queryWithOrg('SELECT 1 FROM lead_cards', [], 'org-a');
        expect(calls.map((c) => c.split(':')[0])).toEqual(['BEGIN', 'SELECT', 'SELECT', 'COMMIT']);
        expect(calls[1]).toContain("app.current_organization_id");
        expect(calls[2]).toContain('lead_cards');
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    it('rolls back and releases when the statement fails', async () => {
        client.query.mockImplementation(async (sql: string) => {
            calls.push(sql.trim().split(/\s+/)[0].toUpperCase());
            if (sql.includes('boom')) throw new Error('boom');
            return { rows: [] };
        });
        await expect(database.queryWithOrg('SELECT boom', [], 'org-a')).rejects.toThrow('boom');
        expect(calls).toContain('ROLLBACK');
        expect(calls).not.toContain('COMMIT');
        expect(client.release).toHaveBeenCalledTimes(1);
    });
});

describe('queryAsSystem', () => {
    it('sets the bypass inside BEGIN..COMMIT on one client', async () => {
        client.query.mockImplementation(async (sql: string) => { calls.push(sql.trim().split(/\s+/)[0].toUpperCase() + ':' + sql.trim()); return { rows: [] }; });
        await database.queryAsSystem('SELECT 1', []);
        expect(calls.map((c) => c.split(':')[0])).toEqual(['BEGIN', 'SELECT', 'SELECT', 'COMMIT']);
        expect(calls[1]).toContain('app.bypass_rls');
    });
});
