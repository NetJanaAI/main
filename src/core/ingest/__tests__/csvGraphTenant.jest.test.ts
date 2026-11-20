const TENANT = '11111111-1111-1111-1111-111111111111';

const queryWithOrg = jest.fn(async (sql: string) => (sql.includes('INSERT INTO graph_') ? { rows: [{ id: 'n1' }] } : { rows: [] }));
const query = jest.fn(async (sql: string) => {
    if (sql.includes('SELECT entity_id FROM canonical_entity_cache')) return { rows: [{ entity_id: 'E1' }] };
    return { rows: [] };
});

jest.mock('../../../lib/database', () => ({
    query: (...a: any[]) => (query as any)(...a),
    queryWithOrg: (...a: any[]) => (queryWithOrg as any)(...a),
}));

import { CsvIngestionService } from '../csv-ingestion-service';

describe('CSV employee import keeps its graph inside the importing tenant', () => {
    it('writes graph nodes and edges under the tenant, never a default tenant', async () => {
        const csv = 'Employee Name,Designation,Company Name\n"Asha Rao","CEO","Acme Steel"';
        const report = await CsvIngestionService.ingestCsv(csv, {
            type: 'employee',
            orgId: TENANT,
            mapping: { 'Employee Name': 'name', Designation: 'designation', 'Company Name': 'companyName' },
        });
        expect(report.errors ?? []).toEqual([]);

        const graphCalls = queryWithOrg.mock.calls.filter((c: any[]) => String(c[0]).includes('INSERT INTO graph_'));
        expect(graphCalls.length).toBeGreaterThanOrEqual(3);
        for (const c of graphCalls as any[][]) {
            expect(c[2]).toBe(TENANT);
            expect(c[0]).not.toContain('Default Organization');
        }
        const viaQuery = query.mock.calls.filter((c: any[]) => String(c[0]).includes('INSERT INTO graph_'));
        expect(viaQuery).toHaveLength(0);
    });
});
