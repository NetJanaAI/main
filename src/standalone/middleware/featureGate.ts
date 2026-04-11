import { Request, Response, NextFunction } from 'express';
import { Feature, isFeatureEnabled } from '../../config/featureFlags';
import { RazorpayService } from '../services/RazorpayService';

/**
 * Enterprise Feature Gating Middleware
 * Blocks access to paid-only features for free tier users.
 */
export const featureGate = (req: Request, res: Response, next: NextFunction) => {
    // Tier is extracted from JWT (added to req.user by auth middleware)
    // Defaulting to 'free' for safety
    const userTier = (req as any).user?.tier || 'free';
    const organizationId = (req as any).user?.organizationId;
    const subscriptionId = (req as any).user?.subscriptionId;

    if (userTier === 'paid' || userTier === 'sovereign') return next();

    // Map common routes to Feature enum for checking
    const path = req.path;
    let requiredFeature: Feature | null = null;

    if (path.includes('/campaign')) requiredFeature = Feature.CAMPAIGN_TRACKING;
    if (path.includes('/export/toon')) requiredFeature = Feature.TOON_EXPORT;
    if (path.includes('/scrape/hunter-mode')) requiredFeature = Feature.AUTONOMOUS_HUNTER;
    if (path.includes('/vault')) requiredFeature = Feature.REGIONAL_VAULT;
    
    // Custom check for ROI PDFs or Influence Maps (if they have specific routes)
    if (path.includes('/roi-report')) requiredFeature = Feature.ROI_PDF_EXPORT;
    if (path.includes('/influence-map')) requiredFeature = Feature.INFLUENCE_MAP;

    if (requiredFeature && !isFeatureEnabled(requiredFeature, 'free')) {
        return res.status(403).json({
            error: "FeatureGated",
            feature: requiredFeature,
            tier: "free",
            upgradeUrl: "/upgrade",
            message: `The ${requiredFeature} feature is reserved for Sovereign Alpha (Paid) accounts.`,
            lockedFeatures: [
                "Autonomous Hunter Mode",
                "Influence Maps",
                "ROI PDF Exports",
                "Unlimited Scraping",
                "Historical Campaign Tracking"
            ]
        });
    }

    next();
};
