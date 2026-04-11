import { Registry, Counter, Histogram, collectDefaultMetrics } from 'prom-client';
import { scrapeQueue } from './queue';
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
    const health: { status: string; timestamp: string; checks: any[] } = {
        status: 'UP',
        timestamp: new Date().toISOString(),
        checks: []
    };

    // 1. Redis Check (with hard timeout so it never hangs)
    try {
        const client = await scrapeQueue.client;
        await Promise.race([
            client.ping(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Redis ping timeout')), 1500))
        ]);
        health.checks.push({ component: 'Redis', status: 'OK' });
    } catch (e) {
        health.status = 'DEGRADED';
        health.checks.push({ component: 'Redis', status: 'FAIL', error: (e as Error).message });
    }

    // 1.5. Postgres Check
    try {
        await query('SELECT 1');
        health.checks.push({ component: 'Postgres', status: 'OK' });
    } catch (e) {
        health.status = 'DEGRADED';
        health.checks.push({ component: 'Postgres', status: 'FAIL', error: (e as Error).message });
    }

    // 2. Brain Webhook — just mark status, don't block response
    const BRAIN_WEBHOOK_URL = process.env.BRAIN_WEBHOOK_URL || 'http://localhost:4000/api/webhooks/scraper-ingest';
    health.checks.push({ component: 'NetJana Brain Interface', status: 'UNCHECKED', url: BRAIN_WEBHOOK_URL });

    return health;
}

export { register };
