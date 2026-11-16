import { Router, Request } from 'express';
import { Server } from 'socket.io';
import { ScrapeRequestSchema } from '../lib/schemas';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';

const router = Router();

interface RequestWithSocket extends Request {
    io: Server;
}

import { scrapeQueue } from '../lib/queue';

const MIN_FREE_MEMORY_MB = 256;

const enqueueScrape = async (req: Request, res: any) => {
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

    const { url, forceFailure, useOnlineAI, spiderMode, maxPages, organizationId } = validationResult.data;
    const effectiveOrganizationId = (req as any).organizationId || organizationId;

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
    await scrapeQueue.add('scrape', {
        jobId,
        url,
        forceFailure,
        useOnlineAI,
        spiderMode,
        maxPages,
        organizationId: effectiveOrganizationId
    }, { jobId });

    console.log(`[API] Scrape Enqueued for ${url} (Job ID: ${jobId})`);

    res.json({ message: 'Scrape job enqueued', jobId });
};

router.post('/', enqueueScrape);
router.post('/scrape', enqueueScrape);

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
