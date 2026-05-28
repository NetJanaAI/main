import { doubleMetaphone } from 'double-metaphone';
import axios from 'axios';
import crypto from 'crypto';
import { cache } from '../lib/cache';
import { query } from '../lib/database';

const LEGAL_SUFFIXES = [
    'PRIVATE LIMITED', 'PVT LTD', 'PVT. LTD.', 'PRIVATE LTD',
    'PUBLIC LIMITED', 'LIMITED', ' LTD', ' LLP', ' LLC',
    'INCORPORATED', '& CO', 'AND CO', 'CORPORATION', 'CORP',
];

const INDUSTRY_NOISE = [
    'INDUSTRIES', 'INDUSTRY', 'ENTERPRISE', 'ENTERPRISES',
    'TRADING', 'TRADERS', 'INTERNATIONAL', 'INDIA', 'INDIAN',
    'EXPORTS', 'IMPORTS', 'SOLUTIONS', 'SERVICES', 'SYSTEMS',
    'TECHNOLOGIES', 'TECH', 'GROUP', 'ASSOCIATES', 'GLOBAL',
    'MANUFACTURING', 'MANUFACTURERS', 'SUPPLIERS', 'SUPPLIER',
    'DISTRIBUTORS', 'DISTRIBUTION', 'LOGISTICS', 'VENTURES',
];

function stripLegalSuffix(name: string): string {
    let cleanName = name.trim();
    let previous = '';

    while (cleanName !== previous) {
        previous = cleanName;
        const withoutTrailingComma = cleanName.replace(/,\s*$/, '').trim();
        const suffix = LEGAL_SUFFIXES
            .map(item => item.trim())
            .find(item => withoutTrailingComma === item || withoutTrailingComma.endsWith(` ${item}`));

        if (suffix) {
            cleanName = withoutTrailingComma.slice(0, -suffix.length).replace(/,\s*$/, '').trim();
        }
    }

    return cleanName;
}

