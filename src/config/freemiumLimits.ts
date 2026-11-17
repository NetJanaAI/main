export const FREEMIUM_LIMITS = {
    scrapes: 5
};

export type FeatureKey = keyof typeof FREEMIUM_LIMITS;

export const FEATURE_LABELS: Record<string, string> = {
    scrapes: "Scrapes"
};
