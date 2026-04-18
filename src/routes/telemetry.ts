import { Router, Response } from 'express';
import { TokenTracker } from '../lib/ai/token-tracker';
import { db } from '../lib/database';
import { getDedupStats } from '../core/collectors/indiamart-dedup';

const router = Router();

/**
 * GET /api/telemetry/tokens
 * Returns real-time and historical token usage for the organization.
 */
router.get('/tokens', async (req: any, res: Response) => {
    const orgId = req.organizationId || 'default';
    const days = parseInt(req.query.days as string || '7', 10);

    try {
        // 1. Get real-time stats from Redis (last 7 days)
        const redisStats = await TokenTracker.getStats(orgId, days);

        // 2. Get aggregate historical stats from Postgres
        const postgresStats = await db.query(`
            SELECT 
                DATE(timestamp) as date,
                SUM(input_tokens) as input,
                SUM(output_tokens) as output,
                SUM(tokens_saved) as saved,
                ROUND(100.0 * SUM(tokens_saved) / NULLIF(SUM(input_tokens) + SUM(tokens_saved), 0), 1) as efficiency_pct
            FROM llm_usage_logs
            WHERE org_id = $1 AND timestamp >= NOW() - INTERVAL '30 days'
            GROUP BY DATE(timestamp)
            ORDER BY DATE(timestamp) DESC
        `, [orgId]);

        // 3. Get Role Distribution (Who is spending most)
        const roleStats = await db.query(`
            SELECT 
                role,
                SUM(input_tokens + output_tokens) as total_tokens
            FROM llm_usage_logs
            WHERE org_id = $1 AND timestamp >= NOW() - INTERVAL '7 days'
            GROUP BY role
            ORDER BY total_tokens DESC
        `, [orgId]);

        res.json({
            realtime: redisStats,
            historical: postgresStats.rows,
            roles: roleStats.rows
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/telemetry/health
 * Returns high-level security and operational health metrics.
 */
router.get('/health', async (req: any, res: Response) => {
    try {
        const orgId = req.organizationId || 'default';
        
        // 1. Get Blocked IP Count (Last 24h)
        const blocks = await db.query(`
            SELECT COUNT(*) FROM audit_logs 
            WHERE action = 'IP_BLOCKED' AND created_at >= NOW() - INTERVAL '24 hours'
        `);

        // 2. Get Audit Activity (Last 1h)
        const audits = await db.query(`
            SELECT COUNT(*) FROM audit_logs 
            WHERE created_at >= NOW() - INTERVAL '1 hour'
        `);

        // 3. Canary Heartbeat (Check if scraping workers are alive)
        const workers = await db.query(`
            SELECT last_heartbeat FROM system_canaries WHERE type = 'SCRAPE_WORKER' LIMIT 1
        `);
        const lastHeartbeat = workers.rows[0]?.last_heartbeat;
        const isHealthy = lastHeartbeat ? (Date.now() - new Date(lastHeartbeat).getTime()) < 300000 : false;

        res.json({
            blocked_ips_24h: parseInt(blocks.rows[0]?.count || '0', 10),
            audit_events_1h: parseInt(audits.rows[0]?.count || '0', 10),
            system_status: isHealthy ? 'HEALTHY' : 'DEGRADED',
            observability: 'ACTIVE'
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/telemetry/sources
 * Aggregates ingestion health metrics for different sources.
 */
router.get('/sources', async (req: any, res: Response) => {
    try {
        const stats = await getDedupStats(7);
        const canaries = await db.query(`
            SELECT type, last_heartbeat, status FROM system_canaries
        `);

        res.json({
            indiamart: stats,
            workers: canaries.rows,
            summary: {
                total_queued: stats.reduce((acc, curr) => acc + curr.queued, 0),
                total_duplicates: stats.reduce((acc, curr) => acc + curr.duplicates, 0),
                last_updated: new Date().toISOString()
            }
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