export function cleanCompanyName(raw: string): string {
    let name = stripLegalSuffix(raw.toUpperCase().trim());

    const words = name.split(/\s+/);
    if (words.length > 1) {
        const filtered = words.filter(w => !INDUSTRY_NOISE.includes(w));
        if (filtered.length > 0) name = filtered.join(' ');
    }

    name = name.replace(/[^A-Z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    return name;
}

export function getPhoneticKey(cleanName: string): string {
    const words = cleanName.split(' ');
    return words
        .map(w => doubleMetaphone(w)[0])
        .filter(Boolean)
        .join('-');
}

export async function resolveEntity(
    rawName: string,
    geoState: string,
    cinHint?: string | null,
    rawNameAlias?: string | null,
    sourceId?: string | null,
    geoMarket?: string | null
): Promise<string> {
    const cleanName = cleanCompanyName(rawName);
    const phoneticKey = getPhoneticKey(cleanName);
    const stateCode = geoState.toUpperCase().slice(0, 2);

    // 1. Exact match on clean name + state (Read-through Cache)
    const exactKey = `entity:exact:${cleanName}:${stateCode}`;
    const cachedId = await cache.get<string>(exactKey);
    if (cachedId) {
        await touchOrgLastSeen(cachedId);
        return cachedId;
    }

    // Postgres lookup for exact match
    const exactRes = await query(
        'SELECT org_id FROM org_registry WHERE canonical_name = $1 AND geo_state = $2 LIMIT 1',
        [cleanName, geoState]
    );
    if (exactRes.rows[0]) {
        const orgId = exactRes.rows[0].org_id;
        await cache.set(exactKey, orgId, { ex: 86400 }); // 24h cache
        await touchOrgLastSeen(orgId);
        return orgId;
    }

    // 2. CIN lookup (Read-through Cache)
    if (cinHint) {
        const cinKey = `entity:cin:${cinHint}`;
        const cachedCin = await cache.get<string>(cinKey);
        if (cachedCin) {
            await cache.set(exactKey, cachedCin, { ex: 86400 });
            return cachedCin;
        }

        const cinRes = await query('SELECT org_id FROM org_registry WHERE cin = $1 LIMIT 1', [cinHint]);
        if (cinRes.rows[0]) {
            const orgId = cinRes.rows[0].org_id;
            await cache.set(cinKey, orgId, { ex: 86400 });
            await cache.set(exactKey, orgId, { ex: 86400 });
            return orgId;
        }

        // New Org with CIN
        await registerOrg(cinHint, cleanName, geoState, phoneticKey, 'CIN', cinHint);
        await cache.set(exactKey, cinHint, { ex: 86400 });
        await cache.set(cinKey, cinHint, { ex: 86400 });
        return cinHint;
    }

    // 3. Phonetic match (Postgres Index)
    const phoneticRes = await query(
        'SELECT org_id, canonical_name FROM org_registry WHERE phonetic_key = $1 AND geo_state = $2 ORDER BY signal_count DESC LIMIT 10',
        [phoneticKey, geoState]
    );

    if (phoneticRes.rows.length > 0) {
        const bestMatchId = selectBestPhoneticMatch(cleanName, phoneticRes.rows);
        if (bestMatchId) {
            await cache.set(exactKey, bestMatchId, { ex: 86400 });
            await logMerge(rawName, cleanName, bestMatchId, 'PHONETIC');
            await touchOrgLastSeen(bestMatchId);
            return bestMatchId;
        }
    }

    // 4. MCA API Fallback
    if (process.env.SANDBOX_API_KEY) {
        try {
            const response = await axios.get('https://api.sandbox.co.in/entity/gstin/v2/details', {
                headers: { 'x-api-key': process.env.SANDBOX_API_KEY },
                params: { legal_name: cleanName }
            });
            const data = response.data;
            if (data?.data?.cin || data?.data?.id) {
                const orgId = data.data.cin || data.data.id;
                await registerOrg(orgId, cleanName, geoState, phoneticKey, 'MCA_API', data.data.cin || null);
                await cache.set(exactKey, orgId, { ex: 86400 });
                if (data.data.cin) await cache.set(`entity:cin:${data.data.cin}`, orgId, { ex: 86400 });
                return orgId;
            }
        } catch (e) {
            console.warn(`[EntityResolver] MCA API lookup failed for ${cleanName}`);
        }
    }

    // 5. Generate stable local ID
    const localId = 'local_' + crypto
        .createHash('sha256')
        .update(`${cleanName}:${stateCode}`)
        .digest('hex')
        .slice(0, 12);

    await registerOrg(localId, cleanName, geoState, phoneticKey, 'LOCAL');
    await cache.set(exactKey, localId, { ex: 86400 });
    return localId;
}

async function registerOrg(
    orgId: string,
    cleanName: string,
    geoState: string,
    phoneticKey: string,
    resolutionMethod: string,
    cin?: string | null
): Promise<void> {
    await query(`
        INSERT INTO org_registry (
            org_id, canonical_name, geo_state, phonetic_key, cin, resolution_method
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (org_id) DO UPDATE SET 
            last_signal_at = NOW(),
            signal_count = org_registry.signal_count + 1
    `, [orgId, cleanName, geoState, phoneticKey, cin || null, resolutionMethod]);
}

function selectBestPhoneticMatch(
    cleanName: string,
    candidates: any[]
): string | null {
    const incomingWords = new Set(cleanName.split(' '));
    for (const cand of candidates) {
        const existingWords = new Set((cand.canonical_name || '').split(' '));
        const overlap = [...incomingWords].filter(w => existingWords.has(w));
        const overlapRatio = overlap.length / Math.max(incomingWords.size, 1);
        // H-03: Raised from 0.5 to 0.67 — prevents false merges like TATA STEEL ↔ TATA MOTORS
        if (overlapRatio >= 0.67) {
            return cand.org_id;
        }
    }
    return null;
}

async function touchOrgLastSeen(orgId: string): Promise<void> {
    await query(
        'UPDATE org_registry SET last_signal_at = NOW(), signal_count = signal_count + 1 WHERE org_id = $1',
        [orgId]
    );
}

async function logMerge(rawName: string, cleanName: string, orgId: string, method: string): Promise<void> {
    await query(
        'INSERT INTO entity_merge_log (raw_name, clean_name, merged_into, resolution_method) VALUES ($1, $2, $3, $4)',
        [rawName, cleanName, orgId, method]
    );
}

function nameToLockId(name: string): number {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = (Math.imul(31, hash) + name.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

export async function resolveEntitySafe(
    rawName: string,
    geoState: string,
    cinHint?: string | null,
    rawNameAlias?: string | null,
    sourceId?: string | null,
    geoMarket?: string | null,
    _retryCount: number = 0  // H-04: depth limiter
): Promise<string> {
    const MAX_LOCK_RETRIES = 10;
    const cleanName = cleanCompanyName(rawName);
    const lockId = nameToLockId(`${cleanName}:${geoState.slice(0, 2)}`);

    // Postgres advisory lock
    const { rows } = await query('SELECT pg_try_advisory_lock($1)', [lockId]);
    const acquired = rows[0].pg_try_advisory_lock;

    if (!acquired) {
        if (_retryCount >= MAX_LOCK_RETRIES) {
            console.warn(`[EntityResolver] Advisory lock exhausted after ${MAX_LOCK_RETRIES} retries for ${cleanName}. Falling back to unsynchronized resolve.`);
            return resolveEntity(rawName, geoState, cinHint, rawNameAlias, sourceId, geoMarket);
        }
        await new Promise(resolve => setTimeout(resolve, 300));
        return resolveEntitySafe(rawName, geoState, cinHint, rawNameAlias, sourceId, geoMarket, _retryCount + 1);
    }

    try {
        return await resolveEntity(rawName, geoState, cinHint, rawNameAlias, sourceId, geoMarket);
    } finally {
        await query('SELECT pg_advisory_unlock($1)', [lockId]);
    }
}
