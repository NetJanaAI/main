import { Router } from 'express';
import { UsageTracker } from '../standalone/services/UsageTracker';
import { FREEMIUM_LIMITS, FeatureKey } from '../config/freemiumLimits';

const router = Router();

/**
 * GET /api/usage
 * Returns the current authenticated organization's usage stats.
 */
router.get('/', async (req: any, res) => {
    const organizationId = req.organizationId || 'default';
    
    try {
        const features = Object.keys(FREEMIUM_LIMITS) as FeatureKey[];
        const usageData = await Promise.all(features.map(async (feature) => {
            const used = await UsageTracker.getUsage(organizationId, feature);
            const limit = FREEMIUM_LIMITS[feature];
            return {
                feature,
                used,
                limit,
                remaining: Math.max(0, limit - used),
                percent: Math.min(100, (used / limit) * 100)
            };
        }));

        res.json({
            organizationId,
            usage: usageData,
            tier: req.tenantTier || 'free'
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch usage data' });
    }
});

export default router;
