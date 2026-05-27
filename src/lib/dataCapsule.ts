import crypto from 'crypto';
import { ScrapeResult } from './schemas';
import { getHmacSecret } from './secrets';

const REGION_ID = process.env.REGION_ID || 'UAE_DUBAI_01';

export interface DataCapsule {
    target_domain: string;
    friction_score: number;
    ceo_icebreaker_intent?: string;
    outreach_pain_points: string[];
    verified_region: string;
    timestamp: string;
    job_id?: string;
    signature?: string;
}

/**
 * Transforms a raw ScrapeResult into a highly refined Data Capsule for Convospan Edge.
 */
export function generateCapsule(result: ScrapeResult): DataCapsule {
    const painPoints: string[] = [];
    
    if (result.criticAnalysis?.painPoints) {
        if (result.criticAnalysis.painPoints.operationalBottlenecks) {
            painPoints.push(...result.criticAnalysis.painPoints.operationalBottlenecks);
        }
        if (result.criticAnalysis.painPoints.strategicAlpha) {
            painPoints.push(...result.criticAnalysis.painPoints.strategicAlpha);
        }
        if (result.criticAnalysis.painPoints.technicalDebt) {
            painPoints.push(...result.criticAnalysis.painPoints.technicalDebt);
        }
    } else if (result.signals && Array.isArray(result.signals)) {
        painPoints.push(...result.signals);
    }

    const payload: DataCapsule = {
        target_domain: result.domain,
        friction_score: result.frictionScore,
        ceo_icebreaker_intent: result.criticAnalysis?.ceoIcebreaker,
        outreach_pain_points: painPoints.slice(0, 5), // Keep top 5 for concise outreach
        verified_region: REGION_ID,
        timestamp: result.timestamp || new Date().toISOString(),
        job_id: result.jobId
    };

    return payload;
}

/**
 * Cryptographically signs the Data Capsule to prove origin from the Sovereign Alpha Node.
 */
export function signCapsule(capsule: object): string {
    const signature = crypto.createHmac('sha256', getHmacSecret('data capsule signing'))
        .update(JSON.stringify(capsule))
        .digest('hex');
    return signature;
}
