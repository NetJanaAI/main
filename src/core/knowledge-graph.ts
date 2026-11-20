import { db } from '../lib/database';
import { RawSignal } from '../lib/schemas';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class KnowledgeGraphService {
    /**
     * Syncs a single signal into the knowledge graph structure.
     * Creates nodes for ORG, SECTOR, GEOSTATE, SOURCE, and optionally DIRECTORs.
     * Creates edges connecting ORG to these entities.
     */
    static async syncSignal(signal: RawSignal, tenantId: string): Promise<void> {
        try {
            // 1. Upsert ORG node
            const orgNodeId = await this.upsertNode(tenantId, 'ORG', signal.company_name_clean, { cin: signal.cin });

            // 2. Upsert SECTOR node
            const sectorNodeId = await this.upsertNode(tenantId, 'SECTOR', signal.sector_inferred);
            await this.upsertEdge(tenantId, orgNodeId, sectorNodeId, 'OPERATES_IN');

            // 3. Upsert GEOSTATE node
            const stateNodeId = await this.upsertNode(tenantId, 'GEOSTATE', signal.geo_state);
            await this.upsertEdge(tenantId, orgNodeId, stateNodeId, 'LOCATED_IN');

            // 4. Upsert SOURCE node
            const sourceNodeId = await this.upsertNode(tenantId, 'SOURCE', signal.source_id);
            await this.upsertEdge(tenantId, orgNodeId, sourceNodeId, 'TRIGGERED_BY', { signal_id: signal.signal_id, tier: signal.source_tier });

            // 5. Special: If MCA signal contains directors
            if (signal.source_id === 'mca' && signal.raw_payload.directors) {
                const directors = signal.raw_payload.directors as string[];
                for (const directorName of directors) {
                    const directorNodeId = await this.upsertNode(tenantId, 'DIRECTOR', directorName);
                    await this.upsertEdge(tenantId, directorNodeId, orgNodeId, 'DIRECTOR_OF');
                }
            }
        } catch (error: any) {
            console.error(`[KnowledgeGraph] Sync failed for signal ${signal.signal_id}:`, error.message);
        }
    }

    /**
     * Fetches a summarized context of the graph around an organization.
     * Uses a recursive CTE to find related entities (depth 1 or 2).
     */
    static async getGraphContext(org_name: string, tenantId: string): Promise<string> {
        if (!UUID_PATTERN.test(tenantId)) return "No prior graph relationships discovered.";
        try {
            const query = `
                WITH RECURSIVE graph_context AS (
                    -- Start with the Org node
                    SELECT id, type, label, 0 as depth
                    FROM graph_nodes
                    WHERE type = 'ORG' AND label = $1 AND organization_id = $2::uuid
                    
                    UNION ALL
                    
                    -- Find neighbors
                    SELECT n.id, n.type, n.label, gc.depth + 1
                    FROM graph_context gc
                    JOIN graph_edges e ON (e.from_id = gc.id OR e.to_id = gc.id) AND e.organization_id = $2::uuid
                    JOIN graph_nodes n ON n.id = CASE WHEN e.from_id = gc.id THEN e.to_id ELSE e.from_id END
                    WHERE gc.depth < 2 AND n.organization_id = $2::uuid
                )
                SELECT DISTINCT type, label FROM graph_context WHERE depth > 0;
            `;

            const res = await db.queryWithOrg(query, [org_name, tenantId], tenantId);
            if (res.rows.length === 0) return "No prior graph relationships discovered.";

            const groupByType: Record<string, string[]> = {};
            res.rows.forEach(row => {
                groupByType[row.type] = groupByType[row.type] || [];
                if (!groupByType[row.type].includes(row.label)) {
                    groupByType[row.type].push(row.label);
                }
            });

            return Object.entries(groupByType)
                .map(([type, labels]) => `${type}s: ${labels.join(', ')}`)
                .join('; ');
        } catch (error: any) {
            console.error(`[KnowledgeGraph] Context fetch failed:`, error.message);
            return "Knowledge Graph context unavailable due to query error.";
        }
    }

    private static async upsertNode(tenantId: string, type: string, label: string, data: any = {}): Promise<string> {
        const query = `
            INSERT INTO graph_nodes (type, label, data, organization_id)
            VALUES ($1, $2, $3, $4::uuid)
            ON CONFLICT (type, label, organization_id) 
            DO UPDATE SET data = graph_nodes.data || EXCLUDED.data, created_at = NOW()
            RETURNING id;
        `;
        const res = await db.queryWithOrg(query, [type, label, JSON.stringify(data), tenantId], tenantId);
        return res.rows[0].id;
    }

    private static async upsertEdge(tenantId: string, from_id: string, to_id: string, type: string, data: any = {}): Promise<void> {
        const query = `
            INSERT INTO graph_edges (from_id, to_id, type, data, organization_id)
            VALUES ($1, $2, $3, $4, $5::uuid)
            ON CONFLICT (from_id, to_id, type, organization_id)
            DO UPDATE SET data = graph_edges.data || EXCLUDED.data, created_at = NOW();
        `;
        await db.queryWithOrg(query, [from_id, to_id, type, JSON.stringify(data), tenantId], tenantId);
    }
}
