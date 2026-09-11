import { StatutoryExtractionResult } from './types';

export const CIN_REGEX = /^[LUu][0-9]{5}[A-Za-z]{2}[0-9]{4}[A-Za-z]{3}[0-9]{6}$/;
export const CORP_PAN_REGEX = /^[A-Za-z]{3}C[A-Za-z][0-9]{4}[A-Za-z]$/;
export const GSTIN_REGEX = /^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z]Z[0-9A-Za-z]$/;
export const DIN_REGEX = /^[0-9]{8}$/;

const CIN_EXTRACT_RE = /\b[LUu][0-9]{5}[A-Za-z]{2}[0-9]{4}[A-Za-z]{3}[0-9]{6}\b/g;
const CORP_PAN_EXTRACT_RE = /\b[A-Za-z]{3}C[A-Za-z][0-9]{4}[A-Za-z]\b/g;
const GSTIN_EXTRACT_RE = /\b[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z]Z[0-9A-Za-z]\b/g;
const DIN_EXTRACT_RE = /\b(?:DIN|DIRECTOR IDENTIFICATION NUMBER)[\s:#-]*([0-9]{8})\b/gi;

export const VALID_GSTIN_STATE_CODES: Record<string, string> = {
    '01': 'Jammu and Kashmir',
    '02': 'Himachal Pradesh',
    '03': 'Punjab',
    '04': 'Chandigarh',
    '05': 'Uttarakhand',
    '06': 'Haryana',
    '07': 'Delhi',
    '08': 'Rajasthan',
    '09': 'Uttar Pradesh',
    '10': 'Bihar',
    '11': 'Sikkim',
    '12': 'Arunachal Pradesh',
    '13': 'Nagaland',
    '14': 'Manipur',
    '15': 'Mizoram',
    '16': 'Tripura',
    '17': 'Meghalaya',
    '18': 'Assam',
    '19': 'West Bengal',
    '20': 'Jharkhand',
    '21': 'Odisha',
    '22': 'Chhattisgarh',
    '23': 'Madhya Pradesh',
    '24': 'Gujarat',
    '25': 'Daman and Diu',
    '26': 'Dadra and Nagar Haveli and Daman and Diu',
    '27': 'Maharashtra',
    '28': 'Andhra Pradesh (Old)',
    '29': 'Karnataka',
    '30': 'Goa',
    '31': 'Lakshadweep',
    '32': 'Kerala',
    '33': 'Tamil Nadu',
    '34': 'Puducherry',
    '35': 'Andaman and Nicobar Islands',
    '36': 'Telangana',
    '37': 'Andhra Pradesh',
    '38': 'Ladakh',
    '96': 'Other Territory',
    '97': 'Other Territory',
    '99': 'Centre Jurisdiction',
};

export const UNSUPPORTED_GST_STATE_CODES = new Set(['96', '97', '99']);

export function isValidCIN(cin: string): boolean {
    if (!cin || typeof cin !== 'string') return false;
    return CIN_REGEX.test(cin.trim());
}

export function isValidCorporatePAN(pan: string): boolean {
    if (!pan || typeof pan !== 'string') return false;
    const clean = pan.trim().toUpperCase();
    return CORP_PAN_REGEX.test(clean);
}

const MOD36_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function validateGSTINChecksum(gstin: string): boolean {
    if (!gstin || gstin.length !== 15) return false;
    const clean = gstin.toUpperCase();

    let sum = 0;
    for (let i = 0; i < 14; i++) {
        const char = clean[i];
        const val = MOD36_CHARS.indexOf(char);
        if (val === -1) return false;

        const factor = (i % 2 === 0) ? 1 : 2;
        const product = val * factor;
        const quotient = Math.floor(product / 36);
        const remainder = product % 36;
        sum += quotient + remainder;
    }

    const checkCode = (36 - (sum % 36)) % 36;
    const checkChar = MOD36_CHARS[checkCode];
    return clean[14] === checkChar;
}

export function isValidGSTIN(gstin: string, validateChecksum: boolean = false): boolean {
    if (!gstin || typeof gstin !== 'string') return false;
    const clean = gstin.trim().toUpperCase();
    if (!GSTIN_REGEX.test(clean)) return false;
    
    const stateCode = clean.substring(0, 2);
    if (!VALID_GSTIN_STATE_CODES[stateCode]) return false;

    if (validateChecksum) {
        return validateGSTINChecksum(clean);
    }
    return true;
}

/**
 * Extracts corporate statutory identifiers from text or unstructured fields.
 */
export function extractStatutoryIds(text: string): StatutoryExtractionResult {
    if (!text || typeof text !== 'string') {
        return { cins: [], pans: [], gstins: [], dins: [] };
    }

    const cleanText = text.toUpperCase();

    // 1. CINs
    const cinMatches = cleanText.match(CIN_EXTRACT_RE) || [];
    const cins = Array.from(new Set(cinMatches.filter(c => isValidCIN(c))));

    // 2. GSTINs
    const gstinMatches = cleanText.match(GSTIN_EXTRACT_RE) || [];
    const gstins = Array.from(new Set(gstinMatches.filter(g => isValidGSTIN(g))));

    // 3. Corporate PANs: extracted matches + PANs embedded in GSTINs (chars 2..11)
    const panMatches = cleanText.match(CORP_PAN_EXTRACT_RE) || [];
    const panSet = new Set<string>();

    for (const p of panMatches) {
        if (isValidCorporatePAN(p)) panSet.add(p);
    }

    // Extract embedded PANs from GSTINs if 4th char is 'C' (Corporate entity)
    for (const g of gstins) {
        const embeddedPan = g.substring(2, 12);
        if (isValidCorporatePAN(embeddedPan)) {
            panSet.add(embeddedPan);
        }
    }

    // 4. DINs: only matches with explicit DIN label prefix
    const dinSet = new Set<string>();
    let dinMatch: RegExpExecArray | null;
    const dinRegexCopy = new RegExp(DIN_EXTRACT_RE.source, 'gi');
    while ((dinMatch = dinRegexCopy.exec(text)) !== null) {
        if (dinMatch[1] && DIN_REGEX.test(dinMatch[1])) {
            dinSet.add(dinMatch[1]);
        }
    }

    return {
        cins,
        pans: Array.from(panSet),
        gstins,
        dins: Array.from(dinSet)
    };
}
