import {
    extractStatutoryIds,
    isValidCIN,
    isValidCorporatePAN,
    isValidGSTIN
} from '../entity-resolution/statutory-extractor';
import {
    jaroWinkler,
    tokenSortRatio,
    compositeScore,
    selectBestCandidate
} from '../entity-resolution/fuzzy-engine';
import {
    scoreAddress,
    disambiguateBranches,
    normalizeStateName
} from '../entity-resolution/branch-disambiguator';
import {
    InstaClient,
    getInstaClient,
    PAN_INDIA_GST_SENTINEL,
    resolveStateCode
} from '../entity-resolution/insta-client';
import {
    HybridEntityResolver
} from '../entity-resolution/hybrid-entity-resolver';
import { deriveEntityId } from '../entity-resolution/types';

jest.mock('axios-retry', () => {
    const fn = jest.fn();
    (fn as any).exponentialDelay = jest.fn();
    (fn as any).isNetworkOrIdempotentRequestError = jest.fn();
    return fn;
});
import { cache } from '../../lib/cache';
import { query } from '../../lib/database';
import { entityEnrichmentQueue } from '../../lib/queue';
import axios from 'axios';

jest.mock('double-metaphone', () => ({
    doubleMetaphone: jest.fn((word: string) => [word.toUpperCase().slice(0, 4), ''])
}));

jest.mock('../../lib/cache', () => ({
    cache: {
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn()
    }
}));

jest.mock('../../lib/database', () => ({
    query: jest.fn()
}));

jest.mock('../../lib/queue', () => {
    const mockQueue = {
        add: jest.fn().mockResolvedValue({ id: 'mock-job-1' }),
        close: jest.fn()
    };
    return {
        ENTITY_ENRICHMENT_QUEUE_NAME: 'entity_enrichment',
        entityEnrichmentQueue: mockQueue,
        connection: {}
    };
});

jest.mock('axios', () => {
    const mockInstance = {
        get: jest.fn(),
        post: jest.fn(),
        interceptors: {
            request: { use: jest.fn(), eject: jest.fn() },
            response: { use: jest.fn(), eject: jest.fn() }
        }
    };
    return {
        __esModule: true,
        default: {
            create: jest.fn(() => mockInstance),
            get: jest.fn(),
            post: jest.fn(),
            defaults: { headers: { common: {} } }
        },
        create: jest.fn(() => mockInstance),
        get: jest.fn(),
        post: jest.fn()
    };
});

