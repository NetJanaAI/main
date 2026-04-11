import { Router, Request } from 'express';
import { Server } from 'socket.io';
import { ScrapeRequestSchema } from '../lib/schemas';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';

const router = Router();

interface RequestWithSocket extends Request {
    io: Server;
}

import { scrapeQueue, SCRAPE_QUEUE_NAME, getRegionalQueueName, connection } from '../lib/queue';
import { Queue } from 'bullmq';
import { ProxyManager } from '../lib/stealth/ProxyManager';

const MIN_FREE_MEMORY_MB = 256;

router.post('/scrape', async (req, res) => {
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

    // Memory Guard: Check available RAM
    const freeMemoryMB = os.freemem() / (1024 * 1024);
    if (freeMemoryMB < MIN_FREE_MEMORY_MB) {
        return res.status(503).json({
            error: 'Insufficient system memory.',
            freeMemoryMB: Math.floor(freeMemoryMB)
        });
    }

    // 2. Regional Routing Logic
    const jobId = uuidv4();
    const region = ProxyManager.getProxyForRegion(url)?.region || 'GLOBAL';
    const regionalQueueName = getRegionalQueueName(SCRAPE_QUEUE_NAME, region);
    
    // Create a temporary queue instance to push to the correct regional channel
    // In a high-volume prod, we'd cache these instances
    const targetQueue = new Queue(regionalQueueName, { connection });

    // Enqueue Job for Persistent Execution
    await targetQueue.add('scrape', {
        jobId,
        url,
        forceFailure,
        useOnlineAI,
        spiderMode,
        maxPages,
        organizationId,
        region
    }, { jobId });

    await targetQueue.close();

    console.log(`[API] Scrape Enqueued for ${url} (Job ID: ${jobId})`);

    res.json({ message: 'Scrape job enqueued', jobId });
});

// Job Status Endpoint
router.get('/status/:jobId', async (req, res) => {
    const { jobId } = req.params;
    const job = await scrapeQueue.getJob(jobId);

    if (!job) {
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
