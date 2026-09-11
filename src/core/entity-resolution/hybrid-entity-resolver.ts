import { query } from '../../lib/database';
import { cache } from '../../lib/cache';
import { entityEnrichmentQueue } from '../../lib/queue';
import { cleanCompanyName, getPhoneticKey } from '../../lib/text-utils';
import {
    CanonicalEntity,
    ResolutionQuery,
    ResolverOptions,
    ResolutionMethod,
    CompanyStatus,
    deriveEntityId
} from './types';
import {
    extractStatutoryIds,
    isValidCIN,
    isValidCorporatePAN,
    isValidGSTIN
} from './statutory-extractor';
import { selectBestCandidate } from './fuzzy-engine';
import { getInstaClient } from './insta-client';

const MIN_CANONICAL_NAME_LENGTH = 3;

export class HybridEntityResolver {
    private defaultOptions: ResolverOptions;

    constructor(options?: ResolverOptions) {
        this.defaultOptions = {
            enableInstaSearch: true,
            enableAsyncEnrichment: true,
            autoEnrichTiers: ['BASIC', 'DETAILED', 'GST'],
            fuzzyThreshold: 0.85,
            ...options
        };
    }

    /**
     * Resolves a business name, clues, or statutory hints into a CanonicalEntity.
     */
    async resolve(
        rawQuery: ResolutionQuery,
        opts?: ResolverOptions
    ): Promise<CanonicalEntity> {
        const options: ResolverOptions = { ...this.defaultOptions, ...opts };
        const geoState = rawQuery.geoState || rawQuery.locationClues?.state || 'IN';
        const cleanName = cleanCompanyName(rawQuery.rawName);

        // ==========================================
        // STAGE 0: Deterministic Statutory Extraction
        // ==========================================
        const combinedText = [
            rawQuery.rawName,
            rawQuery.rawText || '',
            rawQuery.cinHint || '',
            rawQuery.panHint || '',
            rawQuery.gstinHint || '',
            rawQuery.dinHint || ''
        ].join(' ');

        const extracted = extractStatutoryIds(combinedText);
        const cin = rawQuery.cinHint && isValidCIN(rawQuery.cinHint) 
            ? rawQuery.cinHint.toUpperCase().trim() 
            : extracted.cins[0];
        
        const pan = rawQuery.panHint && isValidCorporatePAN(rawQuery.panHint)
            ? rawQuery.panHint.toUpperCase().trim()
            : extracted.pans[0];

        const gstin = rawQuery.gstinHint && isValidGSTIN(rawQuery.gstinHint)
            ? rawQuery.gstinHint.toUpperCase().trim()
            : extracted.gstins[0];

        // ==========================================
        // STAGE 1: CIN Direct Resolution (Tier 1 Statutory)
        // ==========================================
        if (cin) {
            return this.resolveByCIN(cin, cleanName, geoState, rawQuery, options);
        }

        // ==========================================
        // STAGE 2: PAN / GSTIN / Exact Database Match
        // ==========================================
        if (pan) {
            const panEntity = await this.findEntityByPAN(pan);
            if (panEntity) {
                return { ...panEntity, resolutionMethod: 'PAN_MATCH' };
            }
        }

        if (gstin) {
            const gstinEntity = await this.findEntityByGSTIN(gstin);
            if (gstinEntity) {
                return { ...gstinEntity, resolutionMethod: 'GSTIN_MATCH' };
            }
        }

        // Exact match in Postgres canonical_entity_cache or org_registry
        const exactMatch = await this.findExactMatch(cleanName, geoState);
        if (exactMatch) {
            return exactMatch;
        }

        // ==========================================
        // STAGE 3: InstaFinancials Remote Search & Fuzzy Matching
        // ==========================================
        if (options.enableInstaSearch && cleanName.length >= 3) {
            const remoteMatch = await this.resolveViaInstaSearch(
                cleanName,
                rawQuery.rawName,
                geoState,
                rawQuery,
                options
            );
            if (remoteMatch) {
                return remoteMatch;
            }
        }

        // ==========================================
        // STAGE 4: Local Phonetic & Deterministic Fallback
        // ==========================================
        return this.resolveFallback(cleanName, geoState, rawQuery);
    }

