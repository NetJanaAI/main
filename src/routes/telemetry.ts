import { Router, Response } from 'express';
import { TokenTracker } from '../lib/ai/token-tracker';
import { db } from '../lib/database';

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

export default router;
