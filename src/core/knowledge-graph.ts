import { db } from '../lib/database';
import { RawSignal } from '../lib/schemas';

export class KnowledgeGraphService {
    /**
     * Syncs a single signal into the knowledge graph structure.
     * Creates nodes for ORG, SECTOR, GEOSTATE, SOURCE, and optionally DIRECTORs.
     * Creates edges connecting ORG to these entities.
     */
    static async syncSignal(signal: RawSignal, org_id: string): Promise<void> {
        try {
            // 1. Upsert ORG node
            const orgNodeId = await this.upsertNode('ORG', signal.company_name_clean, { cin: signal.cin });

            // 2. Upsert SECTOR node
            const sectorNodeId = await this.upsertNode('SECTOR', signal.sector_inferred);
            await this.upsertEdge(orgNodeId, sectorNodeId, 'OPERATES_IN');

            // 3. Upsert GEOSTATE node
            const stateNodeId = await this.upsertNode('GEOSTATE', signal.geo_state);
            await this.upsertEdge(orgNodeId, stateNodeId, 'LOCATED_IN');

            // 4. Upsert SOURCE node
            const sourceNodeId = await this.upsertNode('SOURCE', signal.source_id);
            await this.upsertEdge(orgNodeId, sourceNodeId, 'TRIGGERED_BY', { signal_id: signal.signal_id, tier: signal.source_tier });

            // 5. Special: If MCA signal contains directors
            if (signal.source_id === 'mca' && signal.raw_payload.directors) {
                const directors = signal.raw_payload.directors as string[];
                for (const directorName of directors) {
                    const directorNodeId = await this.upsertNode('DIRECTOR', directorName);
                    await this.upsertEdge(directorNodeId, orgNodeId, 'DIRECTOR_OF');
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
    static async getGraphContext(org_name: string): Promise<string> {
        try {
            const query = `
                WITH RECURSIVE graph_context AS (
                    -- Start with the Org node
                    SELECT id, type, label, 0 as depth
                    FROM graph_nodes
                    WHERE type = 'ORG' AND label = $1
                    
                    UNION ALL
                    
                    -- Find neighbors
                    SELECT n.id, n.type, n.label, gc.depth + 1
                    FROM graph_nodes n
                    JOIN graph_edges e ON (e.from_id = gc.id AND e.to_id = n.id) OR (e.to_id = gc.id AND e.from_id = n.id)
                    JOIN graph_context gc ON gc.id != n.id
                    WHERE gc.depth < 2
                )
                SELECT DISTINCT type, label FROM graph_context WHERE depth > 0;
            `;

            const res = await db.query(query, [org_name]);
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

    private static async upsertNode(type: string, label: string, data: any = {}): Promise<string> {
        const query = `
            INSERT INTO graph_nodes (type, label, data)
            VALUES ($1, $2, $3)
            ON CONFLICT (type, label, organization_id) 
            DO UPDATE SET data = graph_nodes.data || EXCLUDED.data, created_at = NOW()
            RETURNING id;
        `;
        const res = await db.query(query, [type, label, JSON.stringify(data)]);
        return res.rows[0].id;
    }

    private static async upsertEdge(from_id: string, to_id: string, type: string, data: any = {}): Promise<void> {
        const query = `
            INSERT INTO graph_edges (from_id, to_id, type, data)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (from_id, to_id, type, organization_id)
            DO UPDATE SET data = graph_edges.data || EXCLUDED.data, created_at = NOW();
        `;
        await db.query(query, [from_id, to_id, type, JSON.stringify(data)]);
    }
}