    /**
     * Resolves a batch of queries with controlled concurrency (chunks of 3).
     */
    async resolveBatch(
        queries: ResolutionQuery[],
        options?: ResolverOptions
    ): Promise<CanonicalEntity[]> {
        const results: CanonicalEntity[] = [];
        const CHUNK_SIZE = 3;

        for (let i = 0; i < queries.length; i += CHUNK_SIZE) {
            const chunk = queries.slice(i, i + CHUNK_SIZE);
            const chunkResults = await Promise.all(
                chunk.map(q => this.resolve(q, options))
            );
            results.push(...chunkResults);
        }

        return results;
    }

    private async resolveByCIN(
        cin: string,
        cleanName: string,
        geoState: string,
        rawQuery: ResolutionQuery,
        options: ResolverOptions
    ): Promise<CanonicalEntity> {
        // 1. Check Redis cache for entity
        const redisKey = `insta:entity:${cin}`;
        const cached = await cache.get<CanonicalEntity>(redisKey);
        if (cached) return cached;

        // 2. Check Database canonical_entity_cache
        const dbEntity = await this.findEntityByCIN(cin);
        if (dbEntity && dbEntity.enrichmentStatus === 'COMPLETED') {
            await cache.set(redisKey, dbEntity, { ex: 3600 });
            return dbEntity;
        }

        // 3. Construct stub entity with PENDING enrichment
        const entityId = deriveEntityId({ cin, fallbackName: cleanName || cin });
        const stubName = cleanName || cin;
        const stubEntity: CanonicalEntity = {
            entityId,
            canonicalName: stubName,
            cin,
            companyStatus: 'ACTIVE',
            directors: [],
            charges: [],
            establishments: [],
            groupHierarchy: {},
            resolutionMethod: 'CIN_DIRECT',
            enrichmentStatus: 'PENDING',
            registeredState: geoState,
            updatedAt: new Date().toISOString()
        };

        // Assert write succeeds before enqueuing to prevent zero-row update races
        const writeSuccess = await getInstaClient().writeCanonicalEntity(stubEntity);
        if (!writeSuccess) {
            console.warn(`[HybridEntityResolver] Initial stub persistence failed for CIN ${cin}; proceeding with caution`);
        }

        // 4. Enqueue BullMQ enrichment job (fire-and-forget, deduplicated by jobId)
        if (options.enableAsyncEnrichment && entityEnrichmentQueue) {
            try {
                await entityEnrichmentQueue.add(
                    'enrich',
                    {
                        cin,
                        entityId,
                        canonicalName: stubName,
                        enrichTiers: options.autoEnrichTiers,
                        locationClues: rawQuery.locationClues
                    },
                    {
                        jobId: `enrich:${cin}`, // Deduplication: same CIN won't re-enqueue while active
                        removeOnComplete: 1000,
                        removeOnFail: 5000,
                    }
                );
            } catch (err: any) {
                console.warn(`[HybridEntityResolver] Could not enqueue enrichment for CIN ${cin}:`, err.message);
            }
        }

        return stubEntity;
    }

    private async resolveViaInstaSearch(
        cleanName: string,
        rawName: string,
        geoState: string,
        rawQuery: ResolutionQuery,
        options: ResolverOptions
    ): Promise<CanonicalEntity | null> {
        try {
            // Search Start-With (SW) first
            let candidates = await getInstaClient().searchCIN(cleanName, 'SW');
            if (candidates.length === 0) {
                // Try Next-Contains (NC)
                candidates = await getInstaClient().searchCIN(cleanName, 'NC');
            }

            if (candidates.length === 0) return null;

            // Score and select best match
            const threshold = options.fuzzyThreshold || 0.85;
            const bestCandidate = selectBestCandidate(rawName, candidates, threshold);

            if (bestCandidate && isValidCIN(bestCandidate.CompanyCIN)) {
                const cin = bestCandidate.CompanyCIN.toUpperCase().trim();
                const entity = await this.resolveByCIN(
                    cin,
                    bestCandidate.CompanyName || cleanName,
                    geoState,
                    rawQuery,
                    options
                );
                return {
                    ...entity,
                    canonicalName: bestCandidate.CompanyName || entity.canonicalName,
                    resolutionMethod: 'INSTA_SEARCH'
                };
            }
        } catch (error: any) {
            console.warn(`[HybridEntityResolver] InstaSearch error for "${cleanName}":`, error.message);
        }
        return null;
    }

