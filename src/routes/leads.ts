import express from 'express';
import { query } from '../lib/database';
import { influenceQueue, connection } from '../lib/queue';
import Redis from 'ioredis';
import { z } from 'zod';

const redis = new Redis(connection as any);
const router = express.Router();

const FeedbackSchema = z.object({
    status: z.enum(["contacted", "responded", "converted", "wrong"])
});

/**
 * GET /api/leads/stats
 * Real aggregate counts from lead_cards. Used by the Dashboard bottom bar.
 */
router.get('/stats', async (req, res) => {
    try {
        const result = await query(`
            SELECT
                COUNT(*)                                                        AS total,
                COUNT(*) FILTER (WHERE intent_score >= 80)                     AS hot,
                COUNT(*) FILTER (WHERE intent_score >= 60 AND intent_score < 80) AS warm,
                COUNT(*) FILTER (WHERE intent_score < 60)                      AS cold,
                COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day') AS today,
                COALESCE(SUM(intent_score), 0)                                 AS alpha_sum
            FROM lead_cards
        `);
        const row = result.rows[0] || {};
        res.json({
            total:  parseInt(row.total  || '0', 10),
            hot:    parseInt(row.hot    || '0', 10),
            warm:   parseInt(row.warm   || '0', 10),
            cold:   parseInt(row.cold   || '0', 10),
            today:  parseInt(row.today  || '0', 10),
            alpha_sum: parseInt(row.alpha_sum || '0', 10)
        });
    } catch (error: any) {
        // DB unavailable — return zeros, not a 500. Dashboard handles null gracefully.
        console.warn('[Leads Stats] DB query failed, returning zeros:', error.message);
        res.json({ total: 0, hot: 0, warm: 0, cold: 0, today: 0 });
    }
});

/**
 * GET /api/leads/match
 * Matches buyer intent to a user query for industry and product focus.
 */
router.get('/match', async (req, res) => {
    try {
        const { industry, query: searchQuery } = req.query;

        let sql = `
            SELECT lead_id, company_name, geo_state, sector, procurement_category, card_what_they_need, card_why_now, intent_score, decay_score, created_at, corroborated, signal_count, verity_tier
            FROM lead_cards
            WHERE 1=1
        `;
        const params: any[] = [];

        if (industry && typeof industry === 'string') {
            params.push(`%${industry}%`);
            sql += ` AND sector ILIKE $${params.length}`;
        }

        if (searchQuery && typeof searchQuery === 'string') {
            params.push(`%${searchQuery}%`);
            sql += ` AND (procurement_category ILIKE $${params.length} OR card_what_they_need ILIKE $${params.length} OR company_name ILIKE $${params.length})`;
        }

        sql += ` ORDER BY intent_score DESC, created_at DESC LIMIT 50`;

        const results = await query(sql, params);
        res.json({ matches: results.rows });

    } catch (error: any) {
        console.error('[Leads Match Error]', error);
        res.status(500).json({ error: "InternalError", message: error.message });
    }
});

/**
 * GET /api/leads/re-engage-queue
 * Returns leads in 'Cold' status, sorted by freshness.
 */
router.get('/re-engage-queue', async (req, res) => {
    try {
        const organizationId = req.query.organizationId || (req as any).user?.organizationId;
        const region = req.query.region;
        const industry = req.query.industry;

        if (!organizationId) return res.status(401).json({ error: "Unauthorized" });

        let sql = `
            SELECT id, domain, friction_score, signals, geo_country, freshness_score, decay_status, signal_captured_at, previous_decay_status
            FROM scrape_results
            WHERE organization_id = $1 AND decay_status = 'Cold'
        `;
        const params: any[] = [organizationId];

        if (region) {
            params.push(region);
            sql += ` AND geo_country = $${params.length}`;
        }

        if (industry) {
            // Assuming signals or metadata has industry. Scrape results doesn't have a top-level industry col usually, but we'll check signals
            // Simplified for this task: check domain or industry tag if present
            // In a real scenario, this would be a more complex JSONB filter
        }

        sql += ` ORDER BY signal_captured_at DESC`;

        const results = await query(sql, params);
        res.json(results.rows);

    } catch (error: any) {
        res.status(500).json({ error: "InternalError", message: error.message });
    }
});

/**
 * POST /api/leads/:id/enrich-influence
 * Enqueues an influence enrichment job.
 */
