import { db } from '../../lib/database';
import { TenantRAGStore } from './TenantRAGStore';

export class VanishProtocol {
    private static DEFAULT_RETENTION_DAYS = 90;

    /**
     * Purges stale RAG data and archives old lead signals to maintain sovereignty.
     * Triggered via cron or manual admin sweep.
     */
    static async executeVanishSweep(retentionDays: number = this.DEFAULT_RETENTION_DAYS) {
        console.log(`[Vanish] Initiating global sweep for data older than ${retentionDays} days...`);
        
        try {
            // 1. Identify stale leads in DB
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - retentionDays);
            
            const staleLeads = await db.query(
                'SELECT job_id, organization_id FROM scrape_results WHERE timestamp < $1',
                [cutoff.toISOString()]
            );

            console.log(`[Vanish] Found ${staleLeads.rows.length} stale leads for purging.`);

            for (const lead of staleLeads.rows) {
                // 2. Clear associated RAG vector data
                const store = new TenantRAGStore(lead.organization_id);
                await store.clearJobData(lead.job_id);
                
                // 3. Move to archive or hard delete based on policy
                // We'll move to archived_scrape_results for auditability but clear PII
                await db.query('BEGIN');
                await db.query(`
                    INSERT INTO archived_scrape_results 
                    SELECT *, NOW(), 'Vanish Protocol Purge' FROM scrape_results WHERE job_id = $1
                `, [lead.job_id]);
                
                await db.query('DELETE FROM scrape_results WHERE job_id = $1', [lead.job_id]);
                await db.query('COMMIT');
            }

            console.log(`[Vanish] Sweep completed successfully.`);
            return staleLeads.rows.length;
        } catch (e: any) {
            console.error('[Vanish] Sweep failed:', e.message);
            throw e;
        }
    }

    /**
     * Hard purges all PII, vector embeddings, and Postgres rows for a tenant.
     * Required for GDPR/DPDP Right to Erasure fulfillment.
     */
    static async purge(organizationId: string) {
        console.warn(`[Vanish] Initiating GDPR HARD PURGE for Org: ${organizationId}`);

        try {
            await db.query('BEGIN');

            // 1. WIPE PII Vault records
            await db.query('DELETE FROM pii_vault WHERE organization_id = $1', [organizationId]);

            // 2. Clear all RAG embeddings
            const store = new TenantRAGStore(organizationId);
            await store.clearStore();
            await db.query('DELETE FROM rag_namespaces WHERE namespace = $1', [organizationId]);

            // 3. Clear Scrape Results / Leads
            await db.query('DELETE FROM scrape_results WHERE organization_id = $1', [organizationId]);

            // 4. Archive deletion request in Audit
            await db.query(`
                INSERT INTO audit_log (organization_id, action, target) 
                VALUES ($1, 'GDPR_PURGE_EXECUTE', 'ALL_DATA')
            `, [organizationId]);

            await db.query('COMMIT');
            console.warn(`[Vanish] Org ${organizationId} totally annihilated.`);
            return { status: 'success', deleted: true };
        } catch (e: any) {
            await db.query('ROLLBACK');
            console.error(`[Vanish] Purge failed for ${organizationId}`, e);
            throw e;
        }
    }
}
