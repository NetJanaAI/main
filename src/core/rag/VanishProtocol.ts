import fs from 'fs';
import path from 'path';
import { db, pool } from '../../lib/database';
import { deleteKeysMatching } from '../../lib/cache';
import { TENANT_TABLES, TenantTable } from '../../lib/db/rlsPolicies';
import { TenantRAGStore } from './TenantRAGStore';
import { AuditTrail } from '../compliance/AuditTrail';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Kept on purpose: the tamper-evident trail is the proof that the erasure happened.
// Foreign keys between tenant tables all cascade, so deletion order does not matter.
const RETAINED_TABLES = ['audit_logs', 'rag_audit_log'];

export class VanishProtocol {
    private static DEFAULT_RETENTION_DAYS = 90;

    /** Every tenant table the purge empties, generated from the schema inventory so none can be forgotten. */
    static readonly PURGED_TABLES: TenantTable[] = TENANT_TABLES.filter((t) => !RETAINED_TABLES.includes(t.table));

    // Table and column names come from the code-defined inventory above, never from input.
    private static readonly DELETE_STATEMENTS = VanishProtocol.PURGED_TABLES.map((t) => `DELETE FROM ${t.table} WHERE ${t.column} = $1`);

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
     * Hard purges all of a tenant's data for GDPR/DPDP erasure: every tenant table, Redis keys and
     * screenshot files. The tenants row is kept as an anonymous tombstone and the audit trail is kept,
     * because audit_logs references the tenant and is the evidence that the erasure took place.
     * All database work is one transaction on one connection; files and Redis go only after it commits.
     */
    static async purge(organizationId: string) {
        if (!UUID.test(organizationId)) throw new Error('[Vanish] organizationId must be a UUID.');
        if (!pool) throw new Error('Database is not initialized (DATABASE_URL missing).');
        console.warn(`[Vanish] Initiating GDPR HARD PURGE for Org: ${organizationId}`);

        const client = await pool.connect();
        let screenshots: string[];
        try {
            await client.query('BEGIN');
            await client.query("SELECT set_config('app.bypass_rls', 'true', true)");

            const shots = await client.query(
                `SELECT screenshot_path FROM scrape_results WHERE organization_id = $1 AND screenshot_path IS NOT NULL
                 UNION
                 SELECT screenshot_path FROM archived_scrape_results WHERE organization_id = $1 AND screenshot_path IS NOT NULL`,
                [organizationId]
            );
            screenshots = shots.rows.map((r: { screenshot_path: string }) => r.screenshot_path);

            for (const statement of VanishProtocol.DELETE_STATEMENTS) {
                await client.query(statement, [organizationId]);
            }

            await client.query(
                `UPDATE tenants SET name = $2, display_name = NULL, clerk_user_id = NULL, clerk_org_id = NULL,
                        api_key_hash = NULL, razorpay_subscription_id = NULL, razorpay_subscription_status = NULL,
                        deactivated_at = COALESCE(deactivated_at, NOW()), purged_at = NOW()
                 WHERE id = $1`,
                [organizationId, `purged-${organizationId}`]
            );
            await client.query('COMMIT');
        } catch (e: any) {
            await client.query('ROLLBACK').catch(() => undefined);
            console.error(`[Vanish] Purge failed for ${organizationId}`, e);
            throw e;
        } finally {
            client.release();
        }

        await VanishProtocol.removeExternalData(organizationId, screenshots);

        try {
            await AuditTrail.log({
                actorId: 'system',
                organizationId,
                action: 'GDPR_PURGE_EXECUTE',
                resource: `tenant:${organizationId}`,
                metadata: { scope: 'tenant_data', tables: VanishProtocol.PURGED_TABLES.length }
            });
        } catch (auditError: any) {
            console.warn(`[Vanish] Purge completed but audit write failed: ${auditError.message}`);
        }
        console.warn(`[Vanish] Org ${organizationId} totally annihilated.`);
        return { status: 'success', deleted: true };
    }

    // The database is already clean at this point, so a failure here is logged, not thrown.
    private static async removeExternalData(organizationId: string, screenshotPaths: string[]) {
        try {
            await new TenantRAGStore(organizationId).clearStore();
        } catch (e: any) {
            console.warn(`[Vanish] In-memory RAG clear failed for ${organizationId}: ${e.message}`);
        }

        const patterns = [
            `org:${organizationId}:*`, `sources:${organizationId}`, `usage:${organizationId}:*`,
            `outreach:${organizationId}:*`, `gemini_calls:${organizationId}:*`,
        ];
        for (const pattern of patterns) {
            try {
                await deleteKeysMatching(pattern);
            } catch (e: any) {
                console.warn(`[Vanish] Redis cleanup failed for ${pattern}: ${e.message}`);
            }
        }

        const dir = path.resolve(path.join(process.cwd(), 'data', 'screenshots'));
        for (const stored of new Set(screenshotPaths)) {
            const match = /^\/screenshots\/([^/\\]+)$/.exec(stored);
            if (!match) continue;
            const file = path.resolve(dir, match[1]);
            if (path.dirname(file) !== dir) continue;
            try {
                await fs.promises.rm(file, { force: true });
            } catch (e: any) {
                console.warn(`[Vanish] Could not delete screenshot ${match[1]}: ${e.message}`);
            }
        }
    }
}
