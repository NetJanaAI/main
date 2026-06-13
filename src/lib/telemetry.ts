import { Registry, Counter, Histogram, collectDefaultMetrics } from 'prom-client';
import Redis from 'ioredis';
import { query } from './database';
import axios from 'axios';

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

export const llmCallDuration = new Histogram({
    name: 'llm_call_duration_seconds',
    help: 'Duration of LLM calls in seconds',
    labelNames: ['role', 'model'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 20],
    registers: [register]
});

// --- Health Checks ---

export async function getSystemHealth() {
    const isProduction = process.env.NODE_ENV === 'production';
    const modelProvider = process.env.GOOGLE_API_KEY ? 'google-gemini' : process.env.OLLAMA_HOST ? 'ollama' : 'demo-fallback';
    const health: { status: string; timestamp: string; mode: any; checks: any[] } = {
        status: 'UP',
        timestamp: new Date().toISOString(),
        mode: {
            nodeEnv: process.env.NODE_ENV || 'development',
            netjanaMode: process.env.NETJANA_MODE || 'unset',
            role: process.env.ROLE || 'unset',
            modelProvider,
            redisConfigured: Boolean(process.env.REDIS_URL || process.env.REDIS_HOST),
            databaseConfigured: Boolean(process.env.DATABASE_URL)
        },
        checks: []
    };
    const markDegraded = (component: string, error: string, metadata?: Record<string, unknown>) => {
        health.status = 'DEGRADED';
        health.checks.push({ component, status: 'FAIL', error, ...(metadata || {}) });
    };
    let redisOk = false;

    // 0. Production configuration checks.
    if (isProduction) {
        const requiredEnv = [
            'DATABASE_URL',
            'REDIS_URL',
            'CLERK_SECRET_KEY',
            'HMAC_SECRET',
            'ALLOWED_ORIGINS',
            'ALLOWED_INGEST_IPS'
        ];
        const missing = requiredEnv.filter(name => !process.env[name]);

        if (modelProvider === 'demo-fallback') {
            missing.push('GOOGLE_API_KEY or OLLAMA_HOST');
        }

        if (missing.length > 0) {
            markDegraded('Production Config', `Missing required production configuration: ${missing.join(', ')}`, { missing });
        } else {
            health.checks.push({ component: 'Production Config', status: 'OK' });
        }
    } else {
        health.checks.push({ component: 'Production Config', status: 'SKIPPED', reason: 'Non-production runtime' });
    }

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
        markDegraded('Redis', (e as Error).message);
    }

    // 1.25 Model provider reachability. This catches container networking issues
    // where OLLAMA_HOST is set but points somewhere unreachable from Docker.
    if (process.env.OLLAMA_HOST) {
        try {
            await Promise.race([
                axios.get(`${process.env.OLLAMA_HOST.replace(/\/$/, '')}/api/tags`, { timeout: 1500 }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Ollama probe timeout')), 1800))
            ]);
            health.checks.push({ component: 'Model Provider', status: 'OK', provider: 'ollama' });
        } catch (e) {
            markDegraded('Model Provider', `Ollama unreachable: ${(e as Error).message}`, { provider: 'ollama' });
        }
    } else if (process.env.GOOGLE_API_KEY) {
        health.checks.push({ component: 'Model Provider', status: 'OK', provider: 'google-gemini', probe: 'configured' });
    } else {
        const status = isProduction ? 'FAIL' : 'SKIPPED';
        if (isProduction) {
            markDegraded('Model Provider', 'No production model provider configured');
        } else {
            health.checks.push({ component: 'Model Provider', status, provider: 'demo-fallback' });
        }
    }

    if (process.env.COMPLIANCE_LEGAL_LLM_REQUIRED === 'false' && !isProduction) {
        health.checks.push({
            component: 'Compliance Sentinel',
            status: 'BYPASS_DEV_ONLY',
            reason: 'Legal LLM fail-open is explicitly enabled for local Docker smoke tests'
        });
    } else {
        health.checks.push({
            component: 'Compliance Sentinel',
            status: 'FAIL_CLOSED',
            legalLlmRequired: true
        });
    }

    // 1.5. Postgres Check
    try {
        await Promise.race([
            query('SELECT 1'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Postgres query timeout')), 1500))
        ]);
        health.checks.push({ component: 'Postgres', status: 'OK' });
    } catch (e) {
        markDegraded('Postgres', (e as Error).message);
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
        ]) as any[];
        health.checks.push({ component: 'BullMQ Queues', status: 'OK', depths });
    } catch (e) {
        markDegraded('BullMQ Queues', (e as Error).message);
    } else {
        health.checks.push({ component: 'BullMQ Queues', status: 'SKIPPED', reason: 'Redis unavailable' });
    }

    // 1.9 Worker heartbeat readiness. API-only deployments rely on a separate
    // scraper worker; if it is absent, scrape jobs can be accepted but never run.
    try {
        const expectedWorkers = process.env.ROLE === 'api_only' ? ['SCRAPE_WORKER'] : [];
        if (expectedWorkers.length === 0) {
            health.checks.push({ component: 'Worker Heartbeats', status: 'SKIPPED', reason: 'Local worker mode' });
        } else {
            const result = await Promise.race([
                query(
                    `SELECT type, status, last_heartbeat, metadata
                     FROM system_canaries
                     WHERE type = ANY($1::text[])`,
                    [expectedWorkers]
                ),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Worker heartbeat query timeout')), 1500))
            ]) as Awaited<ReturnType<typeof query>>;

            const rowsByType = new Map(result.rows.map(row => [row.type, row]));
            const now = Date.now();
            const staleAfterMs = 5 * 60 * 1000;
            const workers = expectedWorkers.map(type => {
                const row = rowsByType.get(type);
                const ageMs = row?.last_heartbeat ? now - new Date(row.last_heartbeat).getTime() : null;
                return {
                    type,
                    status: row?.status || 'MISSING',
                    lastHeartbeat: row?.last_heartbeat || null,
                    ageMs
                };
            });

            const unhealthy = workers.filter(worker =>
                worker.status !== 'OK' ||
                worker.ageMs === null ||
                worker.ageMs > staleAfterMs
            );

            if (unhealthy.length > 0) {
                markDegraded('Worker Heartbeats', 'Required worker heartbeat is missing or stale', { workers });
            } else {
                health.checks.push({ component: 'Worker Heartbeats', status: 'OK', workers });
            }
        }
    } catch (e) {
        markDegraded('Worker Heartbeats', (e as Error).message);
    }

    const BRAIN_WEBHOOK_URL = process.env.BRAIN_WEBHOOK_URL;
    health.checks.push(BRAIN_WEBHOOK_URL
        ? { component: 'NetJana Brain Interface', status: 'UNCHECKED', url: BRAIN_WEBHOOK_URL }
        : { component: 'NetJana Brain Interface', status: 'NOT_CONFIGURED' }
    );

    return health;
}

export { register };
