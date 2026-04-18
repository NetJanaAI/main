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
            // Report to global monitoring cluster
            await axios.post(process.env.BRAIN_WEBHOOK_URL || 'http://localhost:4000/api/canary', {
                region,
                health,
                timestamp: new Date().toISOString()
            });

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
