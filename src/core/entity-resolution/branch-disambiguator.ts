import { Establishment, LocationClue } from './types';
import { VALID_GSTIN_STATE_CODES } from './statutory-extractor';

export const PINCODE_REGEX = /\b[1-9][0-9]{5}\b/;

export const STATE_CODE_TO_NAME: Record<string, string> = { ...VALID_GSTIN_STATE_CODES };

export const STATE_NAME_ALIASES: Record<string, string> = {
    'MAHARASHTRA': 'Maharashtra',
    'MH': 'Maharashtra',
    'DELHI': 'Delhi',
    'DL': 'Delhi',
    'NEW DELHI': 'Delhi',
    'KARNATAKA': 'Karnataka',
    'KA': 'Karnataka',
    'TAMIL NADU': 'Tamil Nadu',
    'TN': 'Tamil Nadu',
    'GUJARAT': 'Gujarat',
    'GJ': 'Gujarat',
    'UTTAR PRADESH': 'Uttar Pradesh',
    'UP': 'Uttar Pradesh',
    'HARYANA': 'Haryana',
    'HR': 'Haryana',
    'TELANGANA': 'Telangana',
    'TS': 'Telangana',
    'TG': 'Telangana',
    'WEST BENGAL': 'West Bengal',
    'WB': 'West Bengal',
    'RAJASTHAN': 'Rajasthan',
    'RJ': 'Rajasthan',
    'KERALA': 'Kerala',
    'KL': 'Kerala',
    'ANDHRA PRADESH': 'Andhra Pradesh',
    'AP': 'Andhra Pradesh',
    'MADHYA PRADESH': 'Madhya Pradesh',
    'MP': 'Madhya Pradesh',
    'PUNJAB': 'Punjab',
    'PB': 'Punjab',
    'BIHAR': 'Bihar',
    'BR': 'Bihar',
    'ODISHA': 'Odisha',
    'ORISSA': 'Odisha',
    'OR': 'Odisha',
    'OD': 'Odisha',
    'JHARKHAND': 'Jharkhand',
    'JH': 'Jharkhand',
    'ASSAM': 'Assam',
    'AS': 'Assam',
    'CHHATTISGARH': 'Chhattisgarh',
    'CG': 'Chhattisgarh',
    'CT': 'Chhattisgarh',
    'GOA': 'Goa',
    'GA': 'Goa',
    'UTTARAKHAND': 'Uttarakhand',
    'UK': 'Uttarakhand',
    'UA': 'Uttarakhand',
    'HIMACHAL PRADESH': 'Himachal Pradesh',
    'HP': 'Himachal Pradesh',
    'CHANDIGARH': 'Chandigarh',
    'CH': 'Chandigarh',
    'JAMMU AND KASHMIR': 'Jammu and Kashmir',
    'JK': 'Jammu and Kashmir',
    'PUDUCHERRY': 'Puducherry',
    'PY': 'Puducherry',
};

export function normalizeStateName(stateInput?: string | null): string | null {
    if (!stateInput) return null;
    const clean = stateInput.trim().toUpperCase();
    if (STATE_NAME_ALIASES[clean]) {
        return STATE_NAME_ALIASES[clean];
    }
    // Check state code lookup (e.g. '27' -> 'Maharashtra')
    if (STATE_CODE_TO_NAME[clean]) {
        return STATE_CODE_TO_NAME[clean];
    }
    return stateInput.trim();
}

/**
 * Calculates a match score between an establishment address text and query location clues.
 * Score weights:
 * - PIN code match: 0.50
 * - City match: 0.35
 * - State match: 0.15
 */
export function scoreAddress(
    addressText: string,
    locationClues?: LocationClue | null
): number {
    if (!addressText || !locationClues) return 0.0;
    const target = addressText.toUpperCase();
    let score = 0.0;

    // 1. PIN code match (0.50)
    let queryPin = locationClues.pincode;
    if (!queryPin && locationClues.rawLocationText) {
        const match = locationClues.rawLocationText.match(PINCODE_REGEX);
        if (match) queryPin = match[0];
    }
    if (queryPin && target.includes(queryPin.trim())) {
        score += 0.50;
    }

    // 2. City match (0.35)
    if (locationClues.city && locationClues.city.trim().length >= 3) {
        const cityUpper = locationClues.city.trim().toUpperCase();
        if (target.includes(cityUpper)) {
            score += 0.35;
        }
    }

    // 3. State match (0.15)
    const normState = normalizeStateName(locationClues.state);
    if (normState) {
        const stateUpper = normState.toUpperCase();
        if (target.includes(stateUpper)) {
            score += 0.15;
        }
    }

    return Number(score.toFixed(2));
}

/**
 * Disambiguates and ranks branch establishments against query location clues.
 */
export function disambiguateBranches(
    establishments: Establishment[],
    locationClues?: LocationClue | null
): {
    primaryEstablishment: Establishment | null;
    scoredEstablishments: Array<{ establishment: Establishment; score: number }>;
} {
    if (!establishments || establishments.length === 0) {
        return { primaryEstablishment: null, scoredEstablishments: [] };
    }

    if (!locationClues) {
        return {
            primaryEstablishment: establishments[0] || null,
            scoredEstablishments: establishments.map(e => ({ establishment: e, score: 0 }))
        };
    }

    const scored = establishments.map(est => {
        const fullAddress = [
            est.address || '',
            est.pincode || '',
            est.stateName || '',
            STATE_CODE_TO_NAME[est.stateCode] || '',
            est.tradeName || ''
        ].join(' ');

        const score = scoreAddress(fullAddress, locationClues);
        return {
            establishment: { ...est },
            score
        };
    });

    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (best && best.score > 0) {
        best.establishment.isPrimary = true;
        return {
            primaryEstablishment: best.establishment,
            scoredEstablishments: scored
        };
    }

    // Default first establishment if no positive match
    if (scored.length > 0) {
        scored[0].establishment.isPrimary = true;
        return {
            primaryEstablishment: scored[0].establishment,
            scoredEstablishments: scored
        };
    }

    return { primaryEstablishment: null, scoredEstablishments: [] };
}
