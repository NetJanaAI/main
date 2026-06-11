import express from 'express';
import { outreachQueue } from '../lib/queue';
import { UsageTracker } from '../standalone/services/UsageTracker';
import { featureGate } from '../standalone/middleware/featureGate';
import { IS_STANDALONE } from '../config/mode';
import { OutreachDispatcher } from '../core/outreach/OutreachDispatcher';

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

export default router;
