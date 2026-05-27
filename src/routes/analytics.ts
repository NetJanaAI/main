import express from 'express';
import { query } from '../lib/database';

const router = express.Router();

/**
 * GET /api/analytics/dashboard
 * Aggregates ROI, Accuracy, and Monitored Entities
 */
router.get('/dashboard', async (req: any, res: any) => {
    try {
        const orgId = req.organizationId || (req as any).user?.organizationId;
        if (!orgId) return res.status(401).json({ error: 'Unauthorized' });
        
        // Active Entities
        const activeRes = await query(`
            SELECT COUNT(*) FROM org_registry WHERE org_id != ''
        `);
        
        // Sector Distribution
        const sectorsRes = await query(`
            SELECT sector as name, COUNT(*) as count 
            FROM lead_cards 
            WHERE org_id = $1 AND sector IS NOT NULL AND sector != ''
            GROUP BY sector 
            ORDER BY count DESC 
            LIMIT 4
        `, [orgId]);

        // Calculate ROI based on signal count + high intent scores
        const roiRes = await query(`
            SELECT COALESCE(SUM(intent_score * 500), 0) as estimated_roi 
            FROM lead_cards 
            WHERE org_id = $1 AND intent_score >= 70
        `, [orgId]);

        // Signal Accuracy (from feedback status)
        const accuracyRes = await query(`
            SELECT 
                COUNT(*) FILTER (WHERE feedback_status IN ('contacted', 'responded', 'converted')) as positive,
                COUNT(*) FILTER (WHERE feedback_status IS NOT NULL) as total
            FROM lead_cards
            WHERE org_id = $1
        `, [orgId]);

        const totalFeedback = parseInt(accuracyRes.rows[0]?.total || '0', 10);
        const positiveFeedback = parseInt(accuracyRes.rows[0]?.positive || '0', 10);
        const accuracyPct = totalFeedback > 0 ? ((positiveFeedback / totalFeedback) * 100).toFixed(1) : '0.0';

        const totalActive = parseInt(activeRes.rows[0]?.count || '0', 10);
        
        let estimatedRoi = parseInt(roiRes.rows[0]?.estimated_roi || '0', 10);

        // Format ROI for display
        const formatROI = (val: number) => {
            if (val >= 1000000) return '$' + (val / 1000000).toFixed(1) + 'M';
            if (val >= 1000) return '$' + (val / 1000).toFixed(1) + 'K';
            return '$' + val;
        };

        const totalSectors = sectorsRes.rows.reduce((acc: number, row: any) => acc + parseInt(row.count), 0);
        const sectors = sectorsRes.rows.map((row: any, i: number) => {
            const colors = ['bg-blue-500', 'bg-[#D4AF37]', 'bg-emerald-500', 'bg-purple-500'];
            return {
                name: row.name,
                pct: totalSectors > 0 ? Math.round((parseInt(row.count) / totalSectors) * 100) : 0,
                color: colors[i % colors.length]
            };
        });
        
        res.json({
            roi: formatROI(estimatedRoi),
            accuracy: accuracyPct + '%',
            activeEntities: totalActive.toLocaleString(),
            sectors
        });
    } catch (e: any) {
        console.error('[Analytics] Dashboard error:', e);
        res.status(500).json({ error: 'Internal error' });
    }
});

/**
 * GET /api/analytics/pipeline
 * Returns Pipeline Step counts and Recent Dispatches
 */
router.get('/pipeline', async (req: any, res: any) => {
    try {
        const orgId = req.organizationId || (req as any).user?.organizationId;
        if (!orgId) return res.status(401).json({ error: 'Unauthorized' });

        // Raw Signals (Ingestion)
        const ingestedRes = await query(`SELECT COUNT(*) FROM scrape_results WHERE organization_id = $1`, [orgId]);
        const ingestedCount = parseInt(ingestedRes.rows[0]?.count || '0', 10);

        // Merged Entities
        const mergedRes = await query(`SELECT COUNT(*) FROM org_registry`);
        const mergedCount = parseInt(mergedRes.rows[0]?.count || '0', 10);

        // Intent Scoring (High Intent)
        const scoredRes = await query(`SELECT COUNT(*) FROM lead_cards WHERE org_id = $1 AND intent_score >= 60`, [orgId]);
        const scoredCount = parseInt(scoredRes.rows[0]?.count || '0', 10);

        // Dispatches
        const dispatchedRes = await query(`SELECT COUNT(*) FROM outreach_logs WHERE organization_id = $1 AND status = 'SENT'`, [orgId]);
        const dispatchedCount = parseInt(dispatchedRes.rows[0]?.count || '0', 10);

        // Recent Dispatches List
        const recentRes = await query(`
            SELECT o.id, o.channel, o.status, o.sent_at, l.company_name, l.intent_score
            FROM outreach_logs o
            JOIN lead_cards l ON o.lead_id = l.lead_id
            WHERE o.organization_id = $1
            ORDER BY o.sent_at DESC
            LIMIT 4
        `, [orgId]);

        res.json({
            pipeline: {
                ingested: ingestedCount,
                merged: mergedCount,
                scored: scoredCount,
                dispatched: dispatchedCount
            },
            recentDispatches: recentRes.rows
        });
    } catch (e: any) {
        console.error('[Analytics] Pipeline error:', e);
        res.status(500).json({ error: 'Internal error' });
    }
});

export default router;
