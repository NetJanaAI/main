import { Router, Request } from 'express';
import { ScrapeRequestSchema } from '../lib/schemas';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';

const router = Router();

import { scrapeQueue } from '../lib/queue';
import { enqueueScrape, QuotaExceededError } from '../lib/quota';

const MIN_FREE_MEMORY_MB = 256;

const handleScrape = async (req: Request, res: any) => {
    // 1. Zod Validation
    const validationResult = ScrapeRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
        return res.status(400).json({
            error: 'Invalid request parameters',
            details: validationResult.error.issues.map(err => ({
                path: err.path.join('.'),
                message: err.message
            }))
        });
    }

    const { url, forceFailure, useOnlineAI, spiderMode, maxPages } = validationResult.data;
    // The tenant is the authenticated one, never a body-supplied id.
    const organizationId = (req as any).organizationId;
    if (!organizationId) return res.status(401).json({ error: 'Unauthorized' });

    // Memory Guard: Check available RAM
    const freeMemoryMB = os.freemem() / (1024 * 1024);
    if (freeMemoryMB < MIN_FREE_MEMORY_MB) {
        return res.status(503).json({
            error: 'Insufficient system memory.',
            freeMemoryMB: Math.floor(freeMemoryMB)
        });
    }

    const jobId = uuidv4();

    // Enqueue Job for Persistent Execution
    try {
        await enqueueScrape(organizationId, {
            jobId,
            url,
            forceFailure,
            useOnlineAI,
            spiderMode,
            maxPages,
            organizationId
        }, { jobId });
    } catch (e) {
        if (e instanceof QuotaExceededError) {
            return res.status(429).json({
                error: 'Scrape quota exhausted',
                message: 'Your organization has used its scrapes for this month. Upgrade your plan or wait for the quota to reset.',
                limit: e.limit,
                used: e.used
            });
        }
        throw e;
    }

    console.log(`[API] Scrape Enqueued for ${url} (Job ID: ${jobId})`);

    res.json({ message: 'Scrape job enqueued', jobId });
};

router.post('/', handleScrape);
router.post('/scrape', handleScrape);

// Job Status Endpoint
router.get('/status/:jobId', async (req, res) => {
    const { jobId } = req.params;
    const organizationId = (req as any).organizationId;
    if (!organizationId) return res.status(401).json({ error: 'Unauthorized' });

    const job = await scrapeQueue.getJob(jobId);

    // Another tenant's job (or a legacy one with no stored tenant) is indistinguishable from a missing one.
    if (!job || job.data?.organizationId !== organizationId) {
        return res.status(404).json({ error: 'Job not found' });
    }

    const state = await job.getState();
    const progress = job.progress;
    const result = job.returnvalue;
    const failedReason = job.failedReason;

    res.json({
        jobId,
        state,
        progress,
        result,
        error: failedReason
    });
});

export default router;
