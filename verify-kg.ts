import { db } from './src/lib/database';
import { KnowledgeGraphService } from './src/core/knowledge-graph';
import { RawSignal } from './src/lib/schemas';
import { v4 as uuidv4 } from 'uuid';

async function verifyKnowledgeGraph() {
    console.log("🚀 Starting Knowledge Graph Verification...");

    // 1. Mock a signal
    const mockOrgId = uuidv4();
    const signal: RawSignal = {
        signal_id: uuidv4(),
        source_id: 'mca',
        source_tier: 'TIER_2',
        collected_at: new Date().toISOString(),
        company_name_raw: 'GRAPH_TEST_CORP',
        company_name_clean: 'GRAPH_TEST_CORP',
        geo_state: 'MAHARASHTRA',
        sector_inferred: 'Energy',
        signal_strength_I0: 0.9,
        lambda: 0.1,
        raw_payload: {
            directors: ['John Doe', 'Jane Smith']
        },
        pii_safe: true
    };

    console.log("[+] Syncing Signal...");
    await KnowledgeGraphService.syncSignal(signal, mockOrgId);

    // 2. Fetch Context
    console.log("[+] Fetching Graph Context...");
    const context = await KnowledgeGraphService.getGraphContext('GRAPH_TEST_CORP');
    console.log("Context Result:", context);

    // 3. Verify in DB
    const nodes = await db.query("SELECT type, label FROM graph_nodes WHERE label IN ('GRAPH_TEST_CORP', 'Energy', 'MAHARASHTRA', 'mca', 'John Doe', 'Jane Smith')");
    console.log("Created Nodes:", nodes.rows);

    const edges = await db.query("SELECT type FROM graph_edges");
    console.log("Created Edges Count:", edges.rowCount);

    if (nodes.rowCount >= 6 && edges.rowCount >= 5) {
        console.log("✅ Knowledge Graph Verification PASSED!");
    } else {
        console.warn("⚠️ Knowledge Graph Verification partial results. Check DB logs.");
    }
}

verifyKnowledgeGraph().catch(console.error);
