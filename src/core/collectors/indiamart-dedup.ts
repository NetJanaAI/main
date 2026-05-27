import crypto from 'crypto';
import { cache } from '../../lib/cache';
import { scrapeQueue } from '../../lib/queue';
import { v4 as uuidv4 } from 'uuid';

const DEDUP_TTL_SECONDS = 2592000; // 30 days
const DEDUP_PREFIX = 'seen:indiamart:';

export async function isIndiaMArtDuplicate(lead: any): Promise<boolean> {
    // Layer 1: IndiaMART's own query_id (most reliable)
    // Mapping query_id if it comes as QUERY_ID
    const qid = lead.query_id || lead.QUERY_ID;
    if (qid) {
        const key = `${DEDUP_PREFIX}qid:${qid}`;
        // Upstash opts: { ex: seconds, nx: true }
        const seen = await cache.set(key, '1', { ex: DEDUP_TTL_SECONDS, nx: true });
        if (!seen) {
            console.debug('[DEDUP] HIT query_id', { query_id: qid });
            return true; // already seen
        }
        return false; // new
    }

    // Layer 2: No query_id — build content fingerprint
    const fingerprint = buildContentFingerprint(lead);
    const key = `${DEDUP_PREFIX}fp:${fingerprint}`;
    const seen = await cache.set(key, '1', { ex: DEDUP_TTL_SECONDS, nx: true });

    if (!seen) {
        console.debug('[DEDUP] HIT fingerprint', { fingerprint });
        return true;
    }
    return false;
}

function buildContentFingerprint(lead: any): string {
    const message = lead.query_message || lead.QUERY_MESSAGE || 'nomessage';
    const mobile = lead.sender_mobile || lead.MOBILE || 'nomobile';
    const category = lead.query_product_name || lead.PRODUCT_CATEGORY || 'nocat';

    const parts = [
        mobile.replace(/(\+91|\s|-)/g, '').slice(-10),
        message.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().slice(0, 60),
        category.toLowerCase().replace(/[^a-z0-9]/g, '')
    ];

    return crypto
        .createHash('sha256')
        .update(parts.join('|'))
        .digest('hex')
        .slice(0, 16);
}

export async function safeQueueIndiaMARTLead(lead: any, organizationId: string): Promise<void> {
    const isDuplicate = await isIndiaMArtDuplicate(lead);
    const today = new Date().toISOString().slice(0, 10);

    if (isDuplicate) {
        await cache.incr(`stats:dedup:indiamart:${today}`);
        return; // silently skip
    }

    // Create a normalized ingestion job for the worker pipeline
    const ingestJobId = uuidv4();
    await scrapeQueue.add('ingest_registry_signal', {
        jobId: ingestJobId,
        source: 'IndiaMART',
        type: 'BUYER_INTENT',
        rawPayload: lead,
        organizationId
    }, { jobId: ingestJobId });

    console.log(`[Collector] New IndiaMART Lead queued for ingestion: ${lead.query_id || lead.QUERY_ID} -> Job: ${ingestJobId}`);

    await cache.incr(`stats:queued:indiamart:${today}`);
}

export async function getDedupStats(days = 7): Promise<any[]> {
    const stats = [];
    for (let i = 0; i < days; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);

        const [queued, duped] = await Promise.all([
            cache.get<string>(`stats:queued:indiamart:${key}`),
            cache.get<string>(`stats:dedup:indiamart:${key}`),
        ]);

        const q = parseInt(queued || '0');
        const dp = parseInt(duped || '0');
        stats.push({
            date: key,
            queued: q,
            duplicates: dp,
            dedup_rate: q + dp > 0 ? `${Math.round(dp / (q + dp) * 100)}%` : '0%',
        });
    }
    return stats;
}
