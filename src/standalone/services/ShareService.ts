import crypto from 'crypto';
import Redis from 'ioredis';
import { query } from '../../lib/database';
import { SovereignFirewall } from '../../lib/ai/SovereignFirewall';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const HMAC_SECRET = process.env.HMAC_SECRET || 'dev-safety-fallback';

export class ShareService {
    /**
     * Generates a signed share URL for a lead signal.
     */
    static async generateShareUrl(leadId: string, organizationId: string): Promise<string> {
        const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days
        
        // HMAC signature
        const tokenData = `${leadId}:${organizationId}:${expiresAt}`;
        const signature = crypto.createHmac('sha256', HMAC_SECRET)
            .update(tokenData)
            .digest('hex');
            
        const shareToken = Buffer.from(`${leadId}|${organizationId}|${expiresAt}|${signature}`).toString('base64url');
        
        // Store in Redis for quick access
        await redis.set(`share:${shareToken}`, JSON.stringify({ leadId, organizationId, expiresAt }), 'PX', 7 * 24 * 60 * 60 * 1000);
        
        return `/share/${shareToken}`;
    }

    /**
     * Validates and retrieves lead content for public sharing.
     * Enforces Sovereign Firewall masking.
     */
    static async getSharedContent(shareToken: string) {
        const cached = await redis.get(`share:${shareToken}`);
        if (!cached) return null;

        const { leadId, organizationId, expiresAt } = JSON.parse(cached);

        if (Date.now() > expiresAt) return null;

        // Fetch lead from DB
        const res = await query("SELECT * FROM scrape_results WHERE job_id = $1 AND (organization_id = $2 OR organization_id IS NULL)", [leadId, organizationId]);
        if (res.rows.length === 0) return null;

        const leadData = res.rows[0];

        // FORCED PII MASKING for public share
        const firewall = new SovereignFirewall(process.env.REGION_ID || 'UAE_DUBAI_01', organizationId);
        const maskedData = JSON.parse(await firewall.maskData(JSON.stringify(leadData)));

        return {
            ...maskedData,
            sharedAt: new Date().toISOString(),
            isPublic: true
        };
    }
}
