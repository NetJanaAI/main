import express from 'express';
import crypto from 'crypto';
import Redis from 'ioredis';
import { query } from '../lib/database';
import { getHmacSecret } from '../lib/secrets';
import { CampaignROIAggregator } from '../standalone/services/CampaignROIAggregator';
import { ROIPDFGenerator } from '../standalone/services/ROIPDFGenerator';

const router = express.Router();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const CAMPAIGN_STATES = new Set(['DISCOVERED', 'CAPSULE_SENT', 'ACKNOWLEDGED', 'CONVERTED', 'DORMANT']);

router.get('/', async (req, res) => {
    try {
        const organizationId = (req as any).organizationId || (req as any).user?.organizationId;
        if (!organizationId) return res.status(401).json({ error: "Unauthorized" });

        const result = await query(`
            SELECT
                c.id,
                c.domain,
                c.state,
                c.capsule_id,
                c.notes,
                c.updated_at,
                s.friction_score,
                s.estimated_roi,
                s.geo_country
            FROM campaigns c
            LEFT JOIN scrape_results s
                ON s.domain = c.domain AND s.organization_id = c.organization_id
            WHERE c.organization_id = $1
            ORDER BY c.updated_at DESC
            LIMIT 100
        `, [organizationId]);

        res.json(result.rows);
    } catch (error: any) {
        res.status(500).json({ error: "InternalError", message: error.message });
    }
});

router.post('/:domain/advance', async (req, res) => {
    try {
        const organizationId = (req as any).organizationId || (req as any).user?.organizationId;
        const domain = decodeURIComponent(req.params.domain);
        const state = req.body?.state;

        if (!organizationId) return res.status(401).json({ error: "Unauthorized" });
        if (!CAMPAIGN_STATES.has(state)) return res.status(400).json({ error: "Invalid campaign state" });

        const result = await query(`
            INSERT INTO campaigns (domain, state, organization_id, updated_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (organization_id, domain)
            DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()
            RETURNING *
        `, [domain, state, organizationId]);

        res.json(result.rows[0]);
    } catch (error: any) {
        res.status(500).json({ error: "InternalError", message: error.message });
    }
});

/**
 * GET /api/campaign/:id/export/roi-report
 * Generates and streams a signed ROI PDF.
 */
router.get('/:id/export/roi-report', async (req, res) => {
    try {
        const campaignId = req.params.id;
        const organizationId = (req as any).organizationId || (req as any).user?.organizationId || req.query.organizationId;
        const redacted = req.query.share === 'true';
        const avgDealSize = parseFloat(req.query.avgDealSize as string) || 0;

        if (!organizationId) return res.status(401).json({ error: "Unauthorized" });

        // 1. Aggregate Stats
        const stats = await CampaignROIAggregator.getStats(campaignId, organizationId, avgDealSize);

        // 2. Document Integrity (HMAC)
        const timestamp = new Date().toISOString();
        const dataToSign = `${campaignId}:${organizationId}:${timestamp}:${redacted}`;
        const hmac = crypto.createHmac('sha256', getHmacSecret('ROI report signing')).update(dataToSign).digest('hex');

        // 3. Generate PDF
        const pdfBuffer = await ROIPDFGenerator.generate(stats, organizationId, hmac, redacted);

        // 4. Audit Log
        await query(
            "INSERT INTO roi_exports (campaign_id, organization_id, hmac_hash, is_redacted) VALUES ($1, $2, $3, $4)",
            [campaignId, organizationId, hmac, redacted]
        );

        // 5. Public Share variant (Redis storage)
        if (redacted) {
            const shareToken = crypto.randomBytes(16).toString('hex');
            await redis.setex(`share:roi:${shareToken}`, 60 * 60 * 24 * 30, pdfBuffer.toString('base64'));
            return res.json({ 
                shareUrl: `/share/roi/${shareToken}`,
                hmac,
                expires: '30 days'
            });
        }

        // 6. Stream Full Report
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="netjana-roi-${campaignId}.pdf"`);
        res.send(pdfBuffer);

    } catch (error: any) {
        console.error(`[ROIExport] Error:`, error.message);
        res.status(500).json({ error: "ExportFailed", message: error.message });
    }
});

export default router;
