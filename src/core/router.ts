import { Worker, Job } from 'bullmq';
import { connection, RAW_SIGNALS_QUEUE_NAME, tier1Queue, tier2Queue, tier3Queue } from '../lib/queue';
import { resolveEntity } from './entity-resolver';
import { KnowledgeGraphService } from './knowledge-graph';
import Redis from 'ioredis';
import { RawSignal } from '../lib/schemas';

const redis = new Redis(connection as any);
redis.on('error', (err) => {
    if ((redis as any)._lastErrorLogged !== err.message) {
        console.warn(`[Router] Waiting for Redis: ${err.message}`);
        (redis as any)._lastErrorLogged = err.message;
    }
});

/**
 * Checks if a data source is enabled for an organization.
 * Optimized with organization-level source caching.
 */
async function isSourceEnabled(orgId: string, sourceId: string): Promise<boolean> {
    const cacheKey = `sources:${orgId}`;
    let enabledSources: string[] | null = null;
    
    const cached = await redis.get(cacheKey);
    if (cached) {
        enabledSources = JSON.parse(cached);
    } else {
        const { db } = await import('../lib/database');
        const results = await db.query(
            `SELECT source_id FROM source_configs WHERE org_id = $1 AND is_enabled = TRUE`,
            [orgId]
        );
        enabledSources = results.rows.map(r => r.source_id);
        // Default to all enabled if no config found (Phase 1 behavior)
        if (enabledSources.length === 0) {
            enabledSources = ['indiamart', 'gem', 'mca', 'zauba', 'webscrape', 'funding', 'naukri', 'rera', 'parivesh'];
        }
        await redis.setex(cacheKey, 3600, JSON.stringify(enabledSources));
    }

    // Adapt source_id (e.g. IndiaMART -> indiamart)
    const normalizedSource = sourceId.toLowerCase().split('_')[0].split(' ')[0];
    return enabledSources!.includes(normalizedSource);
}

export function setupRouterWorker() {
    const worker = new Worker(RAW_SIGNALS_QUEUE_NAME, async (job: Job) => {
        const signal: RawSignal = job.data;

        // 1. Resolve Entity
        const org_id = await resolveEntity(signal.company_name_clean, signal.geo_state, signal.cin, signal.company_name_raw, signal.source_id, signal.geo_market);

        // 1.1 Enforcement: Source Autonomy
        const enabled = await isSourceEnabled(org_id, signal.source_id);
        if (!enabled) {
            console.log(`[Router] Source ${signal.source_id} is DISABLED for org ${org_id}. Discarding signal ${signal.signal_id}.`);
            await redis.lpush('router_log', JSON.stringify({
                signal_id: signal.signal_id,
                org_id,
                status: 'source_disabled',
                source: signal.source_id,
                timestamp: new Date().toISOString()
            }));
            return { status: 'discarded', reason: 'source_disabled' };
        }

        // 1.1 Sync Knowledge Graph
        await KnowledgeGraphService.syncSignal(signal, org_id);

        // 2. Recent Signals & Check Corroboration
        const recentKey = `org:${org_id}:recent_signals`;
        const nowMs = Date.now();
        // Triangulation timeline is extended to 14 days (14 * 24 * 60 * 60 * 1000)
        const windowMs = 14 * 24 * 60 * 60 * 1000;

        const pipeline = redis.pipeline();
        pipeline.zremrangebyscore(recentKey, '-inf', nowMs - windowMs);
        pipeline.zadd(recentKey, nowMs, `${signal.signal_id}|${signal.source_id}`);
        pipeline.expire(recentKey, 14 * 24 * 60 * 60);
        pipeline.zrange(recentKey, 0, -1);
        const results = await pipeline.exec();

        // The last pipeline result is the zrange output
        const recentEntriesStr: string[] = results && results[3] && results[3][1] ? (results[3][1] as string[]) : [];
        const sourceIds = new Set<string>();

        for (const entry of recentEntriesStr) {
            const parts = entry.split('|');
            if (parts.length >= 2) {
                sourceIds.add(parts[1]);
            }
        }

        const is_triangulated = sourceIds.size >= 2;
        const triangulated_sources = Array.from(sourceIds);

        // Track raw payloads for synthesis
        await redis.setex(`signal_ctx:${signal.signal_id}`, 14 * 24 * 60 * 60, JSON.stringify(signal.raw_payload).substring(0, 300));
        await redis.lpush(`org:${org_id}:ctx_history`, signal.signal_id);
        await redis.ltrim(`org:${org_id}:ctx_history`, 0, 4); // Keep last 5 contexts

        // Update the signal record to hold triangulation state
        signal.is_triangulated = is_triangulated;
        signal.triangulated_sources = triangulated_sources;

        // 3. Queue job data structure
        const routedJobData = {
            signal,
            org_id,
            is_triangulated,
            triangulated_sources,
            routed_at: new Date().toISOString()
        };

        // 4. Route to correct queue
        let targetQueue;
        let queueName = '';
        if (signal.source_tier === 'TIER_1') {
            targetQueue = tier1Queue; queueName = 'tier1_queue';
        } else if (signal.source_tier === 'TIER_2') {
            targetQueue = tier2Queue; queueName = 'tier2_queue';
        } else {
            targetQueue = tier3Queue; queueName = 'tier3_queue';
        }

        await targetQueue.add('process_tier', routedJobData, { jobId: signal.signal_id });

        // 5. Log routing decision
        const logEntry = JSON.stringify({
            signal_id: signal.signal_id,
            org_id,
            tier: signal.source_tier,
            is_triangulated,
            timestamp: routedJobData.routed_at
        });

        const logPipeline = redis.pipeline();
        logPipeline.lpush('router_log', logEntry);
        logPipeline.ltrim('router_log', 0, 499); // Max 500 entries
        await logPipeline.exec();

        return { routedTo: queueName, org_id, is_triangulated };
    }, {
        connection,
        concurrency: 5 // Default for processing many raw signals
    });

    worker.on('failed', (job, err) => {
        console.error(`[RouterWorker] Job ${job?.id} failed:`, err.message);
    });

    console.log('[RouterWorker] Listening on raw_signals queue');
}
