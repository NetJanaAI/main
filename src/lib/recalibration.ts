import cron from 'node-cron';
import Redis from 'ioredis';
import { connection } from './queue';
import { Server } from 'socket.io';

const redis = new Redis(connection as any);

export function setupRecalibrationCron(io?: Server) {
    // Weekly Monday 08:00 IST cron
    cron.schedule('0 8 * * 1', async () => {
        try {
            console.log('[Recalibration] Running weekly AI weight recalibration logic...');
            // The 8 sources including GeM and IndiaMART and 6 new collectors
            const sources = ['gem', 'indiamart', 'funding', 'naukri', 'zauba', 'mca', 'parivesh', 'rera'];
            const updates = [];

            for (const source_id of sources) {
                const perfData = await redis.hgetall(`source_perf:${source_id}`);
                const totalStr = perfData.total;
                if (!totalStr) continue;

                const total = parseInt(perfData.total || '0', 10);
                const contacted = parseInt(perfData.contacted || '0', 10);
                const converted = parseInt(perfData.converted || '0', 10);
                const wrong = parseInt(perfData.wrong || '0', 10);

                const conversion_rate = contacted > 0 ? converted / contacted : 0;
                const wrong_rate = total > 0 ? wrong / total : 0;

                let base_I0 = parseFloat(await redis.get(`source_weights_base:${source_id}`) || '0.80');
                if (source_id === 'gem') base_I0 = 0.90;
                if (source_id === 'indiamart') base_I0 = 0.95;

                let old_I0 = parseFloat(await redis.get(`source_weights:${source_id}`) || base_I0.toString());

                // Weight formula from specifications
                let new_I0 = base_I0 * (1 + conversion_rate) * (1 - wrong_rate * 0.5);

                // Clamp between 0.40 and 0.98
                new_I0 = Math.max(0.40, Math.min(new_I0, 0.98));

                await redis.set(`source_weights:${source_id}`, new_I0.toString());

                updates.push({
                    source_id,
                    old_I0,
                    new_I0
                });
            }

            if (updates.length > 0) {
                const dateStr = new Date().toISOString().split('T')[0];
                const logEntry = JSON.stringify({ updates, timestamp: new Date().toISOString() });

                await redis.lpush(`weight_history:${dateStr}`, logEntry);

                if (io) {
                    io.emit('weights_updated', { updates });
                }

                console.log(`[Recalibration] Updated weights for ${updates.length} sources`);
            }

        } catch (e: any) {
            console.error('[Recalibration] Cron failed:', e.message);
        }
    }, {
        timezone: "Asia/Kolkata"
    });

    console.log('[Recalibration] Scheduled weekly AI weight tuning cron (Mon 08:00 IST).');
}
