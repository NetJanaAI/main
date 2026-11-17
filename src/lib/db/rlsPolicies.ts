// One definition of the tenant isolation policy, used by initDb and by the RLS tests,
// so the policy that is tested is the policy that ships.

export interface TenantTable {
    table: string;
    column: 'organization_id' | 'org_id';
    type: 'uuid' | 'text';
}

const uuidTables = [
    'scrape_results', 'lead_influence_data', 'roi_exports', 'campaigns', 'organization_seats',
    'audit_logs', 'graph_nodes', 'graph_edges', 'outreach_logs', 'approval_queue',
    'dead_letter_queue', 'pii_vault', 'capsule_log', 'scrape_schedules',
    'data_source_credentials', 'webhook_secrets', 'allowed_ips', 'craftmyfunnel_connections',
    'signal_observation', 'signal_confirmations',
    'archived_scrape_results', 'dead_letter_queue_archive',
];
const textOrgIdTables = [
    'lead_cards', 'llm_usage_logs', 'covospan_configs', 'covospan_push_log',
    'craftmyfunnel_push_log', 'source_configs', 'watch_profiles', 'rag_embeddings',
    'wiki_pages', 'wiki_revisions',
];

// org_registry, entity_merge_log and canonical_entity_cache are shared reference data
// with no tenant column, so they are intentionally not listed here.
export const TENANT_TABLES: TenantTable[] = [
    ...uuidTables.map((table): TenantTable => ({ table, column: 'organization_id', type: 'uuid' })),
    ...textOrgIdTables.map((table): TenantTable => ({ table, column: 'org_id', type: 'text' })),
    { table: 'rag_audit_log', column: 'organization_id', type: 'text' },
];

export const POLICY_NAME = 'tenant_isolation';

// Policies created by earlier migrations; dropped so exactly one policy governs each table.
const LEGACY_POLICY_NAMES = [
    'org_isolation_policy', 'org_isolation_policy_lead_cards', 'org_isolation_policy_usage',
    'org_isolation_policy_covospan_configs', 'org_isolation_policy_covospan_push_log',
    'org_isolation_policy_sources', 'org_isolation_policy_watch', 'org_isolation_policy_rag',
    'org_isolation_policy_wiki', 'org_isolation_policy_wiki_rev',
];

function predicate({ column, type }: TenantTable): string {
    // current_setting(..., true) returns NULL instead of raising when the setting was never
    // made, and NULLIF turns the empty string left behind by a finished transaction into NULL,
    // so a connection with no tenant context matches no rows.
    const current = `NULLIF(current_setting('app.current_organization_id', true), '')`;
    const tenant = type === 'uuid' ? `${current}::uuid` : current;
    return `(current_setting('app.bypass_rls', true) = 'true' OR ${column} = ${tenant})`;
}

/**
 * Idempotent statements that enable, optionally force, and (re)define the isolation policy.
 * FORCE makes the policy bind the table owner too; superusers and BYPASSRLS roles still skip it.
 */
export function tenantRlsStatements(options: { force: boolean; tables?: TenantTable[] }): string[] {
    const statements: string[] = [];
    for (const t of options.tables ?? TENANT_TABLES) {
        for (const legacy of LEGACY_POLICY_NAMES) {
            statements.push(`DROP POLICY IF EXISTS ${legacy} ON ${t.table}`);
        }
        statements.push(`ALTER TABLE ${t.table} ENABLE ROW LEVEL SECURITY`);
        statements.push(`ALTER TABLE ${t.table} ${options.force ? 'FORCE' : 'NO FORCE'} ROW LEVEL SECURITY`);
        statements.push(`DROP POLICY IF EXISTS ${POLICY_NAME} ON ${t.table}`);
        const p = predicate(t);
        statements.push(`CREATE POLICY ${POLICY_NAME} ON ${t.table} USING ${p} WITH CHECK ${p}`);
    }
    return statements;
}
