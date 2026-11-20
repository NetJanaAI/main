import { PGlite } from '@electric-sql/pglite';

const mockState: { pg?: PGlite } = {};

jest.mock('../../lib/database', () => ({
    db: {
        query: (text: string, params?: any[]) => mockState.pg!.query(text, params),
        queryWithOrg: async (text: string, params: any[], orgId?: string) => {
            if (!orgId) throw new Error('queryWithOrg called without orgId');
            const pg = mockState.pg!;
            await pg.exec('BEGIN');
            try {
                await pg.exec('SET LOCAL ROLE app_rw');
                await pg.query("SELECT set_config('app.current_organization_id', $1, true)", [orgId]);
                const res = await pg.query(text, params);
                await pg.exec('COMMIT');
                return res;
            } catch (err) {
                await pg.exec('ROLLBACK');
                throw err;
            }
        },
    },
}));

import { KnowledgeGraphService } from '../knowledge-graph';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

function signal(id: string, sector: string, state: string) {
    return {
        signal_id: id,
        source_id: 'gem',
        source_tier: 'TIER_2',
        collected_at: new Date().toISOString(),
        company_name_raw: 'Acme Steel',
        company_name_clean: 'Acme Steel',
        cin: null,
        geo_state: state,
        sector_inferred: sector,
        signal_strength_I0: 0.8,
        lambda: 0.1,
        raw_payload: {},
        pii_safe: true,
        geo_market: 'IN',
    } as any;
}

jest.setTimeout(60_000);

beforeAll(async () => {
    const pg = new PGlite();
    mockState.pg = pg;
    await pg.exec(`
        CREATE TABLE tenants (id UUID PRIMARY KEY);
        INSERT INTO tenants VALUES ('${A}'), ('${B}');
        CREATE TABLE graph_nodes (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            type TEXT NOT NULL, label TEXT NOT NULL, data JSONB,
            organization_id UUID REFERENCES tenants(id) DEFAULT '${A}',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(type, label, organization_id)
        );
        CREATE TABLE graph_edges (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            from_id UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
            to_id UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
            type TEXT NOT NULL, data JSONB,
            organization_id UUID REFERENCES tenants(id) DEFAULT '${A}',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(from_id, to_id, type, organization_id)
        );
        CREATE ROLE app_rw NOLOGIN;
        GRANT SELECT, INSERT, UPDATE, DELETE ON graph_nodes, graph_edges TO app_rw;
        ALTER TABLE graph_nodes ENABLE ROW LEVEL SECURITY;
        ALTER TABLE graph_edges ENABLE ROW LEVEL SECURITY;
        CREATE POLICY org_isolation_policy ON graph_nodes
            USING (current_setting('app.bypass_rls', true) = 'true' OR organization_id = current_setting('app.current_organization_id')::uuid);
        CREATE POLICY org_isolation_policy ON graph_edges
            USING (current_setting('app.bypass_rls', true) = 'true' OR organization_id = current_setting('app.current_organization_id')::uuid);
    `);
});

afterAll(async () => { await mockState.pg?.close(); });

describe('knowledge graph is kept per tenant', () => {
    beforeAll(async () => {
        await KnowledgeGraphService.syncSignal(signal('s-a', 'Steel', 'MH'), A);
        await KnowledgeGraphService.syncSignal(signal('s-b', 'Copper', 'GJ'), B);
    });

    it('stores each tenant\'s nodes under that tenant', async () => {
        const rows = (await mockState.pg!.query<{ label: string; organization_id: string }>(
            "SELECT label, organization_id FROM graph_nodes WHERE type IN ('SECTOR','GEOSTATE') ORDER BY label"
        )).rows;
        const byOrg = (id: string) => rows.filter((r) => r.organization_id === id).map((r) => r.label).sort();
        expect(byOrg(A)).toEqual(['MH', 'Steel']);
        expect(byOrg(B)).toEqual(['Copper', 'GJ']);
    });

    it('returns the graph context of the asking tenant only', async () => {
        const forA = await KnowledgeGraphService.getGraphContext('Acme Steel', A);
        expect(forA).toContain('Steel');
        expect(forA).toContain('MH');
        expect(forA).not.toContain('Copper');
        expect(forA).not.toContain('GJ');

        const forB = await KnowledgeGraphService.getGraphContext('Acme Steel', B);
        expect(forB).toContain('Copper');
        expect(forB).not.toContain('SECTORs: Steel');
        expect(forB).not.toContain('MH');
    });

    it('reports no relationships for a tenant that has none', async () => {
        const C = '33333333-3333-3333-3333-333333333333';
        await mockState.pg!.exec(`INSERT INTO tenants VALUES ('${C}')`);
        expect(await KnowledgeGraphService.getGraphContext('Acme Steel', C)).toBe('No prior graph relationships discovered.');
    });
});
