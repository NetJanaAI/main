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
        } catch (e: any) {
            console.error(`[Canary] [${region}] Failed to report heartbeat:`, e.message);
            // In a real HA setup, this might trigger a local failover or page an SRE
        }
    }
}