router.post('/:id/enrich-influence', async (req, res) => {
    try {
        const organizationId = req.body.organizationId || (req as any).user?.organizationId;
        const leadId = req.params.id;

        if (!organizationId) return res.status(401).json({ error: "Unauthorized" });

        // Get region from lead
        const lead = await query("SELECT geo_country FROM scrape_results WHERE job_id = $1", [leadId]);
        if (lead.rows.length === 0) return res.status(404).json({ error: "Lead not found" });

        const region = lead.rows[0].geo_country?.toLowerCase().includes('uae') ? 'UAE' : 'India';

        await influenceQueue.add('enrich', {
            leadId,
            organizationId,
            region
        });

        res.json({ status: "Enqued", leadId, region });

    } catch (error: any) {
        res.status(500).json({ error: "InternalError", message: error.message });
    }
});

/**
 * GET /api/leads/:id/influence
 * Returns the latest influence map for a lead.
 */
router.get('/:id/influence', async (req, res) => {
    try {
        const leadId = req.params.id;
        const organizationId = (req as any).organizationId || req.query.organizationId || (req as any).user?.organizationId;

        if (!organizationId) return res.status(401).json({ error: "Unauthorized" });

        const result = await query(`
            SELECT influence_map
            FROM lead_influence_data
            WHERE lead_id = $1 AND organization_id = $2
            ORDER BY enriched_at DESC
            LIMIT 1
        `, [leadId, organizationId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Influence data not found" });
        }

        const map = result.rows[0].influence_map || {};
        res.json({
            map,
            scores: {
                tradeBodies: map.tradeBodies?.length || 0,
                publications: map.publications?.length || 0,
                events: map.events?.length || 0,
                podcasts: map.podcasts?.length || 0
            },
            overallScore: map.influenceScore || 0,
            alphaScore: map.alphaScore || map.influenceScore || 0
        });
    } catch (error: any) {
        res.status(500).json({ error: "InternalError", message: error.message });
    }
});

/**
 * PATCH /api/leads/:id/feedback
 * ML Recalibration loop insertion.
 */
router.patch('/:id/feedback', async (req, res) => {
    try {
        const lead_id = req.params.id;
        const validation = FeedbackSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ error: 'Invalid feedback status' });
        }

        const { status } = validation.data;
        const now = new Date().toISOString();
        const dateStr = now.split('T')[0];

        const result = await query('SELECT source_id FROM lead_cards WHERE lead_id = $1', [lead_id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        const source_id = result.rows[0].source_id;

        await query(
            `UPDATE lead_cards SET feedback_status = $1, feedback_at = $2 WHERE lead_id = $3`,
            [status, now, lead_id]
        );

        await redis.incr(`fb:${source_id}:${status}:${dateStr}`);

        await redis.hincrby(`source_perf:${source_id}`, status, 1);
        await redis.hincrby(`source_perf:${source_id}`, 'total', 1);

        const perfData = await redis.hgetall(`source_perf:${source_id}`);
        const contacted = parseInt(perfData.contacted || '0', 10);
        const converted = parseInt(perfData.converted || '0', 10);

        const conversion_rate = contacted > 0 ? converted / contacted : 0;
        await redis.hset(`source_perf:${source_id}`, 'conversion_rate', conversion_rate.toString());

        res.json({ message: 'Feedback recorded', source_id, conversion_rate });

    } catch (err: any) {
        console.error('[Leads] Feedback error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/leads/:id/intelligence
 * Performs a deep-join to fetch adversarial reasoning and triangulation proof.
 */
router.get('/:id/intelligence', async (req: any, res: any) => {
    try {
        const lead_id = req.params.id;
        const orgId = req.organizationId || (req as any).user?.organizationId || 'default';

        const result = await query(`
            SELECT 
                l.*, 
                s.critic_analysis, 
                s.grounding_score,
                s.citations,
                i.influence_map
            FROM lead_cards l
            LEFT JOIN scrape_results s ON l.lead_id = s.job_id
            LEFT JOIN lead_influence_data i ON l.lead_id = i.lead_id
            WHERE l.lead_id = $1 AND l.org_id = $2
        `, [lead_id, orgId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Intelligence node not found for this lead.' });
        }

        res.json(result.rows[0]);
    } catch (e: any) {
        console.error('[Leads Intelligence] Error:', e);
        res.status(500).json({ error: 'Internal server error', message: e.message });
    }
});

export default router;
