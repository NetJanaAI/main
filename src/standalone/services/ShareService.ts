import crypto from 'crypto';
import { query } from '../../lib/database';
import { SovereignFirewall } from '../../lib/ai/SovereignFirewall';
import { getHmacSecret } from '../../lib/secrets';
import { getSharedRedisClient } from '../../lib/redis';

const redis = getSharedRedisClient();

// Only these columns are exposed on a public link; storage paths, spider stats and tenant ids stay private.
const SHARED_COLUMNS = [
    'job_id', 'domain', 'friction_score', 'signals', 'geo_country', 'estimated_roi',
    'critic_analysis', 'grounding_score', 'citations', 'decay_status', 'freshness_score', 'timestamp',
].join(', ');

export class ShareService {
    /**
     * Generates a signed share URL for a lead signal.
     */
    static async generateShareUrl(leadId: string, organizationId: string): Promise<string> {
        const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days
        
        // HMAC signature
        const tokenData = `${leadId}:${organizationId}:${expiresAt}`;
        const signature = crypto.createHmac('sha256', getHmacSecret('share token signing'))
            .update(tokenData)
            .digest('hex');
            
        const shareToken = Buffer.from(`${leadId}|${organizationId}|${expiresAt}|${signature}`).toString('base64url');
        
        // Store in Redis for quick access
        await redis.set(`share:${shareToken}`, JSON.stringify({ leadId, organizationId, expiresAt }), 'PX', 7 * 24 * 60 * 60 * 1000);
        
        return `/share/${shareToken}`;
    }

    /**
     * Revokes a share link. Only the organization that created it can; returns false when
     * the link does not exist or belongs to another organization.
     */
    static async revoke(shareToken: string, organizationId: string): Promise<boolean> {
        const cached = await redis.get(`share:${shareToken}`);
        if (!cached) return false;
        if (JSON.parse(cached).organizationId !== organizationId) return false;
        await redis.del(`share:${shareToken}`);
        return true;
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
        const res = await query(`SELECT ${SHARED_COLUMNS} FROM scrape_results WHERE job_id = $1 AND organization_id = $2`, [leadId, organizationId]);
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
