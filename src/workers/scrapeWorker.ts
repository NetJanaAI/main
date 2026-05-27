import { Worker, Job } from 'bullmq';
import { connection, SCRAPE_QUEUE_NAME, getRegionalQueueName } from '../lib/queue';
import { scrapeB2BSignals } from '../engines/b2bScraper';
import { Server } from 'socket.io';
import os from 'os';
import Redis from 'ioredis';
import { db } from '../lib/database';
import { cache } from '../lib/cache';

const redis = new Redis(connection as any);

const MIN_FREE_MEMORY_MB = 128; // Scraper specific safety floor

export function setupScrapeWorker(io?: Server | null) {
    const queueName = getRegionalQueueName(SCRAPE_QUEUE_NAME);
    const pub = new Redis(connection as any);
    const writeHeartbeat = async (status = 'OK') => {
        try {
            await db.query(`
                INSERT INTO system_canaries (type, status, last_heartbeat, metadata, updated_at)
                VALUES ('SCRAPE_WORKER', $1, NOW(), $2, NOW())
                ON CONFLICT (type)
                DO UPDATE SET status = EXCLUDED.status, last_heartbeat = NOW(), metadata = EXCLUDED.metadata, updated_at = NOW()
            `, [status, JSON.stringify({ queueName, pid: process.pid })]);
        } catch (e: any) {
            console.warn('[Worker] Failed to write scrape worker heartbeat:', e.message);
        }
    };

    const worker = new Worker(queueName, async (job: Job) => {
        const { url, forceFailure, useOnlineAI, jobId, spiderMode, maxPages, organizationId } = job.data;
        const orgId = organizationId || 'default';

        console.log(`[Worker] Processing Job ${jobId} for ${url} (Spider: ${spiderMode})`);

        // 0. Enforcement: Source Autonomy for Web Scraper
        const cacheKey = `sources:${orgId}`;
        let enabledSources: string[] | null = null;
        const cached = await redis.get(cacheKey);

        if (cached) {
            enabledSources = JSON.parse(cached);
        } else {
            const results = await db.query(
                `SELECT source_id FROM source_configs WHERE org_id = $1 AND is_enabled = TRUE`,
                [orgId]
            );
            enabledSources = results.rows.map(r => r.source_id);
            if (enabledSources.length === 0) {
                enabledSources = ['indiamart', 'gem', 'mca', 'zauba', 'webscrape', 'funding', 'naukri', 'rera', 'parivesh'];
            }
            await redis.setex(cacheKey, 3600, JSON.stringify(enabledSources));
        }

        if (!enabledSources!.includes('webscrape')) {
            console.warn(`[Worker] Web Scraper node is DISABLED for org ${orgId}. Rejecting job ${jobId}.`);
            throw new Error(`Web Scraper node is currently disabled in your dashboard.`);
        }

        // Runtime Memory Guard
        const freeMem = os.freemem() / (1024 * 1024);
        if (freeMem < MIN_FREE_MEMORY_MB) {
            console.error(`[Worker] Memory pressure too high (${Math.floor(freeMem)}MB). Rejecting job.`);
            throw new Error(`Insufficient memory to start browser at runtime.`);
        }

        // Implement global job timeout to prevent zombie scrapes
        let jobTimeout: NodeJS.Timeout;
        const timeoutPromise = new Promise<never>((_, reject) =>
            jobTimeout = setTimeout(() => reject(new Error(`Job ${jobId} timed out after 60s.`)), 60_000)
        );

        try {
            const result = await Promise.race([
                scrapeB2BSignals(
                    url,
                    2,
                    (message: string, type: string) => {
                        const payload = {
                            event: 'log',
                            data: {
                                jobId,
                                message,
                                type,
                                timestamp: new Date().toISOString()
                            }
                        };
                        pub.publish('worker_events', JSON.stringify(payload));

                        // Fallback local emit if running coupled
                        if (io) {
                            io.emit('log', payload.data);
                        }
                    },
                    forceFailure,
                    useOnlineAI,
                    jobId,
                    spiderMode,
                    maxPages || 5,
                    '', // intent
                    false, // hunterMode
                    organizationId
                ),
                timeoutPromise
            ]);

            clearTimeout(jobTimeout!);

            const completePayload = { jobId, status: 'success', result };
            pub.publish('worker_events', JSON.stringify({ event: 'complete', data: completePayload }));

            if (io) {
                io.emit('complete', completePayload);
            }

            return result;
        } catch (err) {
            clearTimeout(jobTimeout!);
            throw err;
        }
    }, {
        connection,
        concurrency: 2,
        lockDuration: 60000
    });

    worker.on('completed', (job) => {
        console.log(`[Worker] Job ${job.id} completed successfully.`);
        writeHeartbeat('OK').catch(() => {});
    });

    worker.on('failed', (job, err) => {
        console.error(`[Worker] Job ${job?.id} failed:`, err.message);
        writeHeartbeat('DEGRADED').catch(() => {});
        if (job) {
            const errorPayload = { jobId: job.data.jobId, error: err.message };
            pub.publish('worker_events', JSON.stringify({ event: 'error', data: errorPayload }));
            if (io) {
                io.emit('error', errorPayload);
            }
        }
    });

    console.log('[Worker] Scrape Worker started and listening for jobs.');
    writeHeartbeat('OK').catch(() => {});
    setInterval(() => writeHeartbeat('OK').catch(() => {}), 60_000);
}
