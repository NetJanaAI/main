import Redis from 'ioredis';
import { query, initDb } from '../src/lib/database';

/**
 * One-time migration script for Phase 2: Postgres Entity Registry.
 * Extracts existing 'org:*' hashes from local Redis and seeds org_registry.
 * 
 * Usage: npx ts-node scripts/migrate-entities.ts
 */

async function main() {
    console.log('[Migration] Starting entity migration from Redis to Postgres...');
    const redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
    });

    await initDb();
    const keys = await redis.keys('org:*');
    console.log(`[Migration] Found ${keys.length} entity keys in Redis.`);

    let successCount = 0;
    for (const key of keys) {
        const data = await redis.hgetall(key);
        if (!data.org_id) continue;

        try {
            await query(`
                INSERT INTO org_registry (
                    org_id, canonical_name, geo_state, resolution_method, 
                    first_seen, last_signal_at, signal_count
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (org_id) DO NOTHING
            `, [
                data.org_id,
                data.canonical_name || 'UNKNOWN',
                data.geo_state || 'XX',
                data.resolution_method || 'MIGRATED',
                data.first_seen || new Date().toISOString(),
                data.last_signal_at || new Date().toISOString(),
                parseInt(data.signal_count || '1')
            ]);
            successCount++;
        } catch (e) {
            console.error(`[Migration] Failed for ${data.org_id}:`, (e as Error).message);
        }
    }

    console.log(`[Migration] Successfully migrated ${successCount}/${keys.length} entity records.`);
    redis.disconnect();
    process.exit(0);
}

main().catch(err => {
    console.error('[Migration] CRITICAL FAILURE:', err);
    process.exit(1);
});
