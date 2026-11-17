import { query } from './database';
import { getSharedRedisClient } from './redis';
import { scrapeQueue } from './queue';

export class QuotaExceededError extends Error {
    constructor(public limit: number, public used: number) {
        super(`Scrape quota exhausted: ${used} of ${limit} used this month.`);
    }
}

function monthKey(organizationId: string): string {
    const now = new Date();
    return `quota:${organizationId}:scrapes:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function secondsToNextMonth(): number {
    const now = new Date();
    return Math.floor((new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime() - now.getTime()) / 1000);
}

/**
 * Queues a scrape for the tenant, counting it against tenants.quota_limit for the month.
 * The slot is reserved with an atomic increment before the job is queued, so concurrent
 * requests cannot overshoot the limit, and it is given back if the job is not queued.
 */
export async function enqueueScrape(
    organizationId: string,
    data: Record<string, unknown>,
    opts?: { jobId?: string }
): Promise<void> {
    const tenant = await query('SELECT quota_limit FROM tenants WHERE id = $1', [organizationId]);
    if (tenant.rows.length === 0) throw new Error(`Tenant not found: ${organizationId}`);
    const limit = Number(tenant.rows[0].quota_limit);

    const redis = getSharedRedisClient();
    const key = monthKey(organizationId);
    const used = await redis.incr(key);
    if (used === 1) await redis.expire(key, secondsToNextMonth());

    if (used > limit) {
        await redis.decr(key);
        throw new QuotaExceededError(limit, used - 1);
    }
    try {
        await scrapeQueue.add('scrape', data, opts);
    } catch (e) {
        await redis.decr(key);
        throw e;
    }
}
