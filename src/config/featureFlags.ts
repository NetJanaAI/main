import { NETJANA_MODE } from './mode';

export enum Feature {
    MCP_SERVER = 'mcpServer',
    AUTONOMOUS_HUNTER = 'autonomousHunterMode',
    TOON_EXPORT = 'toonExport',
    CAMPAIGN_TRACKING = 'campaignTracking',
    OUTREACH_ACTION = 'takeActionOutreach',
    INFLUENCE_MAP = 'influenceMap',
    ROI_PDF_EXPORT = 'roiPdfExport',
    SOVEREIGN_FIREWALL = 'sovereignFirewall',
    REGIONAL_VAULT = 'regionalVault'
}

export type UserTier = 'free' | 'paid' | 'institutional';

const FEATURE_MATRIX: Record<Feature, { covospan: boolean; standalone_free: boolean; standalone_paid: boolean }> = {
    [Feature.MCP_SERVER]:           { covospan: true,  standalone_free: false, standalone_paid: false },
    [Feature.AUTONOMOUS_HUNTER]:    { covospan: true,  standalone_free: false, standalone_paid: true  },
    [Feature.TOON_EXPORT]:          { covospan: true,  standalone_free: false, standalone_paid: true  },
    [Feature.CAMPAIGN_TRACKING]:    { covospan: true,  standalone_free: false, standalone_paid: true  },
    [Feature.OUTREACH_ACTION]:      { covospan: false, standalone_free: true,  standalone_paid: true  },
    [Feature.INFLUENCE_MAP]:        { covospan: false, standalone_free: false, standalone_paid: true  },
    [Feature.ROI_PDF_EXPORT]:       { covospan: false, standalone_free: false, standalone_paid: true  },
    [Feature.SOVEREIGN_FIREWALL]:    { covospan: true,  standalone_free: false, standalone_paid: false },
    [Feature.REGIONAL_VAULT]:       { covospan: true,  standalone_free: false, standalone_paid: false },
};

/**
 * Checks if a feature is enabled for the current mode and user tier.
 */
export function isFeatureEnabled(feature: Feature, tier: UserTier = 'free'): boolean {
    const config = FEATURE_MATRIX[feature];
    if (!config) return false;

    if (NETJANA_MODE === 'covospan') {
        return config.covospan;
    }

    // In standalone mode, we check based on the user's tier
    return tier === 'paid' ? config.standalone_paid : config.standalone_free;
}
