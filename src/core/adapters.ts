import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { RawSignal, GeMCollectorPayload, IndiaMARTCollectorPayload, FundingCollectorPayload, NaukriCollectorPayload, ZaubaCollectorPayload, McaCollectorPayload, PariveshCollectorPayload, ReraCollectorPayload } from '../lib/schemas';
import { cache } from '../lib/cache';

// C-01: Default weights used when recalibration hasn't run yet.
// After the first weekly recalibration cron, Redis `source_weights:{id}` overrides these.
const DEFAULT_WEIGHTS: Record<string, number> = {
    gem: 0.90,
    indiamart: 0.95,
    funding: 0.85,
    naukri: 0.80,
    zauba: 0.70,
    mca: 0.80,
    parivesh: 0.85,
    rera: 0.80,
};

/**
 * C-01 fix: Reads the recalibrated weight from Redis.
 * Falls back to DEFAULT_WEIGHTS if recalibration hasn't run yet.
 */
async function getSourceWeight(sourceId: string, tierBoost: boolean = false): Promise<number> {
    try {
        const stored = await cache.get<string>(`source_weights:${sourceId}`);
        if (stored) {
            const weight = parseFloat(stored);
            if (!isNaN(weight) && weight >= 0.1 && weight <= 1.0) return weight;
        }
    } catch (_) { /* Redis unavailable — use defaults */ }
    const base = DEFAULT_WEIGHTS[sourceId] ?? 0.70;
    return tierBoost ? Math.min(0.98, base + 0.10) : base;
}

// H-02: Port-to-state mapping for Zauba import data
const PORT_STATE_MAP: Record<string, string> = {
    'JNPT': 'Maharashtra', 'NHAVA SHEVA': 'Maharashtra', 'MUMBAI': 'Maharashtra',
    'MUNDRA': 'Gujarat', 'KANDLA': 'Gujarat', 'PIPAVAV': 'Gujarat',
    'CHENNAI': 'Tamil Nadu', 'TUTICORIN': 'Tamil Nadu', 'KATTUPALLI': 'Tamil Nadu',
    'KOLKATA': 'West Bengal', 'HALDIA': 'West Bengal',
    'VISAKHAPATNAM': 'Andhra Pradesh', 'VIZAG': 'Andhra Pradesh',
    'COCHIN': 'Kerala', 'KOCHI': 'Kerala',
    'MANGALORE': 'Karnataka', 'BANGALORE ICD': 'Karnataka',
    'GOA': 'Goa', 'PARADIP': 'Odisha',
    'ICD TUGHLAKABAD': 'Delhi', 'DELHI': 'Delhi',
    'LUDHIANA ICD': 'Punjab',
};

function resolvePortToState(portName: string): string {
    const normalized = (portName || '').toUpperCase().trim();
    for (const [port, state] of Object.entries(PORT_STATE_MAP)) {
        if (normalized.includes(port)) return state;
    }
    return portName || 'Unknown'; // fallback: keep raw if no mapping found
}

// M-01: Parse "City, State" headquarters format
function parseStateFromHeadquarters(hq: string): string {
    if (!hq) return 'Unknown';
    const parts = hq.split(',').map(s => s.trim());
    // Last segment is typically the state: "Bengaluru, Karnataka" -> "Karnataka"
    return parts.length >= 2 ? parts[parts.length - 1] : parts[0];
}

function hashPII(value: string | undefined | null, prefix: string): string | undefined {
    if (!value) return undefined;
    return prefix + createHash('sha256').update(value.toLowerCase().trim()).digest('hex');
}

export function cleanCompanyName(rawName: string): string {
    let clean = rawName || '';

    const stripPhrases = [
        "Private Limited", "Pvt Ltd", "Pvt\\. Ltd\\.", "Limited", "Ltd",
        "LLP", "& Co", "Incorporated", "Corp", "Industries", "Enterprises",
        "FZE", "FZCO", "LLC", "PJSC", "PSC"
    ];

    // Repeatedly replace to handle consecutive matches
    let previous = '';
    while (clean !== previous) {
        previous = clean;
        for (const phrase of stripPhrases) {
            const regex = new RegExp(`(?:^|\\s)${phrase}(?:$|\\s|\\.|,)`, 'gi');
            clean = clean.replace(regex, ' ');
        }
    }

    // Remove special chars, keep alphanumeric (including Arabic range) and spaces
    // Arabic Unicode Range: \u0600-\u06FF
    clean = clean.replace(/[^a-zA-Z0-9\s\u0600-\u06FF]/g, ' ');
    // Trim whitespace and uppercase
    return clean.replace(/\s+/g, ' ').trim().toUpperCase();
}

