import { v4 as uuidv4 } from 'uuid';
import {
    RawSignal,
    DmccCollectorPayload,
    ZawyaCollectorPayload,
    AdgmCollectorPayload,
    GulfNewsCollectorPayload,
    EtimadCollectorPayload
} from '../../lib/schemas';
import { cleanCompanyName } from '../adapters';

export function adaptDMCC(payload: DmccCollectorPayload): RawSignal {
    return {
        signal_id: uuidv4(),
        source_id: 'dmcc',
        source_tier: 'TIER_1',
        collected_at: new Date().toISOString(),
        company_name_raw: payload.company_name,
        company_name_clean: cleanCompanyName(payload.company_name),
        cin: payload.license_number || null,
        geo_state: 'Dubai (DMCC)',
        sector_inferred: payload.activity || 'Free Zone Entity',
        signal_strength_I0: 0.95,
        lambda: 0.10,
        raw_payload: payload,
        pii_safe: true,
        geo_market: 'AE'
    };
}

export function adaptZawya(payload: ZawyaCollectorPayload): RawSignal {
    return {
        signal_id: uuidv4(),
        source_id: 'zawya',
        source_tier: 'TIER_2',
        collected_at: new Date().toISOString(),
        company_name_raw: payload.title,
        company_name_clean: cleanCompanyName(payload.title),
        cin: null,
        geo_state: 'UAE',
        sector_inferred: 'Business News',
        signal_strength_I0: 0.85,
        lambda: 0.15,
        raw_payload: payload,
        pii_safe: true,
        geo_market: 'AE'
    };
}

export function adaptADGM(payload: AdgmCollectorPayload): RawSignal {
    return {
        signal_id: uuidv4(),
        source_id: 'adgm',
        source_tier: 'TIER_1',
        collected_at: new Date().toISOString(),
        company_name_raw: payload.entity_name,
        company_name_clean: cleanCompanyName(payload.entity_name),
        cin: payload.registration_number || null,
        geo_state: 'Abu Dhabi (ADGM)',
        sector_inferred: payload.entity_type || 'Free Zone Entity',
        signal_strength_I0: 0.95,
        lambda: 0.10,
        raw_payload: payload,
        pii_safe: true,
        geo_market: 'AE'
    };
}

export function adaptGulfNews(payload: GulfNewsCollectorPayload): RawSignal {
    return {
        signal_id: uuidv4(),
        source_id: 'gulfnews',
        source_tier: 'TIER_3',
        collected_at: new Date().toISOString(),
        company_name_raw: payload.headline,
        company_name_clean: cleanCompanyName(payload.headline),
        cin: null,
        geo_state: 'UAE',
        sector_inferred: 'General Business',
        signal_strength_I0: 0.70,
        lambda: 0.25,
        raw_payload: payload,
        pii_safe: true,
        geo_market: 'AE'
    };
}

export function adaptEtimad(payload: EtimadCollectorPayload): RawSignal {
    return {
        signal_id: uuidv4(),
        source_id: 'etimad',
        source_tier: 'TIER_1',
        collected_at: new Date().toISOString(),
        company_name_raw: payload.tender_title,
        company_name_clean: cleanCompanyName(payload.tender_title),
        cin: null,
        geo_state: 'UAE (Federal)',
        sector_inferred: payload.category || 'Government Procurement',
        signal_strength_I0: 0.90,
        lambda: 0.12,
        raw_payload: payload,
        pii_safe: true,
        geo_market: 'AE'
    };
}
