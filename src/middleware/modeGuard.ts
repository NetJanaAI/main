import { Request, Response, NextFunction } from 'express';
import { Feature, isFeatureEnabled, UserTier } from '../config/featureFlags';
import { NETJANA_MODE } from '../config/mode';

/**
 * Higher-order middleware to enforce feature flags.
 * @param feature The feature to check for.
 */
export const modeGuard = (feature: Feature) => {
    return (req: Request, res: Response, next: NextFunction) => {
        // Standalone mode might have a user object from JWT. 
        // For now, default to 'free' tier if not specified.
        const userTier: UserTier = (req as any).user?.tier || 'free';

        if (!isFeatureEnabled(feature, userTier)) {
            return res.status(403).json({
                error: "Feature not available in current operational mode",
                mode: NETJANA_MODE,
                feature,
                tier: NETJANA_MODE === 'standalone' ? userTier : 'institutional'
            });
        }

        next();
    };
};
