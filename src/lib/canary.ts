import axios from 'axios';
import { getSystemHealth } from './telemetry';

export class HACanary {
    /**
     * Performs a global heartbeat check and reports health to the NetJana Management Console.
     * Triggered every 5 minutes globally.
     */
    static async runHeartbeat() {
        const health = await getSystemHealth();
        const region = process.env.REGION_ID || 'GLOBAL';

        console.log(`[Canary] [${region}] Health Check: ${health.status}`);

        try {
            // Report to global monitoring cluster when configured.
            if (process.env.BRAIN_WEBHOOK_URL) {
                await axios.post(process.env.BRAIN_WEBHOOK_URL, {
                    region,
                    health,
                    timestamp: new Date().toISOString()
                });
            }

            if (health.status !== 'UP' && process.env.SLACK_WEBHOOK_URL) {
                await axios.post(process.env.SLACK_WEBHOOK_URL, {
                    text: `*⚠️ System Health Alert [${region}]*`,
                    attachments: [{
                        color: "#FF9900",
                        text: `Status: ${health.status}\nCheck the Protocol Terminal immediately.`
                    }]
                });
            }
        } catch (e: any) {
            console.error(`[Canary] [${region}] Failed to report heartbeat:`, e.message);

            if (process.env.SLACK_WEBHOOK_URL) {
                await axios.post(process.env.SLACK_WEBHOOK_URL, {
                    text: `*🚨 Critical: Canary Failure [${region}]*`,
                    attachments: [{
                        color: "#FF0000",
                        text: `Canary reported a fatal error: ${e.message}`
                    }]
                });
            }
        }
    }
}

import { query } from './database';

export class SignalDroughtMonitor {
    /**
     * Checks if no new valid leads have been generated across all organizations
     * in the last hour. If so, triggers an alert.
     */
    static async checkDrought() {
        try {
            const res = await query(`
                SELECT count(*) as recent_count
                FROM lead_cards
                WHERE created_at >= NOW() - INTERVAL '1 hour'
            `);
            const count = parseInt(res.rows[0]?.recent_count || '0', 10);

            if (count === 0) {
                const region = process.env.REGION_ID || 'GLOBAL';
                console.warn(`[DroughtMonitor] [${region}] SIGNAL DROUGHT DETECTED: 0 leads in the last hour.`);

                if (process.env.SLACK_WEBHOOK_URL) {
                    await axios.post(process.env.SLACK_WEBHOOK_URL, {
                        text: `*🏜️ Signal Drought Alert [${region}]*`,
                        attachments: [{
                            color: "#FF9900",
                            text: `0 leads generated in the last hour. Verify scraping infrastructure and proxy health.`
                        }]
                    });
                }
            }
        } catch (e: any) {
            console.error('[DroughtMonitor] Failed to check for drought:', e.message);
        }
    }
}