export async function adaptGeM(payload: GeMCollectorPayload): Promise<RawSignal | null> {
    // Determine TIER based on bid_deadline
    const deadline = new Date(payload.bid_deadline);
    const now = new Date();
    const diffDays = (deadline.getTime() - now.getTime()) / (1000 * 3600 * 24);

    let tier: 'TIER_1' | 'TIER_2' | 'TIER_3';
    if (diffDays <= 7) {
        tier = 'TIER_1';
    } else if (diffDays <= 30) {
        tier = 'TIER_2';
    } else {
        return null; // Skip if > 30 days
    }

    const safePayload = { ...payload };
    if (safePayload.contact_email) {
        safePayload.contact_email = hashPII(safePayload.contact_email, 'tok_eml_');
    }
    if (safePayload.contact_mobile) {
        safePayload.contact_mobile = hashPII(safePayload.contact_mobile, 'tok_mob_');
    }

    const weight = await getSourceWeight('gem', tier === 'TIER_1');

    return {
        signal_id: uuidv4(),
        source_id: 'gem',
        source_tier: tier,
        collected_at: new Date().toISOString(),
        company_name_raw: payload.buyer_name || 'Unknown Buyer',
        company_name_clean: cleanCompanyName(payload.buyer_name || 'Unknown Buyer'),
        cin: payload.cin || null,
        geo_state: payload.ministry_state || 'Unknown',
        sector_inferred: payload.department || payload.item_category || 'Government',
        signal_strength_I0: weight,
        lambda: 0.15,
        raw_payload: safePayload,
        pii_safe: true,
        geo_market: 'IN'
    };
}

export async function adaptIndiaMART(payload: IndiaMARTCollectorPayload): Promise<RawSignal> {
    const safePayload = { ...payload };
    if (safePayload.sender_email) {
        safePayload.sender_email = hashPII(safePayload.sender_email, 'tok_eml_');
    }
    if (safePayload.sender_mobile) {
        safePayload.sender_mobile = hashPII(safePayload.sender_mobile, 'tok_mob_');
    }

    // IndiaMART collected_at should be ISO string
    let collectedAt = new Date().toISOString();
    if (payload.query_time) {
        try {
            collectedAt = new Date(payload.query_time).toISOString();
        } catch (e) {
            // fallback
        }
    }

    const weight = await getSourceWeight('indiamart');

    return {
        signal_id: uuidv4(),
        source_id: 'indiamart',
        source_tier: 'TIER_2', // Route to Gemini qualification
        collected_at: collectedAt,
        company_name_raw: payload.sender_company || payload.sender_name || 'Unknown',
        company_name_clean: cleanCompanyName(payload.sender_company || payload.sender_name || 'Unknown'),
        cin: null, // IndiaMART typically doesn't provide CIN directly in raw lead
        // H-01: Never use sender_city as geo_state — it breaks entity resolution
        geo_state: payload.sender_state || 'Unknown',
        sector_inferred: payload.query_product_name || 'Unknown',
        signal_strength_I0: weight,
        lambda: 0.15,
        raw_payload: safePayload,
        pii_safe: true,
        geo_market: 'IN'
    };
}

export async function adaptFunding(payload: FundingCollectorPayload): Promise<RawSignal> {
    // Determines if recent funding (<= 14 days) -> TIER_1 (highly actionable intent)
    // else TIER_2
    const announcementDate = new Date(payload.announcement_date);
    const now = new Date();
    const diffDays = (now.getTime() - announcementDate.getTime()) / (1000 * 3600 * 24);

    // Recent funding implies immediate expansion + operational needs
    const tier = diffDays <= 14 ? 'TIER_1' : 'TIER_2';
    const weight = await getSourceWeight('funding', tier === 'TIER_1');

    return {
        signal_id: uuidv4(),
        source_id: 'funding',
        source_tier: tier,
        collected_at: new Date().toISOString(),
        company_name_raw: payload.company_name,
        company_name_clean: cleanCompanyName(payload.company_name),
        cin: null,
        // M-01: Parse state from "City, State" headquarters format
        geo_state: parseStateFromHeadquarters(payload.headquarters),
        sector_inferred: payload.sector || 'Startup / Tech',
        signal_strength_I0: weight,
        lambda: 0.10, // Funding lasts longer than a tender
        raw_payload: payload,
        pii_safe: true, // public data
        geo_market: 'IN'
    };
}

