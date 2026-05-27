import { z } from 'zod';

export const ScrapeRequestSchema = z.object({
    url: z.string().url('Invalid URL format'),
    forceFailure: z.boolean().optional(),
    useOnlineAI: z.boolean().optional(),
    spiderMode: z.boolean().optional(),
    maxPages: z.number().int().min(1).max(20).optional().default(5),
    organizationId: z.string().uuid().optional()
});

export const ScrapeResultSchema = z.object({
    jobId: z.string().uuid().optional(),
    domain: z.string(),
    frictionScore: z.number().min(0).max(100),
    signals: z.array(z.string()),
    timestamp: z.string().datetime(),
    geoCountry: z.string().nullable().optional(),
    complianceVerified: z.boolean().optional(),
    estimatedRoi: z.number().optional(),
    screenshotPath: z.string().nullable().optional(),
    spiderStats: z.object({
        pagesVisited: z.number(),
        urlsCrawled: z.array(z.string())
    }).optional(),
    groundingScore: z.number().optional(),
    citations: z.array(z.string()).optional(),
    criticAnalysis: z.object({
        frictionScore: z.number(),
        intentSummary: z.string(),
        verity_steps: z.array(z.object({
            role: z.enum(['advocate', 'critic', 'consensus']),
            content: z.string(),
            score: z.number()
        })),
        painPoints: z.object({
            technicalDebt: z.array(z.string()),
            operationalBottlenecks: z.array(z.string()),
            strategicAlpha: z.array(z.string())
        }),
        ceoIcebreaker: z.string(),
        groundingScore: z.number().optional()
    }).optional()
});

export const RawSignalSchema = z.object({
    signal_id: z.string().uuid(),
    source_id: z.string(),
    source_tier: z.enum(['TIER_1', 'TIER_2', 'TIER_3']),
    collected_at: z.string().datetime(),
    company_name_raw: z.string(),
    company_name_clean: z.string(),
    cin: z.string().nullable().optional(),
    geo_state: z.string(),
    sector_inferred: z.string(),
    signal_strength_I0: z.number(),
    lambda: z.number(),
    raw_payload: z.record(z.string(), z.any()),
    pii_safe: z.boolean(),
    is_triangulated: z.boolean().optional(),
    triangulated_sources: z.array(z.string()).optional(),
    geo_market: z.enum(['IN', 'AE']).default('IN')
});

export const GeMCollectorPayloadSchema = z.object({
    bid_id: z.string(),
    buyer_name: z.string(),
    ministry_state: z.string(),
    department: z.string(),
    bid_deadline: z.string(), // ISO 8601
    item_category: z.string(),
    quantity: z.number().optional(),
    contact_email: z.string().optional(),
    contact_mobile: z.string().optional(),
    cin: z.string().optional().nullable()
}).passthrough();

export const IndiaMARTCollectorPayloadSchema = z.object({
    query_id: z.string(),
    sender_name: z.string(),
    sender_company: z.string(),
    sender_city: z.string(),
    sender_state: z.string(),
    query_product_name: z.string(),
    query_message: z.string(),
    sender_mobile: z.string().optional(),
    sender_email: z.string().optional(),
    query_time: z.string() // ISO 8601
}).passthrough();

export const FundingCollectorPayloadSchema = z.object({
    company_name: z.string(),
    funding_amount: z.string(), // e.g. "$10M" or "₹50 Cr"
    funding_round: z.string(), // e.g. "Series A"
    announcement_date: z.string(), // ISO 8601
    investors: z.string().optional(),
    headquarters: z.string(), // e.g. "Bengaluru, Karnataka"
    sector: z.string().optional()
}).passthrough();

export const NaukriCollectorPayloadSchema = z.object({
    company_name: z.string(),
    job_title: z.string(),
    job_location: z.string(),
    posted_date: z.string(), // ISO 8601
    job_description: z.string(),
    salary_range: z.string().optional(),
    experience_required: z.string().optional()
}).passthrough();

