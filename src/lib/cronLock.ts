import { getSharedRedisClient } from './redis';

/**
 * Every instance registers every cron, so each tick fires once per instance. The first instance to
 * take the lock for a tick runs the job; the others skip it. The lock expires on its own and is not
 * released, so a late instance cannot run the same tick again. If Redis is unreachable the tick is
 * skipped: a missed run is cheaper than every instance running it.
 */
export async function runOnce(name: string, ttlSeconds: number, job: () => Promise<void>): Promise<void> {
    try {
        const locked = await getSharedRedisClient().set(`lock:cron:${name}`, '1', 'EX', ttlSeconds, 'NX');
        if (locked !== 'OK') return;
    } catch (err: any) {
        console.warn(`[Scheduler] Skipping ${name}: lock unavailable (${err.message})`);
        return;
    }
    await job();
}