export async function adaptNaukri(payload: NaukriCollectorPayload): Promise<RawSignal> {
    const postedDate = new Date(payload.posted_date);
    const now = new Date();
    const diffDays = (now.getTime() - postedDate.getTime()) / (1000 * 3600 * 24);

    // Recent job postings for procurement/supply chain are strong TIER_1 signals
    const tier = diffDays <= 7 ? 'TIER_1' : 'TIER_2';
    const weight = await getSourceWeight('naukri', tier === 'TIER_1');

    return {
        signal_id: uuidv4(),
        source_id: 'naukri',
        source_tier: tier,
        collected_at: new Date().toISOString(),
        company_name_raw: payload.company_name,
        company_name_clean: cleanCompanyName(payload.company_name),
        cin: null,
        // job_location may be city — parse state if "City, State" format
        geo_state: parseStateFromHeadquarters(payload.job_location),
        sector_inferred: 'Corporate', // Fallback, Gemini will refine
        signal_strength_I0: weight,
        lambda: 0.12, // Hiring takes time, intent lasts longer
        raw_payload: payload,
        pii_safe: true, // public data
        geo_market: 'IN'
    };
}

export async function adaptZauba(payload: ZaubaCollectorPayload): Promise<RawSignal> {
    const importDate = new Date(payload.import_date);
    const now = new Date();
    const diffDays = (now.getTime() - importDate.getTime()) / (1000 * 3600 * 24);

    // Recent big imports = heavy production/inventory scale-up
    const tier = diffDays <= 7 ? 'TIER_1' : 'TIER_2';
    const weight = await getSourceWeight('zauba', tier === 'TIER_1');

    return {
        signal_id: uuidv4(),
        source_id: 'zauba',
        source_tier: tier,
        collected_at: new Date().toISOString(),
        company_name_raw: payload.company_name,
        company_name_clean: cleanCompanyName(payload.company_name),
        cin: null,
        // H-02: Map port names to states for entity resolution compatibility
        geo_state: resolvePortToState(payload.port_of_unloading),
        sector_inferred: 'Manufacturing/Import',
        signal_strength_I0: weight,
        lambda: 0.20, // Equipment needs to be moved/processed quickly
        raw_payload: payload,
        pii_safe: true, // custom data is public
        geo_market: 'IN'
    };
}

export async function adaptMca(payload: McaCollectorPayload): Promise<RawSignal> {
    const eventDate = new Date(payload.event_date);
    const now = new Date();
    const diffDays = (now.getTime() - eventDate.getTime()) / (1000 * 3600 * 24);

    // Capital increases mean expansion -> TIER_1 if recent
    const tier = diffDays <= 14 ? 'TIER_1' : 'TIER_2';
    const weight = await getSourceWeight('mca', tier === 'TIER_1');

    return {
        signal_id: uuidv4(),
        source_id: 'mca',
        source_tier: tier,
        collected_at: new Date().toISOString(),
        company_name_raw: payload.company_name,
        company_name_clean: cleanCompanyName(payload.company_name),
        cin: payload.cin,
        geo_state: payload.state,
        sector_inferred: 'Corporate', // MCA rarely has immediate sector
        signal_strength_I0: weight,
        lambda: 0.15,
        raw_payload: payload,
        pii_safe: true, // MCA data is public registry
        geo_market: 'IN'
    };
}

export async function adaptParivesh(payload: PariveshCollectorPayload): Promise<RawSignal> {
    const eventDate = new Date(payload.clearance_date);
    const now = new Date();
    const diffDays = (now.getTime() - eventDate.getTime()) / (1000 * 3600 * 24);

    // Industrial/manufacturing expansion -> TIER_1 if recent
    const tier = diffDays <= 30 ? 'TIER_1' : 'TIER_2';
    const weight = await getSourceWeight('parivesh', tier === 'TIER_1');

    return {
        signal_id: uuidv4(),
        source_id: 'parivesh',
        source_tier: tier,
        collected_at: new Date().toISOString(),
        company_name_raw: payload.company_name,
        company_name_clean: cleanCompanyName(payload.company_name),
        cin: null,
        geo_state: payload.state,
        sector_inferred: 'Industrial / Manufacturing',
        signal_strength_I0: weight,
        lambda: 0.10, // factory construction takes a year
        raw_payload: payload,
        pii_safe: true, // public registry
        geo_market: 'IN'
    };
}

export async function adaptRera(payload: ReraCollectorPayload): Promise<RawSignal> {
    const eventDate = new Date(payload.approval_date);
    const now = new Date();
    const diffDays = (now.getTime() - eventDate.getTime()) / (1000 * 3600 * 24);

    // Real estate projects -> TIER_1 if recent
    const tier = diffDays <= 30 ? 'TIER_1' : 'TIER_2';
    const weight = await getSourceWeight('rera', tier === 'TIER_1');

    return {
        signal_id: uuidv4(),
        source_id: 'rera',
        source_tier: tier,
        collected_at: new Date().toISOString(),
        company_name_raw: payload.company_name,
        company_name_clean: cleanCompanyName(payload.company_name),
        cin: null,
        geo_state: payload.state,
        sector_inferred: 'Real Estate / Construction',
        signal_strength_I0: weight,
        lambda: 0.10, // project execution spans multiple quarters
        raw_payload: payload,
        pii_safe: true, // public registry
        geo_market: 'IN'
    };
}
