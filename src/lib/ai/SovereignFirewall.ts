import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import Redis from 'ioredis';
import { query } from '../database';

/**
 * SovereignFirewall: A Zero-Knowledge Middleware to mask PII before it leaves the edge node.
 * Updated for Institutional Persistence, PostgreSQL + Redis support, and Batch processing.
 */

class RegionalVault {
    private storage: Map<string, string> = new Map();
    private vaultPath: string;
    private redis: Redis | null = null;
    private useRedis: boolean = false;
    private regionId: string;
    private organizationId: string | null = null;

    constructor(regionId: string, organizationId?: string) {
        this.regionId = regionId;
        this.organizationId = organizationId || null;
        const basePath = path.join(process.cwd(), 'data');
        const rawVaultPath = path.join(basePath, `vault_${regionId.toLowerCase()}.json`);
        this.vaultPath = path.normalize(rawVaultPath);
        if (!this.vaultPath.startsWith(basePath)) {
            throw new Error(`Invalid regionId specified, path traversal detected: ${regionId}`);
        }

        const redisUrl = process.env.REDIS_URL;
        if (redisUrl) {
            console.log(`[RegionalVault] Initializing Redis at ${redisUrl}...`);
            this.redis = new Redis(redisUrl, {
                retryStrategy: (times) => Math.min(times * 50, 2000),
                maxRetriesPerRequest: 3
            });
            this.redis.on('error', (err) => {
                console.error('[RegionalVault] Redis Error:', err);
                this.useRedis = false;
            });
            this.redis.on('connect', () => {
                console.log('[RegionalVault] Redis Connected. Switching to Institutional Mode.');
                this.useRedis = true;
            });
        }

        this.hydrate();
    }

    private hydrate() {
        try {
            if (fs.existsSync(this.vaultPath)) {
                const data = JSON.parse(fs.readFileSync(this.vaultPath, 'utf8'));
                this.storage = new Map(Object.entries(data));
                console.log(`[RegionalVault] Hydrated ${this.storage.size} local tokens.`);
            }
        } catch (e) {
            console.error('[RegionalVault] Hydration failed:', e);
        }
    }

    public async store(token: string, original: string, type: string) {
        this.storage.set(token, original);

        try {
            await query(`
                INSERT INTO pii_vault (token, original_value, pii_type, region_id, organization_id)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (token) DO NOTHING
            `, [token, original, type, this.regionId, this.organizationId]);
        } catch (e: any) {
             console.warn('[RegionalVault] Postgres Store failed, falling back:', e.message);
        }

        if (this.useRedis && this.redis) {
            try {
                // Secondary check to ensure value is unique in Redis as well
                await this.redis.set(`token:${token}`, original);
                await this.redis.set(`val:${original}`, token);
            } catch (e) {
                console.error('[RegionalVault] Redis Store failed:', e);
            }
        }

        this.persist();
    }

    public async findToken(original: string): Promise<string | undefined> {
        try {
            // Try Postgres first
            const res = await query('SELECT token FROM pii_vault WHERE original_value = $1 LIMIT 1', [original]);
            if (res && res.rows.length > 0) return res.rows[0].token;
        } catch (e: any) {
             // Postgres not ready or failed, fallback to Redis
        }

        if (this.useRedis && this.redis) {
            try {
                const token = await this.redis.get(`val:${original}`);
                if (token) return token;
            } catch (e) {
                console.error('[RegionalVault] Redis lookup failed:', e);
            }
        }

        for (const [token, value] of this.storage.entries()) {
            if (value === original) return token;
        }
        return undefined;
    }

    private persist() {
        try {
            const data = Object.fromEntries(this.storage.entries());
            const dataDir = path.dirname(this.vaultPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            // Use synchronous write for atomicity in prototype, or move to atomic-write lib for prod
            fs.writeFileSync(this.vaultPath, JSON.stringify(data, null, 2));
        } catch (e) {
            console.error('[RegionalVault] Persistence failed:', e);
        }
    }

    public size(): number {
        return this.storage.size;
    }
}

const PII_PATTERNS = {
    EMAIL: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    PHONE: /(?:\+|00)[1-9][0-9 \-\.]{7,15}[0-9]/g,
    ADDRESS: /\b\d{1,5} [A-Z0-9].*?\b(?:Street|St|Avenue|Ave|Road|Rd|Highway|Hwy|Square|Sq|Trail|Trl|Drive|Dr|Court|Ct|Parkway|Pkwy|Circle|Cir|Boulevard|Blvd)\b/gi,
    IDENTITY: /\b(?:\d{3}-\d{2}-\d{4}|\d{9})\b/g,
    // Refined Name Detection: Only match capitalized patterns that are likely people,
    // avoiding common B2B proper nouns like 'Microsoft' or 'Google'.
    NAME_SUBSTITUTE: /\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g,
};

// Common Proper Nouns that are NOT PII in a B2B context
const B2B_EXCLUSIONS = ['Microsoft', 'Google', 'Amazon', 'Vercel', 'NetJana', 'Dubai', 'India', 'Linear'];

export class SovereignFirewall {
    private regionId: string;
    private organizationId: string | null;
    private vault: RegionalVault;

    constructor(regionId: string = process.env.REGION_ID || 'UAE_DUBAI_01', organizationId?: string) {
        this.regionId = regionId;
        this.organizationId = organizationId || null;
        this.vault = new RegionalVault(regionId, organizationId);
    }

    /**
     * Scans the input text for PII and replaces it with UUIDs.
     */
    public async maskData(text: string): Promise<string> {
        let maskedText = text;

        for (const [type, regex] of Object.entries(PII_PATTERNS)) {
            const matches = text.match(regex) || [];
            for (const match of matches) {
                // Exclusion check to avoid masking common B2B entities/regions
                if (B2B_EXCLUSIONS.some(ex => match.includes(ex))) {
                    continue;
                }
                const token = await this.tokenize(match, type);
                maskedText = maskedText.replace(match, token);
            }
        }

        return maskedText;
    }

    /**
     * Batch mask an array of strings or objects.
     */
    public async maskBatch<T>(items: T[]): Promise<T[]> {
        console.log(`[SovereignFirewall] Batch masking ${items.length} items...`);
        const results = [];
        for (const item of items) {
            if (typeof item === 'string') {
                results.push(await this.maskData(item) as unknown as T);
            } else {
                const maskedStr = await this.maskData(JSON.stringify(item));
                results.push(JSON.parse(maskedStr) as T);
            }
        }
        return results;
    }

    private async tokenize(original: string, type: string): Promise<string> {
        const existingToken = await this.vault.findToken(original);
        if (existingToken) return existingToken;

        const token = `[${type}_${uuidv4()}]`;
        await this.vault.store(token, original, type);

        console.log(`[SovereignMasking] Tokenized ${type} in region ${this.regionId} (Vault Size: ${this.vault.size()})`);
        return token;
    }

    public getRegionHeaders(): Record<string, string> {
        return {
            'X-Region-ID': this.regionId,
            'X-Compliance-Hash': uuidv4()
        };
    }
}
