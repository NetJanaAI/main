import { Router, Request, Response } from 'express';
import { db } from '../lib/database';
import { CovospanPusher } from '../core/CovospanPusher';
import crypto from 'crypto';
import { z } from 'zod';

const router = Router();

const ConfigSchema = z.object({
    endpoint_url: z.string().url('Must be a valid URL'),
    api_key: z.string().min(1, 'API key is required'),
    hmac_secret: z.string().optional(),
    campaign_id: z.string().optional(),
});

// ─── GET /api/covospan/config ─────────────────────────────────────────────────
// Returns current ConvoSpan endpoint config for this org (masked api_key)
router.get('/config', async (req: any, res: Response) => {
    const orgId = req.organizationId || 'default';
    try {
        const result = await db.query(
            `SELECT id, endpoint_url, 
                    CONCAT(SUBSTRING(api_key, 1, 6), '••••••••••', RIGHT(api_key, 4)) AS api_key_masked,
                    CASE WHEN hmac_secret IS NOT NULL THEN TRUE ELSE FALSE END AS has_hmac,
                    campaign_id, is_active, created_at, updated_at
             FROM covospan_configs WHERE org_id = $1 LIMIT 1`,
            [orgId]
        );
        res.json({ config: result.rows[0] || null });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// ─── POST /api/covospan/config ────────────────────────────────────────────────
// Upsert ConvoSpan endpoint config
router.post('/config', async (req: any, res: Response) => {
    const orgId = req.organizationId || 'default';
    const validation = ConfigSchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({ error: 'Validation failed', details: validation.error.flatten() });
    }

    const { endpoint_url, api_key, hmac_secret, campaign_id } = validation.data;

    try {
        await db.query(
            `INSERT INTO covospan_configs (org_id, endpoint_url, api_key, hmac_secret, campaign_id)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (org_id) DO UPDATE SET
                endpoint_url = EXCLUDED.endpoint_url,
                api_key      = EXCLUDED.api_key,
                hmac_secret  = EXCLUDED.hmac_secret,
                campaign_id  = EXCLUDED.campaign_id,
                is_active    = TRUE,
                updated_at   = NOW()`,
            [orgId, endpoint_url, api_key, hmac_secret || null, campaign_id || null]
        );
        res.json({ success: true, message: 'ConvoSpan endpoint configured.' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// ─── DELETE /api/covospan/config ─────────────────────────────────────────────
// Deactivate (soft-disable) ConvoSpan push for this org
router.delete('/config', async (req: any, res: Response) => {
    const orgId = req.organizationId || 'default';
    try {
        await db.query(
            `UPDATE covospan_configs SET is_active = FALSE, updated_at = NOW() WHERE org_id = $1`,
            [orgId]
        );
        res.json({ success: true, message: 'ConvoSpan sync disabled.' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// ─── GET /api/covospan/log ────────────────────────────────────────────────────
// Paginated push log — what was sent, when, status
router.get('/log', async (req: any, res: Response) => {
    const orgId = req.organizationId || 'default';
    const limit = Math.min(parseInt(req.query.limit as string || '50'), 200);
    const offset = parseInt(req.query.offset as string || '0');
    const status = req.query.status; // filter by SUCCESS/FAILED/SKIPPED

    try {
        let sql = `
            SELECT l.id, l.lead_id, l.status, l.detail, l.triggered_by, 
                   l.attempts, l.campaign_id, l.pushed_at,
                   lc.company_name, lc.intent_score, lc.source_id, lc.sector, lc.buying_stage
            FROM covospan_push_log l
            LEFT JOIN lead_cards lc ON lc.lead_id = l.lead_id
            WHERE l.org_id = $1
        `;
        const params: any[] = [orgId];

        if (status) {
            params.push(status);
            sql += ` AND l.status = $${params.length}`;
        }

        sql += ` ORDER BY l.pushed_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const [rows, total] = await Promise.all([
            db.query(sql, params),
            db.query(`SELECT COUNT(*) FROM covospan_push_log WHERE org_id = $1${status ? ` AND status = '${status}'` : ''}`, [orgId])
        ]);

        res.json({ 
            log: rows.rows,
            total: parseInt(total.rows[0].count, 10),
            limit,
            offset
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// ─── GET /api/covospan/stats ──────────────────────────────────────────────────
// Aggregate push stats — total pushed, success rate, campaign breakdown
router.get('/stats', async (req: any, res: Response) => {
    const orgId = req.organizationId || 'default';
    try {
        const [totals, byCampaign, bySource, byBuyingStage, recentFailures] = await Promise.all([
            // Overall counts
            db.query(`
                SELECT
                    COUNT(*) AS total_pushes,
                    COUNT(*) FILTER (WHERE status = 'SUCCESS')  AS success,
                    COUNT(*) FILTER (WHERE status = 'FAILED')   AS failed,
                    COUNT(*) FILTER (WHERE status = 'SKIPPED')  AS skipped,
                    COUNT(*) FILTER (WHERE pushed_at >= NOW() - INTERVAL '24h') AS today,
                    ROUND(
                        100.0 * COUNT(*) FILTER (WHERE status = 'SUCCESS') 
                        / NULLIF(COUNT(*), 0), 1
                    ) AS success_rate_pct
                FROM covospan_push_log WHERE org_id = $1
            `, [orgId]),
            // By campaign
            db.query(`
                SELECT campaign_id, COUNT(*) AS count, 
                       COUNT(*) FILTER (WHERE status = 'SUCCESS') AS success
                FROM covospan_push_log 
                WHERE org_id = $1 AND campaign_id IS NOT NULL
                GROUP BY campaign_id ORDER BY count DESC
            `, [orgId]),
            // By signal source
            db.query(`
                SELECT lc.source_id, COUNT(*) AS pushed
                FROM covospan_push_log l
                JOIN lead_cards lc ON lc.lead_id = l.lead_id
                WHERE l.org_id = $1 AND l.status = 'SUCCESS'
                GROUP BY lc.source_id ORDER BY pushed DESC
            `, [orgId]),
            // By buying stage
            db.query(`
                SELECT lc.buying_stage, COUNT(*) AS pushed
                FROM covospan_push_log l
                JOIN lead_cards lc ON lc.lead_id = l.lead_id
                WHERE l.org_id = $1 AND l.status = 'SUCCESS'
                GROUP BY lc.buying_stage ORDER BY pushed DESC
            `, [orgId]),
            // Recent failures
            db.query(`
                SELECT lead_id, detail, pushed_at, attempts
                FROM covospan_push_log
                WHERE org_id = $1 AND status = 'FAILED'
                ORDER BY pushed_at DESC LIMIT 5
            `, [orgId])
        ]);

        res.json({
            totals: totals.rows[0],
            by_campaign: byCampaign.rows,
            by_source: bySource.rows,
            by_buying_stage: byBuyingStage.rows,
            recent_failures: recentFailures.rows,
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// ─── POST /api/covospan/push/:leadId ─────────────────────────────────────────
// Manually re-push a specific lead to ConvoSpan
router.post('/push/:leadId', async (req: any, res: Response) => {
    const orgId = req.organizationId || 'default';
    const { leadId } = req.params;

    try {
        const leadRes = await db.query(
            `SELECT * FROM lead_cards WHERE lead_id = $1`,
            [leadId]
        );
        if (leadRes.rows.length === 0) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        // Run push in background — don't block the HTTP response
        CovospanPusher.push({ ...leadRes.rows[0], org_id: orgId }, 'manual').catch(e =>
            console.error('[Covospan Manual Push] Error:', e.message)
        );

        res.json({ status: 'push_queued', lead_id: leadId });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// ─── POST /api/covospan/test ─────────────────────────────────────────────────
// Send a synthetic test signal to verify ConvoSpan endpoint connectivity
router.post('/test', async (req: any, res: Response) => {
    const orgId = req.organizationId || 'default';
    const mockLead = {
        lead_id: crypto.randomUUID(),
        org_id: orgId,
        company_name: 'TEST_HEARTBEAT_ENTITY',
    };

    try {
        const result = await CovospanPusher.performTestPush(mockLead);
        res.json(result);
    } catch (e: any) {
        res.status(502).json({ ok: false, error: e.message });
    }
});

export default router;