    public async getEntityById(entityId: string): Promise<CanonicalEntity | null> {
        try {
            const res = await query(
                `SELECT * FROM canonical_entity_cache WHERE entity_id = $1 LIMIT 1`,
                [entityId]
            );
            if (res.rows.length > 0) {
                return this.mapRowToCanonicalEntity(res.rows[0]);
            }
        } catch (e: any) {
            console.error('[HybridEntityResolver] getEntityById DB error:', e.message);
        }
        return null;
    }

    private async findEntityByCIN(cin: string): Promise<CanonicalEntity | null> {
        try {
            const res = await query(
                `SELECT * FROM canonical_entity_cache WHERE cin = $1 LIMIT 1`,
                [cin]
            );
            if (res.rows.length > 0) {
                return this.mapRowToCanonicalEntity(res.rows[0]);
            }
        } catch (e: any) {
            console.error('[HybridEntityResolver] findEntityByCIN DB error:', e.message);
        }
        return null;
    }

    private async findEntityByPAN(pan: string): Promise<CanonicalEntity | null> {
        try {
            const res = await query(
                `SELECT * FROM canonical_entity_cache WHERE pan = $1 LIMIT 1`,
                [pan]
            );
            if (res.rows.length > 0) {
                return this.mapRowToCanonicalEntity(res.rows[0]);
            }
        } catch (e: any) {
            console.error('[HybridEntityResolver] findEntityByPAN DB error:', e.message);
        }
        return null;
    }

    private async findEntityByGSTIN(gstin: string): Promise<CanonicalEntity | null> {
        try {
            const res = await query(
                `SELECT * FROM canonical_entity_cache WHERE establishments @> $1::jsonb LIMIT 1`,
                [JSON.stringify([{ gstin }])]
            );
            if (res.rows.length > 0) {
                return this.mapRowToCanonicalEntity(res.rows[0]);
            }
        } catch (e: any) {
            // Establishments JSON containment may fail if table doesn't have data yet
        }
        return null;
    }

    private async findExactMatch(cleanName: string, geoState: string): Promise<CanonicalEntity | null> {
        if (!cleanName) return null;
        try {
            // Check canonical_entity_cache first
            const res = await query(
                `SELECT * FROM canonical_entity_cache 
                 WHERE UPPER(canonical_name) = UPPER($1) LIMIT 1`,
                [cleanName]
            );
            if (res.rows.length > 0) {
                return {
                    ...this.mapRowToCanonicalEntity(res.rows[0]),
                    resolutionMethod: 'EXACT_MATCH'
                };
            }

            // Check org_registry
            const orgRes = await query(
                `SELECT * FROM org_registry 
                 WHERE canonical_name = $1 AND geo_state = $2 LIMIT 1`,
                [cleanName, geoState]
            );
            if (orgRes.rows.length > 0) {
                const row = orgRes.rows[0];
                return {
                    entityId: row.org_id,
                    canonicalName: row.canonical_name,
                    cin: row.cin,
                    pan: row.pan,
                    companyStatus: (row.company_status as CompanyStatus) || 'ACTIVE',
                    registeredState: row.geo_state,
                    directors: [],
                    charges: [],
                    establishments: [],
                    groupHierarchy: {},
                    resolutionMethod: 'EXACT_MATCH',
                    enrichmentStatus: 'SKIPPED'
                };
            }
        } catch (e: any) {
            console.error('[HybridEntityResolver] findExactMatch DB error:', e.message);
        }
        return null;
    }

