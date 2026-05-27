import { Registry, Counter, Histogram, collectDefaultMetrics } from 'prom-client';
import Redis from 'ioredis';
import { query } from './database';

const register = new Registry();

// Default metrics (CPU, Memory, etc.)
collectDefaultMetrics({ register });

// --- Custom Metrics ---

export const scrapeCount = new Counter({
    name: 'convospan_signal_total',
    help: 'Total number of scrapes initiated',
    labelNames: ['status', 'region'],
    registers: [register]
});

export const scrapeDuration = new Histogram({
    name: 'convospan_ingestion_duration_seconds',
    help: 'Duration of scrapes in seconds',
    labelNames: ['region'],
    buckets: [10, 30, 60, 120, 300],
    registers: [register]
});

export const complianceVetoCount = new Counter({
    name: 'convospan_compliance_veto_total',
    help: 'Total background safety vetoes',
    registers: [register]
});

// --- Health Checks ---

export async function getSystemHealth() {
    const health: { status: string; timestamp: string; mode: any; checks: any[] } = {
        status: 'UP',
        timestamp: new Date().toISOString(),
        mode: {
            nodeEnv: process.env.NODE_ENV || 'development',
            netjanaMode: process.env.NETJANA_MODE || 'unset',
            modelProvider: process.env.GOOGLE_API_KEY ? 'google-gemini' : process.env.OLLAMA_HOST ? 'ollama' : 'demo-fallback',
            redisConfigured: Boolean(process.env.REDIS_URL || process.env.REDIS_HOST),
            databaseConfigured: Boolean(process.env.DATABASE_URL)
        },
        checks: []
    };
    let redisOk = false;

    // 1. Redis Check (with hard timeout so it never hangs)
    try {
        const redisUrl = process.env.REDIS_URL;
        const client = redisUrl
            ? new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 0, enableOfflineQueue: false })
            : new Redis({
                host: process.env.REDIS_HOST || 'localhost',
                port: parseInt(process.env.REDIS_PORT || '6379', 10),
                lazyConnect: true,
                maxRetriesPerRequest: 0,
                enableOfflineQueue: false
            });
        client.on('error', () => {});
        try {
            await Promise.race([
                client.connect().then(() => client.ping()),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Redis ping timeout')), 1500))
            ]);
        } finally {
            client.disconnect();
        }
        health.checks.push({ component: 'Redis', status: 'OK' });
        redisOk = true;
    } catch (e) {
        health.status = 'DEGRADED';
        health.checks.push({ component: 'Redis', status: 'FAIL', error: (e as Error).message });
    }

    // 1.5. Postgres Check
    try {
        await Promise.race([
            query('SELECT 1'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Postgres query timeout')), 1500))
        ]);
        health.checks.push({ component: 'Postgres', status: 'OK' });
    } catch (e) {
        health.status = 'DEGRADED';
        health.checks.push({ component: 'Postgres', status: 'FAIL', error: (e as Error).message });
    }

    // 2. Brain Webhook — just mark status, don't block response
    // 1.75. BullMQ queue depth check
    if (redisOk) try {
        const { rawSignalsQueue, scrapeQueue, tier1Queue, tier2Queue, tier3Queue, outreachQueue, dlqQueue } = await import('./queue');
        const queues = [
            ['scrape', scrapeQueue],
            ['rawSignals', rawSignalsQueue],
            ['tier1', tier1Queue],
            ['tier2', tier2Queue],
            ['tier3', tier3Queue],
            ['outreach', outreachQueue],
            ['dlq', dlqQueue]
        ] as const;

        const depths = await Promise.race([
            Promise.all(queues.map(async ([name, queue]) => {
                const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
                return { name, ...counts };
            })),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Queue depth timeout')), 2000))
        ]);
        health.checks.push({ component: 'BullMQ Queues', status: 'OK', depths });
    } catch (e) {
        health.status = 'DEGRADED';
        health.checks.push({ component: 'BullMQ Queues', status: 'FAIL', error: (e as Error).message });
    } else {
        health.checks.push({ component: 'BullMQ Queues', status: 'SKIPPED', reason: 'Redis unavailable' });
    }

    const BRAIN_WEBHOOK_URL = process.env.BRAIN_WEBHOOK_URL;
    health.checks.push(BRAIN_WEBHOOK_URL
        ? { component: 'NetJana Brain Interface', status: 'UNCHECKED', url: BRAIN_WEBHOOK_URL }
        : { component: 'NetJana Brain Interface', status: 'NOT_CONFIGURED' }
    );

    return health;
}

export { register };