export const ZaubaCollectorPayloadSchema = z.object({
    company_name: z.string(),
    import_item: z.string(),
    quantity: z.string(),
    import_value: z.string().optional(),
    import_date: z.string(), // ISO 8601
    port_of_unloading: z.string()
}).passthrough();

export const McaCollectorPayloadSchema = z.object({
    company_name: z.string(),
    cin: z.string(),
    event_type: z.string(),
    event_date: z.string(), // ISO 8601
    state: z.string(),
    directors: z.array(z.string()).optional()
}).passthrough();

export const PariveshCollectorPayloadSchema = z.object({
    company_name: z.string(),
    project_name: z.string(),
    clearance_date: z.string(), // ISO 8601
    state: z.string(),
    capacity: z.string().optional()
}).passthrough();

export const ReraCollectorPayloadSchema = z.object({
    company_name: z.string(),
    project_name: z.string(),
    approval_date: z.string(), // ISO 8601
    state: z.string(),
    project_type: z.string().optional()
}).passthrough();

export const DmccCollectorPayloadSchema = z.object({
    company_name: z.string(),
    license_number: z.string().optional(),
    activity: z.string().optional(),
    registration_date: z.string().optional()
}).passthrough();

export const ZawyaCollectorPayloadSchema = z.object({
    title: z.string(),
    link: z.string().url(),
    pub_date: z.string().optional(),
    summary: z.string().optional()
}).passthrough();

export const AdgmCollectorPayloadSchema = z.object({
    entity_name: z.string(),
    registration_number: z.string().optional(),
    entity_type: z.string().optional(),
    status: z.string().optional()
}).passthrough();

export const GulfNewsCollectorPayloadSchema = z.object({
    headline: z.string(),
    link: z.string().url(),
    category: z.string().optional()
}).passthrough();

export const EtimadCollectorPayloadSchema = z.object({
    tender_title: z.string(),
    reference_number: z.string().optional(),
    category: z.string().optional(),
    deadline: z.string().optional()
}).passthrough();

export const WatchProfileSchema = z.object({
    profile_id: z.string().uuid().optional(),
    org_id: z.string(),
    keywords: z.array(z.string()).default([]),
    regions: z.array(z.string()).default([]),
    min_amount: z.number().optional().default(0),
    is_active: z.boolean().optional().default(true)
});

export const WatchProfileMatchSchema = z.object({
    profile_id: z.string().uuid(),
    matched_keywords: z.array(z.string()),
    score: z.number()
});

export type ScrapeRequest = z.infer<typeof ScrapeRequestSchema>;
export type ScrapeResult = z.infer<typeof ScrapeResultSchema>;
export type RawSignal = z.infer<typeof RawSignalSchema>;
export type GeMCollectorPayload = z.infer<typeof GeMCollectorPayloadSchema>;
export type IndiaMARTCollectorPayload = z.infer<typeof IndiaMARTCollectorPayloadSchema>;
export type FundingCollectorPayload = z.infer<typeof FundingCollectorPayloadSchema>;
export type NaukriCollectorPayload = z.infer<typeof NaukriCollectorPayloadSchema>;
export type ZaubaCollectorPayload = z.infer<typeof ZaubaCollectorPayloadSchema>;
export type McaCollectorPayload = z.infer<typeof McaCollectorPayloadSchema>;
export type PariveshCollectorPayload = z.infer<typeof PariveshCollectorPayloadSchema>;
export type ReraCollectorPayload = z.infer<typeof ReraCollectorPayloadSchema>;
export type DmccCollectorPayload = z.infer<typeof DmccCollectorPayloadSchema>;
export type ZawyaCollectorPayload = z.infer<typeof ZawyaCollectorPayloadSchema>;
export type AdgmCollectorPayload = z.infer<typeof AdgmCollectorPayloadSchema>;
export type GulfNewsCollectorPayload = z.infer<typeof GulfNewsCollectorPayloadSchema>;
export type EtimadCollectorPayload = z.infer<typeof EtimadCollectorPayloadSchema>;
export type WatchProfile = z.infer<typeof WatchProfileSchema>;
export type WatchProfileMatch = z.infer<typeof WatchProfileMatchSchema>;