describe('Hybrid Entity Resolution Subsystem', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('1. Statutory Key Extractor (Tier 1)', () => {
        it('should correctly validate MCA Corporate Identity Numbers (CIN)', () => {
            expect(isValidCIN('U72200MH2010PTC201234')).toBe(true);
            expect(isValidCIN('L17110MH1973PLC019786')).toBe(true);
            expect(isValidCIN('invalid-cin-123')).toBe(false);
            expect(isValidCIN('U72200MH2010PTC20123')).toBe(false); // 20 chars (too short)
        });

        it('should validate Corporate PAN (4th character must be C)', () => {
            expect(isValidCorporatePAN('AAACR5000K')).toBe(true);
            expect(isValidCorporatePAN('ABCDE1234F')).toBe(false); // 4th char is D
            expect(isValidCorporatePAN('AAAPR5000K')).toBe(false); // 4th char is P (Individual)
        });

        it('should validate GSTIN and recognized state codes', () => {
            expect(isValidGSTIN('27AAACR5000K1Z5')).toBe(true);
            expect(isValidGSTIN('07AAACR5000K1Z5')).toBe(true);
            expect(isValidGSTIN('99AAACR5000K1Z5')).toBe(true); // Center jurisdiction
            expect(isValidGSTIN('00AAACR5000K1Z5')).toBe(false); // Invalid state 00
            expect(isValidGSTIN('short_gst')).toBe(false);
        });

        it('should extract all statutory keys from messy unstructured text', () => {
            const rawText = `
                Vendor: ABC Technologies Pvt Ltd
                CIN: U72200MH2010PTC201234, GSTIN: 27AAACR5000K1Z5
                Director Details: DIN: 01234567, Phone: 9876543210 (not a DIN)
                Secondary PAN: AAACR5000K mentioned.
            `;
            const res = extractStatutoryIds(rawText);
            expect(res.cins).toContain('U72200MH2010PTC201234');
            expect(res.gstins).toContain('27AAACR5000K1Z5');
            expect(res.pans).toContain('AAACR5000K');
            expect(res.dins).toContain('01234567');
            expect(res.dins).not.toContain('9876543210');
        });
    });

    describe('2. Fuzzy Matching & Candidate Scoring Engine', () => {
        it('should compute Jaro-Winkler similarity accurately', () => {
            expect(jaroWinkler('INFOSYS', 'INFOSYS')).toBe(1.0);
            expect(jaroWinkler('INFOSYS LIMITED', 'INFOSYS')).toBeGreaterThan(0.8);
            expect(jaroWinkler('RELIANCE', 'TATA')).toBeLessThan(0.6);
        });

        it('should compute Token Sort Ratio invariant to word order', () => {
            const s1 = 'TATA CONSULTANCY SERVICES';
            const s2 = 'SERVICES CONSULTANCY TATA';
            expect(tokenSortRatio(s1, s2)).toBe(1.0);
        });

        it('should calculate composite score and rank candidates', () => {
            const score = compositeScore('Reliance Industries Limited', 'RELIANCE INDUSTRIES');
            expect(score).toBeGreaterThanOrEqual(0.85);

            const candidates = [
                { CompanyCIN: 'U11111MH2000PTC111111', CompanyName: 'UNL RELATED PVT LTD', CompanyStatus: 'ACTIVE' },
                { CompanyCIN: 'U22222MH2000PTC222222', CompanyName: 'RELIANCE PETROCHEM LIMITED', CompanyStatus: 'ACTIVE' },
                { CompanyCIN: 'L17110MH1973PLC019786', CompanyName: 'RELIANCE INDUSTRIES LIMITED', CompanyStatus: 'ACTIVE' }
            ];

            const match = selectBestCandidate('Reliance Industries Ltd', candidates, 0.85);
            expect(match).not.toBeNull();
            expect(match?.CompanyCIN).toBe('L17110MH1973PLC019786');
        });
    });

    describe('3. Branch & GSTIN Disambiguator', () => {
        it('should normalize state aliases and codes', () => {
            expect(normalizeStateName('MH')).toBe('Maharashtra');
            expect(normalizeStateName('27')).toBe('Maharashtra');
            expect(normalizeStateName('DL')).toBe('Delhi');
            expect(normalizeStateName('Karnataka')).toBe('Karnataka');
        });

        it('should score address matching PIN code, city, and state', () => {
            const address = 'Plot 42, Bandra Kurla Complex, Mumbai, Maharashtra 400051';
            const clues = { pincode: '400051', city: 'Mumbai', state: 'MH' };
            const score = scoreAddress(address, clues);
            expect(score).toBe(1.0); // 0.50 (PIN) + 0.35 (City) + 0.15 (State)
        });

        it('should select correct primary establishment based on location clues', () => {
            const establishments = [
                {
                    gstin: '29AAACR5000K1Z1',
                    stateCode: '29',
                    stateName: 'Karnataka',
                    address: 'Electronic City, Bengaluru, 560100'
                },
                {
                    gstin: '27AAACR5000K1Z5',
                    stateCode: '27',
                    stateName: 'Maharashtra',
                    address: 'BKC, Mumbai, 400051'
                }
            ];

            const result = disambiguateBranches(establishments, { city: 'Mumbai', pincode: '400051' });
            expect(result.primaryEstablishment?.gstin).toBe('27AAACR5000K1Z5');
            expect(result.primaryEstablishment?.isPrimary).toBe(true);
        });
    });

    describe('4. Deterministic ID Derivation', () => {
        it('should produce identical entityId for the same statutory key', () => {
            const id1 = deriveEntityId({ cin: 'L17110MH1973PLC019786' });
            const id2 = deriveEntityId({ cin: 'l17110mh1973plc019786' });
            expect(id1).toBe(id2);
            expect(id1.startsWith('org_ent_')).toBe(true);
        });

        it('should fallback deterministically to name and state when no statutory key exists', () => {
            const id1 = deriveEntityId({ fallbackName: 'Acme Traders', fallbackState: 'MH' });
            const id2 = deriveEntityId({ fallbackName: 'ACME TRADERS', fallbackState: 'mh' });
            expect(id1).toBe(id2);
        });
    });

    describe('5. InstaClient & Hybrid Entity Resolver Workflow', () => {
        let resolver: HybridEntityResolver;

        beforeEach(() => {
            resolver = new HybridEntityResolver({
                enableInstaSearch: true,
                enableAsyncEnrichment: true,
                autoEnrichTiers: ['BASIC', 'DETAILED', 'GST'],
                fuzzyThreshold: 0.85
            });
            (query as jest.Mock).mockResolvedValue({ rows: [] });
            (cache.get as jest.Mock).mockResolvedValue(null);
            (cache.set as jest.Mock).mockResolvedValue('OK');
        });

        it('Stage 1: should resolve direct CIN statutory hint immediately with PENDING status and enqueue job', async () => {
            const cin = 'L17110MH1973PLC019786';
            const entity = await resolver.resolve({
                rawName: 'Reliance Industries',
                cinHint: cin,
                geoState: 'MH'
            });

            expect(entity.cin).toBe(cin);
            expect(entity.resolutionMethod).toBe('CIN_DIRECT');
            expect(entity.enrichmentStatus).toBe('PENDING');
            expect(entityEnrichmentQueue.add).toHaveBeenCalledWith(
                'enrich',
                expect.objectContaining({ cin, canonicalName: 'RELIANCE' }),
                expect.objectContaining({ jobId: `enrich:${cin}` })
            );
        });

        it('Stage 2: should resolve exact name match from database', async () => {
            (query as jest.Mock).mockResolvedValueOnce({
                rows: [{
                    entity_id: 'org_ent_existing_123',
                    canonical_name: 'BHARAT HEAVY ELECTRICALS',
                    cin: 'L74899DL1964GOI004281',
                    pan: 'AAACB1234D',
                    company_status: 'ACTIVE',
                    enrichment_status: 'COMPLETED',
                    directors: '[]',
                    charges: '[]',
                    establishments: '[]',
                    group_hierarchy: '{}'
                }]
            });

            const entity = await resolver.resolve({
                rawName: 'Bharat Heavy Electricals Limited',
                geoState: 'DL'
            });

            expect(entity.entityId).toBe('org_ent_existing_123');
            expect(entity.resolutionMethod).toBe('EXACT_MATCH');
        });

        it('Stage 3: should use InstaSearch and fuzzy matching when remote search succeeds', async () => {
            // Mock InstaClient searchCIN
            const mockSearchCIN = jest.spyOn(InstaClient.prototype, 'searchCIN').mockResolvedValueOnce([
                {
                    CompanyCIN: 'L17110MH1973PLC019786',
                    CompanyName: 'RELIANCE INDUSTRIES LIMITED',
                    CompanyStatus: 'ACTIVE'
                }
            ]);

            const entity = await resolver.resolve({
                rawName: 'Reliance Industries Ltd',
                geoState: 'MH'
            });

            expect(entity.cin).toBe('L17110MH1973PLC019786');
            expect(entity.resolutionMethod).toBe('INSTA_SEARCH');
            mockSearchCIN.mockRestore();
        });

        it('Stage 4: should fallback to stable deterministic ID and LOCAL_FALLBACK when no matches found', async () => {
            jest.spyOn(InstaClient.prototype, 'searchCIN').mockResolvedValue([]);

            const entity = await resolver.resolve({
                rawName: 'Some Completely Unknown Local Shop',
                geoState: 'KA'
            });

            expect(entity.resolutionMethod).toBe('LOCAL_FALLBACK');
            expect(entity.enrichmentStatus).toBe('SKIPPED');
            expect(entity.entityId.startsWith('org_ent_')).toBe(true);
        });

        it('Batch Resolution: should process batch of queries in chunks of 3', async () => {
            jest.spyOn(InstaClient.prototype, 'searchCIN').mockResolvedValue([]);

            const queries = [
                { rawName: 'Company 1', geoState: 'MH' },
                { rawName: 'Company 2', geoState: 'DL' },
                { rawName: 'Company 3', geoState: 'KA' },
                { rawName: 'Company 4', geoState: 'TN' },
                { rawName: 'Company 5', geoState: 'GJ' }
            ];

            const results = await resolver.resolveBatch(queries);
            expect(results.length).toBe(5);
            expect(results[0].resolutionMethod).toBe('LOCAL_FALLBACK');
        });

        it('Lazy Singleton: getInstaClient should instantiate lazily and return the same instance', () => {
            const client1 = getInstaClient();
            const client2 = getInstaClient();
            expect(client1).toBeInstanceOf(InstaClient);
            expect(client1).toBe(client2);
        });

        it('GST Sentinel: resolveStateCode should handle Pan-India sentinel and state padding', () => {
            expect(PAN_INDIA_GST_SENTINEL).toBe('00');
            expect(resolveStateCode(undefined)).toBe('00');
            expect(resolveStateCode('')).toBe('00');
            expect(resolveStateCode('96')).toBe('00'); // Unsupported sentinel (Other Territory)
            expect(resolveStateCode('27')).toBe('27'); // Maharashtra
            expect(resolveStateCode('7')).toBe('07');  // Padded
        });

        it('Stub Persistence Guard: asserts DB write succeeds before enqueuing BullMQ job', async () => {
            const cin = 'U72200MH2010PTC201234';
            const writeSpy = jest.spyOn(getInstaClient(), 'writeCanonicalEntity').mockResolvedValue(true);

            await resolver.resolve({
                rawName: 'Tech Solutions Private Limited',
                cinHint: cin,
                geoState: 'MH'
            });

            expect(writeSpy).toHaveBeenCalledTimes(1);
            expect(entityEnrichmentQueue.add).toHaveBeenCalledWith(
                'enrich',
                expect.objectContaining({ cin }),
                expect.objectContaining({
                    jobId: `enrich:${cin}`,
                    removeOnComplete: 1000,
                    removeOnFail: 5000
                })
            );
            writeSpy.mockRestore();
        });

        it('Noise Gate: should bypass canonical_entity_cache write for noisy/short queries (< 3 chars)', async () => {
            const writeSpy = jest.spyOn(getInstaClient(), 'writeCanonicalEntity');
            jest.spyOn(InstaClient.prototype, 'searchCIN').mockResolvedValue([]);

            // 1. Single character or 2-char token
            const entity = await resolver.resolve({
                rawName: 'X',
                geoState: 'DL'
            });

            expect(entity.resolutionMethod).toBe('LOCAL_FALLBACK');
            // Cache write must NOT have been called for noisy query
            expect(writeSpy).not.toHaveBeenCalled();
            writeSpy.mockRestore();
        });
    });
});
