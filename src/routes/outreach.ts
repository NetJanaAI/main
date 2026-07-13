import express from 'express';
import { outreachQueue } from '../lib/queue';
import { UsageTracker } from '../standalone/services/UsageTracker';
import { featureGate } from '../standalone/middleware/featureGate';
import { IS_STANDALONE } from '../config/mode';
import { OutreachDispatcher } from '../core/outreach/OutreachDispatcher';
import { query, queryWithOrg } from '../lib/database';

const router = express.Router();

/**
 * P0-C / P1-A: Returns the configuration status of all outreach channels.
 * GET /api/outreach/channels/status
 *
 * Frontend uses this to decide whether to show a "Send" button, "Coming Soon" badge,
 * or "Copy to clipboard" action for each channel. Avoids surfacing broken auto-send UI.
 *
 * Response example:
 *   { "EMAIL": { "configured": true, "mode": "live" },
 *     "WABA":  { "configured": false, "mode": "stub" },
 *     "LINKEDIN": { "configured": false, "mode": "copy_only" } }
 */
router.get('/channels/status', (req, res) => {
    res.json(OutreachDispatcher.getChannelStatuses());
});


/**
 * Trigger outreach generation for a lead.
 * POST /api/lead/:id/generate-outreach
 */
router.post('/:id/generate-outreach', featureGate, async (req, res) => {
    try {
        const leadId = req.params.id;
        const tone = req.query.tone as string || 'direct';
        const organizationId = (req as any).organizationId || (req as any).user?.organizationId;

        if (!organizationId) return res.status(401).json({ error: "Unauthorized" });

        // 1. Freemium Usage Check
        if (IS_STANDALONE) {
            const usage = await UsageTracker.increment(organizationId, 'outreach_generations');
            if (usage.limitReached) {
                return res.status(402).json({
                    error: "FreeLimitReached",
                    feature: "outreach_generations",
                    message: "You have used your 3 free generations for this month. Upgrade to continue."
                });
            }
        }

        // 2. Dispatch to BullMQ
        const job = await outreachQueue.add(`outreach_${leadId}_${Date.now()}`, {
            leadId,
            organizationId,
            tone
        });

        res.json({ 
            status: "processing", 
            jobId: job.id, 
            message: "Adversarial high-verity generation initiated." 
        });

    } catch (error: any) {
        res.status(500).json({ error: "InternalError", message: error.message });
    }
});

/**
 * FLOW-02: GET /api/outreach/approval-queue
 * Returns pending lead approvals for the org. Dashboard polls this to show
 * the "Approve & Send" list. Previously written but never read — dead end fixed.
 */
router.get('/approval-queue', async (req, res) => {
    try {
        const organizationId = (req as any).organizationId;
        if (!organizationId) return res.status(401).json({ error: 'Unauthorized' });

        const result = await queryWithOrg(`
            SELECT aq.id, aq.lead_id, aq.status, aq.created_at,
                   lc.company_name, lc.intent_score, lc.decay_score,
                   lc.card_why_now, lc.card_what_they_need, lc.card_do_this,
                   lc.buying_stage, lc.sector
            FROM approval_queue aq
            JOIN lead_cards lc ON lc.lead_id = aq.lead_id
            WHERE aq.organization_id = $1 AND aq.status = 'PENDING'
            ORDER BY lc.intent_score DESC, aq.created_at ASC
            LIMIT 50
        `, [organizationId], organizationId);

        res.json({ queue: result.rows, count: result.rows.length });
    } catch (error: any) {
        res.status(500).json({ error: 'InternalError', message: error.message });
    }
});

/**
 * FLOW-02: POST /api/outreach/:id/approve
 * Approves a lead card and immediately enqueues it for outreach generation.
 * This closes the loop: approval_queue → outreachQueue → OutreachWorker → dispatch.
 */
router.post('/:id/approve', async (req, res) => {
    try {
        const leadId = req.params.id;
        const organizationId = (req as any).organizationId;
        const { tone = 'direct' } = req.body || {};

        if (!organizationId) return res.status(401).json({ error: 'Unauthorized' });

        // Mark as approved in the queue
        await queryWithOrg(
            `UPDATE approval_queue
             SET status = 'APPROVED', approver_id = $1
             WHERE lead_id = $2 AND organization_id = $3 AND status = 'PENDING'`,
            [(req as any).auth?.userId || 'manual', leadId, organizationId],
            organizationId
        );

        // Enqueue outreach generation immediately
        const job = await outreachQueue.add(`outreach_approved_${leadId}_${Date.now()}`, {
            leadId,
            organizationId,
            tone,
            triggeredBy: 'approval'
        });

        res.json({
            status: 'approved_and_queued',
            leadId,
            jobId: job.id,
            message: 'Lead approved. Outreach generation queued.'
        });
    } catch (error: any) {
        res.status(500).json({ error: 'InternalError', message: error.message });
    }
});

export default router;
