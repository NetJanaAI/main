import * as cron from 'node-cron';
import { scrapeQueue } from './queue';
import { query } from './database';
import { Queue } from 'bullmq';

const redisHost = process.env.REDIS_HOST || 'localhost';
const decayQueue = new Queue('decay-rescore', { connection: { host: redisHost, port: 6379 } });

type ScheduleEntry = {
    id: string;
    domain: string;
    cron_expression: string;
    use_online_ai: boolean;
    spider_mode: boolean;
    max_pages: number;
    organization_id: string | null;
};

// In-memory registry of active cron tasks
const activeTasks = new Map<string, cron.ScheduledTask>();

/**
 * Register a new domain scrape cron job.
 */
export function addSchedule(entry: ScheduleEntry) {
    // Cancel any existing schedule for this domain before re-registering
    removeSchedule(entry.domain);

    if (!cron.validate(entry.cron_expression)) {
        console.warn(`[Scheduler] Invalid cron expression for ${entry.domain}: "${entry.cron_expression}"`);
        return;
    }

    const task = cron.schedule(entry.cron_expression, async () => {
        console.log(`[Scheduler] Auto-triggering scrape for ${entry.domain} (cron: ${entry.cron_expression})`);
        try {
            const { v4: uuidv4 } = await import('uuid');
            const jobId = uuidv4();
            await scrapeQueue.add('scrape', {
                jobId,
                url: `https://${entry.domain}`,
                useOnlineAI: entry.use_online_ai,
                spiderMode: entry.spider_mode,
                maxPages: entry.max_pages,
                organizationId: entry.organization_id
            }, { jobId });

            // Update last_run timestamp
            await query(`UPDATE scrape_schedules SET last_run = NOW() WHERE domain = $1`, [entry.domain]);
            console.log(`[Scheduler] Enqueued scheduled scrape for ${entry.domain} (Job: ${jobId})`);
        } catch (err: any) {
            console.error(`[Scheduler] Failed to enqueue scheduled scrape for ${entry.domain}:`, err.message);
        }
    }, { timezone: 'Asia/Kolkata' }); // IST by default, configurable

    activeTasks.set(entry.domain, task);
    console.log(`[Scheduler] Registered schedule for ${entry.domain} (${entry.cron_expression})`);
}

/**
 * Remove a domain's schedule.
 */
export function removeSchedule(domain: string) {
    const existing = activeTasks.get(domain);
    if (existing) {
        existing.stop();
        activeTasks.delete(domain);
        console.log(`[Scheduler] Removed schedule for ${domain}`);
    }
}

/**
 * List all active schedule identifiers.
 */
export function listSchedules(): string[] {
    return Array.from(activeTasks.keys());
}

/**
 * Bootstrap all schedules from the database on server start.
 */
export async function bootstrapSchedules() {
    try {
        const result = await query(`SELECT * FROM scrape_schedules`);
        result.rows.forEach(row => addSchedule(row));
        console.log(`[Scheduler] Bootstrapped ${result.rows.length} scheduled scrapes from DB.`);

        // Schedule Daily Intent Decay Rescore (02:00 IST)
        cron.schedule('0 2 * * *', async () => {
            console.log('[Scheduler] Triggering daily intent decay rescore...');
            await decayQueue.add('rescore', {});
        }, { timezone: 'Asia/Kolkata' });

    } catch (e: any) {
        console.warn(`[Scheduler] Could not bootstrap schedules (DB unavailable):`, e.message);
    }
}
