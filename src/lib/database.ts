import { Pool } from 'pg';
import format from 'pg-format';

// Read database configuration from environment
const DATABASE_URL = process.env.DATABASE_URL;

let pool: Pool | null = null;

if (DATABASE_URL) {
    try {
        pool = new Pool({
            connectionString: DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            max: 20, // Limit concurrent connections to avoid saturating DB
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000, // Fail fast if DB is unreachable
        });

        pool.on('error', (err) => {
            console.error('[Database] Unexpected error on idle client', err);
        });

        console.log(`[Database] Initialized PostgreSQL connection pool.`);
    } catch (e: any) {
        console.warn(`[Database] Failed to initialize PostgreSQL pool: ${e.message}`);
    }
} else {
    console.warn('[Database] DATABASE_URL not provided. Postgres persistence is disabled.');
}

/**
 * Execute a parameterized query.
 */
export async function query(text: string, params?: any[]) {
    if (!pool) {
        throw new Error('Database is not initialized (DATABASE_URL missing).');
    }

    // Simple query execution
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;
        // console.log(`[Database] Executed query in ${duration}ms: ${text.substring(0, 100)}...`);
        return res;
    } catch (error: any) {
        console.error(`[Database] Query error:`, error.message);
        throw error;
    }
}

/**
 * Perform initial database setup/migration (idempotent).
 */