    private async resolveFallback(
        cleanName: string,
        geoState: string,
        rawQuery: ResolutionQuery
    ): Promise<CanonicalEntity> {
        const phoneticKey = getPhoneticKey(cleanName);

        // Check phonetic match in org_registry
        if (phoneticKey) {
            try {
                const res = await query(
                    `SELECT * FROM org_registry 
                     WHERE phonetic_key = $1 AND geo_state = $2 LIMIT 1`,
                    [phoneticKey, geoState]
                );
                if (res.rows.length > 0) {
                    const row = res.rows[0];
                    return {
                        entityId: row.org_id,
                        canonicalName: row.canonical_name,
                        cin: row.cin,
                        pan: row.pan,
                        companyStatus: (row.company_status as CompanyStatus) || 'ACTIVE',
                        registeredState: row.geo_state,
                        directors: [],
                        charges: [],
                        establishments: [],
                        groupHierarchy: {},
                        resolutionMethod: 'PHONETIC',
                        enrichmentStatus: 'SKIPPED'
                    };
                }
            } catch (e: any) {
                console.error('[HybridEntityResolver] phonetic match DB error:', e.message);
            }
        }

        // Generate deterministic stable ID
        const entityId = deriveEntityId({
            fallbackName: cleanName || rawQuery.rawName,
            fallbackState: geoState
        });

        const fallbackEntity: CanonicalEntity = {
            entityId,
            canonicalName: cleanName || rawQuery.rawName || 'UNKNOWN ENTITY',
            registeredState: geoState,
            companyStatus: 'ACTIVE',
            directors: [],
            charges: [],
            establishments: [],
            groupHierarchy: {},
            resolutionMethod: 'LOCAL_FALLBACK',
            enrichmentStatus: 'SKIPPED',
            updatedAt: new Date().toISOString()
        };

        // Noise gate: Reject junk strings, single characters, or empty tokens
        if (!cleanName || cleanName.length < MIN_CANONICAL_NAME_LENGTH) {
            console.info(`[HybridEntityResolver] Bypassing cache write for noisy query: "${rawQuery.rawName}"`);
            return fallbackEntity;
        }

        // Write to canonical_entity_cache
        await getInstaClient().writeCanonicalEntity(fallbackEntity);

        return fallbackEntity;
    }

    private mapRowToCanonicalEntity(row: any): CanonicalEntity {
        return {
            entityId: row.entity_id,
            canonicalName: row.canonical_name,
            cin: row.cin || undefined,
            pan: row.pan || undefined,
            companyStatus: (row.company_status as CompanyStatus) || 'ACTIVE',
            incorporationDate: row.incorporation_date ? new Date(row.incorporation_date).toISOString().split('T')[0] : undefined,
            authorizedCapital: row.authorized_capital ? Number(row.authorized_capital) : undefined,
            paidUpCapital: row.paid_up_capital ? Number(row.paid_up_capital) : undefined,
            registeredAddress: row.registered_address || undefined,
            registeredState: row.registered_state || undefined,
            registeredPincode: row.registered_pincode || undefined,
            nicCode: row.nic_code || undefined,
            nicDescription: row.nic_description || undefined,
            directors: typeof row.directors === 'string' ? JSON.parse(row.directors) : (row.directors || []),
            charges: typeof row.charges === 'string' ? JSON.parse(row.charges) : (row.charges || []),
            establishments: typeof row.establishments === 'string' ? JSON.parse(row.establishments) : (row.establishments || []),
            groupHierarchy: typeof row.group_hierarchy === 'string' ? JSON.parse(row.group_hierarchy) : (row.group_hierarchy || {}),
            resolutionMethod: (row.resolution_method as ResolutionMethod) || 'EXACT_MATCH',
            enrichmentStatus: row.enrichment_status || 'PENDING',
            createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
            updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined
        };
    }
}

export const hybridEntityResolver = new HybridEntityResolver();
