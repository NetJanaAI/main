export interface DecayResult {
    decayedScore: number;
    freshnessPercent: number;   // 0-100
    status: 'Hot' | 'Warm' | 'Cold' | 'Dead';
    daysSince: number;
    nextReviewDate: Date;       // date when status will change to next tier
    previousStatus?: string;   // set if status changed this calculation
}

/**
 * Calculates exponential decay of a signal score.
 * Half-life: 30 days
 * Formula: decayedScore = baseScore * Math.exp(-Math.LN2 / 30 * daysSince)
 */
export function calculateDecay(baseScore: number, capturedAt: Date): DecayResult {
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - capturedAt.getTime());
    const daysSince = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    const HALF_LIFE = 30;
    const decayedScore = baseScore * Math.exp(-Math.LN2 / HALF_LIFE * daysSince);
    const freshnessPercent = (decayedScore / baseScore) * 100;

    let status: 'Hot' | 'Warm' | 'Cold' | 'Dead';
    if (decayedScore >= 85) status = 'Hot';
    else if (decayedScore >= 60) status = 'Warm';
    else if (decayedScore >= 30) status = 'Cold';
    else status = 'Dead';

    // Calculate when the status will change to the next tier
    // decayedScore = baseScore * Math.exp(-Math.LN2 / 30 * t)
    // t = -30 * ln(targetScore/baseScore) / ln(2)
    const targetScores = [84.9, 59.9, 29.9];
    let nextThreshold = targetScores.find(t => t < decayedScore) || 0;
    
    let daysToNext = 0;
    if (nextThreshold > 0) {
        const targetDays = -HALF_LIFE * Math.log(nextThreshold / baseScore) / Math.LN2;
        daysToNext = Math.ceil(targetDays - daysSince);
    } else {
        daysToNext = 365; // Far future if dead
    }

    const nextReviewDate = new Date();
    nextReviewDate.setDate(nextReviewDate.getDate() + daysToNext);

    return {
        decayedScore: Math.round(decayedScore * 100) / 100,
        freshnessPercent: Math.round(freshnessPercent),
        status,
        daysSince,
        nextReviewDate
    };
}
