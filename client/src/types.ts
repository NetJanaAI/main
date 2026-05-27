export interface RegistrySignalResult {
    jobId?: string;
    domain: string;
    frictionScore: number;
    signals: string[];
    timestamp: string;
    geoCountry?: string | null;
    complianceVerified?: boolean;
    showNudge?: boolean;
    usage?: {
        used: number;
        limit: number;
    };
    estimatedRoi?: number;
    groundingScore?: number;
    citations?: string[];
    criticAnalysis?: {
        frictionScore: number;
        intentSummary?: string;
        verity_steps: Array<{
            role: 'advocate' | 'critic' | 'consensus';
            content: string;
            score: number;
        }>;
        painPoints: {
            technicalDebt: string[];
            operationalBottlenecks: string[];
            strategicAlpha: string[];
        };
        ceoIcebreaker: string;
        groundingScore?: number;
    };
    alphaScore?: number;
    organizationId?: string;
}

export interface Job {
    jobId: string;
    domain: string;
    status: 'queued' | 'ingesting' | 'analyzing' | 'complete' | 'failed';
    logs: string[];
    startedAt: string;
    result?: RegistrySignalResult;
}

export interface Log {
    message: string;
    type: 'info' | 'success' | 'warning' | 'error';
    timestamp: string;
}

export interface Tenant {
    id: string;
    name: string;
    quota_limit: number;
    current_usage?: number;
    created_at?: string;
}

export interface Organization {
    id: string;
    name: string;
}

export interface LeadCard {
    lead_id: string;
    source_id: string;
    source_tier: string;
    verity_tier: string;
    intent_score: number;
    company_name: string;
    company_domain: string | null;
    geo_state: string;
    sector: string;
    watch_profile_id?: string;
    card_what_they_need: string;
    card_why_now: string;
    card_do_this: string;
    feedback_status: string | null;
    created_at: string;
    geo_market: 'IN' | 'AE';
    decay_status?: string;
    corroborated: boolean;
    signal_count?: number;
    procurement_category?: string;
    procurement_timeline?: string;
    buying_stage?: string;
}
