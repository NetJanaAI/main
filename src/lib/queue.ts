import { Queue, ConnectionOptions } from 'bullmq';

const REDIS_URL = process.env.REDIS_URL;
let REDIS_HOST = process.env.REDIS_HOST || 'localhost';
let REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');

if (REDIS_URL) {
    try {
        const url = new URL(REDIS_URL);
        REDIS_HOST = url.hostname;
        REDIS_PORT = parseInt(url.port) || 6379;
    } catch (e) {
        console.warn('[Queue] Failed to parse REDIS_URL, falling back to defaults.');
    }
}

export const connection: ConnectionOptions = {
    host: REDIS_HOST,
    port: REDIS_PORT,
    maxRetriesPerRequest: null, // Critical for BullMQ
    enableOfflineQueue: false,   // Fail fast when Redis is down instead of queuing
    lazyConnect: true,           // Don't connect until first command — avoids startup spam
};

// BullMQ Will Fail in Any Cloud Redis FIX: Add TLS if protocol is rediss://
if (REDIS_URL && REDIS_URL.startsWith('rediss://')) {
    connection.tls = { rejectUnauthorized: false };
}

export const SCRAPE_QUEUE_NAME = 'b2b-scrapes';
export const INFLUENCE_QUEUE_NAME = 'influence-map-enrichment';
export const RAW_SIGNALS_QUEUE_NAME = 'raw_signals';
export const TIER1_QUEUE_NAME = 'tier1_queue';
export const TIER2_QUEUE_NAME = 'tier2_queue';
export const TIER3_QUEUE_NAME = 'tier3_queue';
export const OUTREACH_QUEUE_NAME = 'outreach_queue';

/**
 * Returns a region-specific queue name.
 * Falls back to global queue if no region is provided or set in ENV.
 */
export function getRegionalQueueName(base: string, region?: string): string {
    const r = region || process.env.REGION_ID;
    return r ? `${base}:${r.toLowerCase()}` : base;
}

export const scrapeQueue = new Queue(SCRAPE_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: false, // Keep failed jobs for audit
    }
});

export const influenceQueue = new Queue(INFLUENCE_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: true,
        removeOnFail: false
    }
});

export const rawSignalsQueue = new Queue(RAW_SIGNALS_QUEUE_NAME, {
    connection,
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true }
});

export const tier1Queue = new Queue(TIER1_QUEUE_NAME, {
    connection,
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true }
});

export const tier2Queue = new Queue(TIER2_QUEUE_NAME, {
    connection,
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true }
});

export const tier3Queue = new Queue(TIER3_QUEUE_NAME, {
    connection,
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true }
});

export const outreachQueue = new Queue(OUTREACH_QUEUE_NAME, {
    connection,
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 10000 }, removeOnComplete: true }
});

console.log(`[Queue] Initialized BullMQ on ${REDIS_HOST}:${REDIS_PORT}`);
