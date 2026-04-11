import Redis from 'ioredis';
import { FREEMIUM_LIMITS, FeatureKey } from '../../config/freemiumLimits';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

export interface UsageStatus {
    used: number;
    limit: number;
    remaining: number;
    limitReached: boolean;
}

export class UsageTracker {
    /**
     * Increments usage for a specific feature and organization.
     */
    static async increment(organizationId: string, feature: FeatureKey): Promise<UsageStatus> {
        const key = this.getUsageKey(organizationId, feature);
        const limit = FREEMIUM_LIMITS[feature];
        
        const used = await redis.incr(key);
        
        // On first increment, set TTL to end of month
        if (used === 1) {
            await redis.expire(key, this.getSecondsToNextMonth());
        }

        const remaining = Math.max(0, limit - used);
        
        return {
            used,
            limit,
            remaining,
            limitReached: used > limit
        };
    }

    /**
     * Gets current usage without incrementing.
     */
    static async getUsage(organizationId: string, feature: FeatureKey): Promise<number> {
        const key = this.getUsageKey(organizationId, feature);
        const val = await redis.get(key);
        return val ? parseInt(val, 10) : 0;
    }

    /**
     * SparkToro Nudge Check (60% threshold)
     */
    static async isNudgeThreshold(organizationId: string, feature: FeatureKey): Promise<boolean> {
        const used = await this.getUsage(organizationId, feature);
        const limit = FREEMIUM_LIMITS[feature];
        return used >= (limit * 0.6);
    }

    private static getUsageKey(organizationId: string, feature: string): string {
        const date = new Date();
        const yyyymm = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        return `usage:${organizationId}:${feature}:${yyyymm}`;
    }

    private static getSecondsToNextMonth(): number {
        const now = new Date();
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        return Math.floor((nextMonth.getTime() - now.getTime()) / 1000);
    }
}
