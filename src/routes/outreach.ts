import express from 'express';
import { Queue } from 'bullmq';
import { connection } from '../lib/queue';
import { UsageTracker } from '../standalone/services/UsageTracker';
import { featureGate } from '../standalone/middleware/featureGate';
import { IS_STANDALONE } from '../config/mode';

const outreachQueue = new Queue('outreach-tasks', { connection });

const router = express.Router();

/**
 * Trigger outreach generation for a lead.
 * POST /api/lead/:id/generate-outreach
 */
router.post('/:id/generate-outreach', featureGate, async (req, res) => {
    try {
        const leadId = req.params.id;
        const tone = req.query.tone as string || 'direct';
        const organizationId = (req as any).user?.organizationId;

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
