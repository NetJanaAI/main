export interface InfluenceMap {
    tradeBodies: Array<{
        name: string;
        url: string;
        membershipType: 'full' | 'associate' | 'listed';
        relevanceScore: number;
    }>;
    publications: Array<{
        name: string;
        url: string;
        mentionCount: number;
        lastMention: Date;
    }>;
    events: Array<{
        name: string;
        year: number;
        role: 'speaker' | 'exhibitor' | 'attendee' | 'mentioned';
    }>;
    podcasts: Array<{
        name: string;
        url: string;
        episodeCount: number;
    }>;
    influenceScore: number;  // 0-100 composite
    region: 'India' | 'UAE' | 'Both';
    enrichedAt: Date;
}

/**
 * Calculates a composite influence score (0-100).
 * Formula:
 * - Trade Bodies: max 40pts (20pts each)
 * - Publications: max 30pts (1pt per 3.3 mentions, capped)
 * - Events: max 20pts (10pts each)
 * - Podcasts: max 10pts (5pts each)
 */
export function calculateInfluenceScore(data: Omit<InfluenceMap, 'influenceScore' | 'enrichedAt'>): number {
    const tradeBodiesScore = Math.min((data.tradeBodies || []).length * 20, 40);
    
    const totalMentions = (data.publications || []).reduce((sum, p) => sum + (p.mentionCount || 0), 0);
    const publicationsScore = Math.min(totalMentions / 10 * 3, 30);
    
    const eventsScore = Math.min((data.events || []).length * 10, 20);
    const podcastScore = Math.min((data.podcasts || []).length * 5, 10);
    
    const total = tradeBodiesScore + publicationsScore + eventsScore + podcastScore;
    return Math.round(total * 100) / 100;
}

/**
 * Alpha Score: Composite of Friction (60%) and Influence (40%)
 */
export function calculateAlphaScore(frictionScore: number, influenceScore: number): number {
    const alpha = (frictionScore * 0.6) + (influenceScore * 0.4);
    return Math.round(alpha * 100) / 100;
}