export async function initDb() {
    if (!pool) return;

    console.log('[Database] Running idempotency migration check...');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Tenants Table (Stage 9)
        await client.query(`
            CREATE TABLE IF NOT EXISTS tenants (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name TEXT NOT NULL UNIQUE,
                display_name TEXT,
                clerk_user_id TEXT UNIQUE,
                clerk_org_id TEXT UNIQUE,
                api_key_hash TEXT,
                quota_limit INT DEFAULT 100,
                plan TEXT DEFAULT 'free',
                tier TEXT DEFAULT 'free',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // Migration logic for existing tables
        try { await client.query("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS display_name TEXT"); } catch(e) {}
        try { await client.query("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS clerk_user_id TEXT UNIQUE"); } catch(e) {}
        try { await client.query("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS clerk_org_id TEXT UNIQUE"); } catch(e) {}
        try { await client.query("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free'"); } catch(e) {}
        try { await client.query("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'free'"); } catch(e) {}

        // 1.5 Data Source Credentials Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS data_source_credentials (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                organization_id UUID REFERENCES tenants(id),
                provider TEXT NOT NULL,
                credential_name TEXT NOT NULL,
                credential_value TEXT NOT NULL, -- Encrypted
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // Insert Default Tenant if none exists
        await client.query(`
            INSERT INTO tenants (name) VALUES ('Default Organization') ON CONFLICT (name) DO NOTHING;
        `);

        // Get the default organization ID to use as a default for other tables
        const defaultOrgRes = await client.query("SELECT id FROM tenants WHERE name = 'Default Organization' LIMIT 1");
        const defaultOrgId = defaultOrgRes.rows[0].id;

        // 1.4 Webhook Secrets & Allowed IPs
        await client.query(`
            CREATE TABLE IF NOT EXISTS webhook_secrets (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                organization_id UUID REFERENCES tenants(id),
                source TEXT NOT NULL,
                secret_hash TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS allowed_ips (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                organization_id UUID REFERENCES tenants(id),
                cidr TEXT NOT NULL,
                label TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // 1.5 Dead Letter Queue
        await client.query(`
            CREATE TABLE IF NOT EXISTS dead_letter_queue (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                url TEXT,
                error TEXT,
                raw_text TEXT,
                llm_response TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // 2. PII Vault Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS pii_vault (
                token TEXT PRIMARY KEY,
                original_value TEXT NOT NULL,
                pii_type TEXT NOT NULL,
                region_id TEXT NOT NULL,
                organization_id UUID REFERENCES tenants(id) DEFAULT '${defaultOrgId}',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // 3. Scrape Results Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS scrape_results (
                job_id UUID PRIMARY KEY,
                domain TEXT NOT NULL,
                friction_score INT NOT NULL,
                signals JSONB,
                geo_country TEXT,
                estimated_roi INT,
                compliance_verified BOOLEAN,
                critic_analysis JSONB,
                screenshot_path TEXT,
                spider_stats JSONB,
                organization_id UUID REFERENCES tenants(id) DEFAULT '${defaultOrgId}',
                timestamp TIMESTAMPTZ DEFAULT NOW(),
                
                -- Intent Decay Tracking (Phase 5)
                base_score DECIMAL(5,2) DEFAULT 0,
                signal_captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                freshness_score DECIMAL(5,2) DEFAULT 100,
                decay_status VARCHAR(10) DEFAULT 'Hot',
                last_decay_calc TIMESTAMPTZ,
                previous_decay_status VARCHAR(10),
                
                -- Influence & Alpha Scoring (Phase 6)
                influence_score DECIMAL(5,2) DEFAULT 0,
                influence_enriched_at TIMESTAMPTZ,
                alpha_score DECIMAL(5,2) DEFAULT 0
            );
        `);

        // Indices for decay tracking
        await client.query(`CREATE INDEX IF NOT EXISTS idx_leads_decay_status ON scrape_results (organization_id, decay_status);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_leads_freshness ON scrape_results (organization_id, freshness_score);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_leads_alpha ON scrape_results (organization_id, alpha_score);`);

        // Archive Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS archived_scrape_results (
                LIKE scrape_results INCLUDING ALL,
                archived_at TIMESTAMPTZ DEFAULT NOW(),
                archival_reason TEXT
            );
        `);

        // 4. Capsule Log Table (Stage 5) — no upstream deps beyond tenants
        await client.query(`
            CREATE TABLE IF NOT EXISTS capsule_log (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                job_id TEXT NOT NULL,
                domain TEXT NOT NULL,
                capsule JSONB NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                delivered_at TIMESTAMPTZ,
                organization_id UUID REFERENCES tenants(id) DEFAULT '${defaultOrgId}',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // 5. Scrape Schedules Table (Stage 6) — no upstream deps beyond tenants
        await client.query(`
            CREATE TABLE IF NOT EXISTS scrape_schedules (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                domain TEXT NOT NULL UNIQUE,
                cron_expression TEXT NOT NULL,
                use_online_ai BOOLEAN DEFAULT false,
                spider_mode BOOLEAN DEFAULT false,
                max_pages INT DEFAULT 5,
                organization_id UUID REFERENCES tenants(id) DEFAULT '${defaultOrgId}',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                last_run TIMESTAMPTZ
            );
        `);

        // 6. Campaigns Table (Stage 6) — must exist before roi_exports
        await client.query(`
            CREATE TABLE IF NOT EXISTS campaigns (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                domain TEXT NOT NULL UNIQUE,
                state TEXT NOT NULL DEFAULT 'DISCOVERED',
                capsule_id TEXT,
                notes TEXT,
                organization_id UUID REFERENCES tenants(id) DEFAULT '${defaultOrgId}',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // 7. Lead Influence Data Table (Phase 6) — requires scrape_results
        await client.query(`
            CREATE TABLE IF NOT EXISTS lead_influence_data (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                lead_id UUID NOT NULL REFERENCES scrape_results(job_id) ON DELETE CASCADE,
                organization_id UUID NOT NULL,
                influence_map JSONB NOT NULL,
                enriched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_influence_lead ON lead_influence_data (lead_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_influence_org ON lead_influence_data (organization_id);`);

        // 8. ROI Exports Table (Phase 7) — requires campaigns
        await client.query(`
            CREATE TABLE IF NOT EXISTS roi_exports (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
                organization_id UUID NOT NULL,
                generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                hmac_hash TEXT NOT NULL,
                is_redacted BOOLEAN DEFAULT false
            );
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_roi_campaign ON roi_exports (campaign_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_roi_org ON roi_exports (organization_id);`);

        // 9. Organization Seats Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS organization_seats (
                id TEXT PRIMARY KEY,
                organization_id UUID NOT NULL REFERENCES tenants(id),
                email TEXT NOT NULL,
                name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(organization_id, email)
            );
        `);
        await client.query(`ALTER TABLE organization_seats ENABLE ROW LEVEL SECURITY;`);

        // 10. Audit Logs Table (SOC2 Compliance)
        await client.query(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id UUID PRIMARY KEY,
                actor_id TEXT NOT NULL,
                organization_id UUID NOT NULL REFERENCES tenants(id),
                action TEXT NOT NULL,
                resource TEXT NOT NULL,
                metadata JSONB,
                signature TEXT NOT NULL,
                timestamp TIMESTAMPTZ NOT NULL
            );
        `);
        await client.query(`ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;`);

        // 11. Lead Cards Table (Step 5)
        await client.query(`
            CREATE TABLE IF NOT EXISTS lead_cards (
                lead_id UUID PRIMARY KEY,
                org_id TEXT NOT NULL, -- Changed to TEXT to support resolveEntitySafe logic
                company_name TEXT NOT NULL,
                geo_state TEXT NOT NULL,
                sector TEXT,
                source_id TEXT NOT NULL,
                source_tier TEXT NOT NULL,
                verity_tier TEXT NOT NULL,
                buying_stage TEXT,
                procurement_category TEXT,
                procurement_timeline TEXT,
                intent_score INT NOT NULL,
                decay_score DECIMAL(5,2) NOT NULL,
                -- Audit remediation: triangulation + decay lifecycle columns
                is_triangulated BOOLEAN DEFAULT false,
                triangulated_sources JSONB,
                corroborated BOOLEAN DEFAULT false,
                signal_count INT DEFAULT 1,
                decay_status VARCHAR(20) DEFAULT 'Hot',
                last_decay_calc TIMESTAMPTZ,
                archived_at TIMESTAMPTZ,
                card_company TEXT,
                card_why_now TEXT,
                card_what_they_need TEXT,
                card_do_this TEXT,
                push_status VARCHAR(20) DEFAULT 'PENDING',
                locked_until TIMESTAMPTZ,
                push_attempts INT DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                feedback_status TEXT DEFAULT NULL,
                feedback_at TIMESTAMPTZ DEFAULT NULL
            );
        `);
        await client.query(`ALTER TABLE lead_cards ENABLE ROW LEVEL SECURITY;`);

        // Audit remediation migration: add columns if upgrading from older schema
        const leadCardMigrations = [
            "ALTER TABLE lead_cards ADD COLUMN IF NOT EXISTS is_triangulated BOOLEAN DEFAULT false",
            "ALTER TABLE lead_cards ADD COLUMN IF NOT EXISTS triangulated_sources JSONB",
            "ALTER TABLE lead_cards ADD COLUMN IF NOT EXISTS decay_status VARCHAR(20) DEFAULT 'Hot'",
            "ALTER TABLE lead_cards ADD COLUMN IF NOT EXISTS last_decay_calc TIMESTAMPTZ",
            "ALTER TABLE lead_cards ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ",
            "ALTER TABLE lead_cards ADD COLUMN IF NOT EXISTS push_status VARCHAR(20) DEFAULT 'PENDING'",
            "ALTER TABLE lead_cards ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ",
            "ALTER TABLE lead_cards ADD COLUMN IF NOT EXISTS push_attempts INT DEFAULT 0"
        ];
        for (const migration of leadCardMigrations) {
            try { await client.query(migration); } catch(e) {}
        }

        // Performance indexes for lead_cards
        await client.query(`CREATE INDEX IF NOT EXISTS idx_lead_cards_org ON lead_cards (org_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_lead_cards_decay ON lead_cards (decay_status) WHERE decay_status != 'Dead';`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_lead_cards_score ON lead_cards (intent_score DESC);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_lead_cards_source ON lead_cards (org_id, source_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_lead_cards_push_queue ON lead_cards (push_status, locked_until);`);

        // 11A. Organization Canonical Registry (Phase 2)
        await client.query(`
            CREATE TABLE IF NOT EXISTS org_registry (
                org_id          TEXT PRIMARY KEY,
                canonical_name  TEXT NOT NULL,
                geo_state       TEXT NOT NULL,
                geo_market      TEXT NOT NULL DEFAULT 'IN',
                phonetic_key    TEXT,
                cin             TEXT,
                resolution_method TEXT NOT NULL,
                first_seen      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_signal_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                signal_count    INT NOT NULL DEFAULT 1,
                cumulative_score DECIMAL(6,2) DEFAULT 0,
                verity_tier     TEXT NOT NULL DEFAULT 'UNSCORED',
                created_at      TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_org_canonical ON org_registry (canonical_name, geo_state);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_org_phonetic  ON org_registry (phonetic_key, geo_state);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_org_cin       ON org_registry (cin) WHERE cin IS NOT NULL;`);
        await client.query(`ALTER TABLE org_registry ENABLE ROW LEVEL SECURITY;`);

        // 11B. Entity Merge Log (Phase 2)
        await client.query(`
            CREATE TABLE IF NOT EXISTS entity_merge_log (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                raw_name        TEXT NOT NULL,
                clean_name      TEXT NOT NULL,
                merged_into     TEXT NOT NULL REFERENCES org_registry(org_id),
                resolution_method TEXT NOT NULL,
                merged_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_merge_org ON entity_merge_log (merged_into);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_merge_at  ON entity_merge_log (merged_at);`);
        await client.query(`ALTER TABLE entity_merge_log ENABLE ROW LEVEL SECURITY;`);

        // 12. Knowledge Graph Nodes
        await client.query(`
            CREATE TABLE IF NOT EXISTS graph_nodes (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                type TEXT NOT NULL, -- ORG, DIRECTOR, SECTOR, GEOSTATE, SOURCE
                label TEXT NOT NULL,
                data JSONB,
                organization_id UUID REFERENCES tenants(id) DEFAULT '${defaultOrgId}',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(type, label, organization_id)
            );
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_graph_nodes_type_label ON graph_nodes (type, label);`);
        await client.query(`ALTER TABLE graph_nodes ENABLE ROW LEVEL SECURITY;`);

        // 13. Knowledge Graph Edges
        await client.query(`
            CREATE TABLE IF NOT EXISTS graph_edges (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                from_id UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
                to_id UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
                type TEXT NOT NULL, -- FILED_BY, LOCATED_IN, OPERATES_IN, TRIGGERED_BY, DIRECTOR_OF
                data JSONB,
                organization_id UUID REFERENCES tenants(id) DEFAULT '${defaultOrgId}',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(from_id, to_id, type, organization_id)
            );
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_graph_edges_from ON graph_edges (from_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_graph_edges_to ON graph_edges (to_id);`);
        await client.query(`ALTER TABLE graph_edges ENABLE ROW LEVEL SECURITY;`);

        await client.query(`ALTER TABLE graph_edges ENABLE ROW LEVEL SECURITY;`);

        // 14. Outreach Logs
        await client.query(`
            CREATE TABLE IF NOT EXISTS outreach_logs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                lead_id UUID NOT NULL REFERENCES lead_cards(lead_id) ON DELETE CASCADE,
                channel TEXT NOT NULL, -- WABA, EMAIL, LINKEDIN
                status TEXT NOT NULL DEFAULT 'PENDING',
                sent_at TIMESTAMPTZ,
                organization_id UUID REFERENCES tenants(id) DEFAULT '${defaultOrgId}',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_outreach_lead ON outreach_logs (lead_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_outreach_org_time ON outreach_logs (organization_id, created_at);`);
        await client.query(`ALTER TABLE outreach_logs ENABLE ROW LEVEL SECURITY;`);

        // 15. Approval Queue
        await client.query(`
            CREATE TABLE IF NOT EXISTS approval_queue (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                lead_id UUID NOT NULL REFERENCES lead_cards(lead_id) ON DELETE CASCADE,
                approver_id TEXT,
                status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED
                organization_id UUID REFERENCES tenants(id) DEFAULT '${defaultOrgId}',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(lead_id, organization_id)
            );
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_approval_status ON approval_queue (status);`);
        await client.query(`ALTER TABLE approval_queue ENABLE ROW LEVEL SECURITY;`);

        // 16. ConvoSpan Integration Config
        await client.query(`
            CREATE TABLE IF NOT EXISTS covospan_configs (
                id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id       TEXT NOT NULL UNIQUE,
                endpoint_url TEXT NOT NULL,
                api_key      TEXT NOT NULL,
                hmac_secret  TEXT,
                campaign_id  TEXT,
                is_active    BOOLEAN NOT NULL DEFAULT TRUE,
                created_at   TIMESTAMPTZ DEFAULT NOW(),
                updated_at   TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_covospan_org ON covospan_configs (org_id);`);

        // 17. ConvoSpan Push Log
        await client.query(`
            CREATE TABLE IF NOT EXISTS covospan_push_log (
                id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                lead_id      UUID NOT NULL,
                org_id       TEXT NOT NULL,
                status       TEXT NOT NULL CHECK (status IN ('SUCCESS', 'FAILED', 'SKIPPED')),
                detail       TEXT,
                triggered_by TEXT NOT NULL DEFAULT 'auto',
                attempts     INT DEFAULT 0,
                campaign_id  TEXT,
                pushed_at    TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_covospan_log_org    ON covospan_push_log (org_id, pushed_at DESC);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_covospan_log_lead   ON covospan_push_log (lead_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_covospan_log_status ON covospan_push_log (org_id, status);`);

        // 18. LLM Usage Audit (Phase 9)
        await client.query(`
            CREATE TABLE IF NOT EXISTS llm_usage_logs (
                id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id       TEXT NOT NULL,
                role         TEXT NOT NULL,
                model        TEXT NOT NULL,
                input_tokens INT DEFAULT 0,
                output_tokens INT DEFAULT 0,
                tokens_saved INT DEFAULT 0, -- TOON Optimization Delta
                timestamp    TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_llm_usage_org ON llm_usage_logs (org_id, timestamp DESC);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_llm_usage_role ON llm_usage_logs (role);`);

        await client.query('COMMIT');

        // Enable RLS on core multi-tenant tables
        await client.query(`ALTER TABLE scrape_results ENABLE ROW LEVEL SECURITY;`);
        await client.query(`ALTER TABLE lead_influence_data ENABLE ROW LEVEL SECURITY;`);
        await client.query(`ALTER TABLE roi_exports ENABLE ROW LEVEL SECURITY;`);
        await client.query(`ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;`);
        await client.query(`ALTER TABLE llm_usage_logs ENABLE ROW LEVEL SECURITY;`);

        // Create Policies (Simplified for demonstration - in production these use current_setting('app.current_organization_id'))
        // For the sake of this standalone/covospan agentic demo, we assume the 'organization_id' column is the partition key.
        const rlsTables = ['scrape_results', 'lead_influence_data', 'roi_exports', 'campaigns', 'organization_seats', 'audit_logs', 'graph_nodes', 'graph_edges', 'outreach_logs', 'approval_queue'];
        for (const table of rlsTables) {
            await client.query(`
                DO $$ 
                BEGIN 
                    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = '${table}' AND policyname = 'org_isolation_policy') THEN
                        CREATE POLICY org_isolation_policy ON ${table} 
                        USING (organization_id = current_setting('app.current_organization_id')::uuid);
                    END IF;
                END $$;
            `);
        }

        // Separate policy for llm_usage_logs using org_id instead of organization_id
        await client.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'llm_usage_logs' AND policyname = 'org_isolation_policy_usage') THEN
                    CREATE POLICY org_isolation_policy_usage ON llm_usage_logs 
                    USING (org_id = current_setting('app.current_organization_id'));
                END IF;
            END $$;
        `);

        // 19. Intelligence Source Autonomy (Phase 10)
        await client.query(`
            CREATE TABLE IF NOT EXISTS source_configs (
                id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id       TEXT NOT NULL,
                source_id    TEXT NOT NULL,
                is_enabled   BOOLEAN DEFAULT TRUE,
                updated_at   TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(org_id, source_id)
            );
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_source_configs_org ON source_configs (org_id);`);
        await client.query(`ALTER TABLE source_configs ENABLE ROW LEVEL SECURITY;`);

        // Source Config RLS using org_id
        await client.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'source_configs' AND policyname = 'org_isolation_policy_sources') THEN
                    CREATE POLICY org_isolation_policy_sources ON source_configs 
                    USING (org_id = current_setting('app.current_organization_id'));
                END IF;
            END $$;
        `);

        await client.query('COMMIT');
        console.log('[Database] Schema migration complete.');
    } catch (e: any) {
        await client.query('ROLLBACK');
        console.error('[Database] Migration failed:', e.message);
        throw e;
    } finally {
        client.release();
    }
}

export const db = {
    query,
    initDb
};

export { format, pool };
