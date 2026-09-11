import { doubleMetaphone } from 'double-metaphone';

export const LEGAL_SUFFIXES = [
    'PRIVATE LIMITED', 'PVT LTD', 'PVT. LTD.', 'PVT LTD.', 'PRIVATE LTD',
    'PUBLIC LIMITED', 'LIMITED', 'LTD', 'LLP', 'LLC',
    'INCORPORATED', 'INC', '& CO', 'AND CO', 'CORPORATION', 'CORP',
    'FZE', 'FZCO', 'PJSC', 'PSC'
];

export const INDUSTRY_NOISE = [
    'INDUSTRIES', 'INDUSTRY', 'ENTERPRISE', 'ENTERPRISES',
    'TRADING', 'TRADERS', 'INTERNATIONAL', 'INDIA', 'INDIAN',
    'EXPORTS', 'IMPORTS', 'SOLUTIONS', 'SERVICES', 'SYSTEMS',
    'TECHNOLOGIES', 'TECH', 'GROUP', 'ASSOCIATES', 'GLOBAL',
    'MANUFACTURING', 'MANUFACTURERS', 'SUPPLIERS', 'SUPPLIER',
    'DISTRIBUTORS', 'DISTRIBUTION', 'LOGISTICS', 'VENTURES',
];

const PREFIX_PATTERNS = [
    /^(?:M\/S\.?|MESSRS\.?|SHRI|SRI|SHREE)\s+/i
];

function stripLegalSuffix(name: string): string {
    let cleanName = name.trim();
    let previous = '';

    while (cleanName !== previous) {
        previous = cleanName;
        const withoutTrailingComma = cleanName.replace(/,\s*$/, '').trim();
        const suffix = LEGAL_SUFFIXES
            .map(item => item.trim())
            .find(item => withoutTrailingComma === item || withoutTrailingComma.endsWith(` ${item}`) || withoutTrailingComma.endsWith(` ${item}.`));

        if (suffix) {
            cleanName = withoutTrailingComma.slice(0, -suffix.length).replace(/,\s*$/, '').trim();
        }
    }

    return cleanName;
}

export function cleanCompanyName(raw: string): string {
    if (!raw) return '';
    let name = raw.trim();

    // 1. Strip common honorific prefixes
    for (const prefix of PREFIX_PATTERNS) {
        name = name.replace(prefix, '');
    }

    // 2. Strip legal suffixes
    name = stripLegalSuffix(name.toUpperCase());

    // 3. Remove industry noise words when other words remain
    const words = name.split(/\s+/);
    if (words.length > 1) {
        const filtered = words.filter(w => !INDUSTRY_NOISE.includes(w));
        if (filtered.length > 0) {
            name = filtered.join(' ');
        }
    }

    // 4. Normalize special characters (preserving Arabic range) and collapse whitespace
    name = name.replace(/[^A-Z0-9\s\u0600-\u06FF]/g, '').replace(/\s+/g, ' ').trim();
    return name;
}

export function getPhoneticKey(cleanName: string): string {
    if (!cleanName) return '';
    const words = cleanName.split(/\s+/);
    return words
        .map(w => doubleMetaphone(w)[0])
        .filter(Boolean)
        .join('-');
}
