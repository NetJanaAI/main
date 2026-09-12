import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import { cache } from '../../lib/cache';
import { query } from '../../lib/database';
import {
    CanonicalEntity,
    CompanyStatus,
    Director,
    CompanyCharge,
    Establishment,
    GroupHierarchy,
    GetCINCandidate,
    InstaBasicReport,
    InstaDetailedReport,
    InstaGSTReport,
    InstaOrderResponse,
    InstaOrderStatusResponse,
    LocationClue,
    deriveEntityId,
    BRiskFinancialsReport
} from './types';
import { disambiguateBranches } from './branch-disambiguator';
import { UNSUPPORTED_GST_STATE_CODES } from './statutory-extractor';

// Base URL normalization: strip trailing /InstaReports/v1 or v2 so root is always hostname
const rawBaseUrl = process.env.INSTAFINANCIALS_BASE_URL || 'https://api.instafinancials.com';
const INSTA_BASE_URL = rawBaseUrl.replace(/\/InstaReports\/v[12]\/?$/, '').replace(/\/+$/, '');

// Sandbox-approved test CIN (Indian Oil Corporation Limited)
export const SANDBOX_APPROVED_TEST_CIN = 'L23201MH1959GOI011388';

const STATUS_CACHE_TTL_SEC = 7 * 24 * 3600;      // 7 days
const REPORT_CACHE_TTL_SEC = 30 * 24 * 3600;     // 30 days
const SEARCH_CACHE_TTL_SEC = 24 * 3600;          // 24 hours

// '00' is the MCA/GST standard sentinel code representing Pan-India / All-States aggregation
export const PAN_INDIA_GST_SENTINEL = '00';

export function resolveStateCode(stateCode?: string): string {
    if (!stateCode || UNSUPPORTED_GST_STATE_CODES.has(stateCode)) {
        return PAN_INDIA_GST_SENTINEL;
    }
    return stateCode.padStart(2, '0');
}

export class InstaClient {
    private client: AxiosInstance;
    private apiKey: string;

    constructor(apiKey?: string, baseUrl?: string) {
        this.apiKey = apiKey || process.env.INSTAFINANCIALS_API_KEY || '';
        const effectiveBaseUrl = baseUrl
            ? baseUrl.replace(/\/InstaReports\/v[12]\/?$/, '').replace(/\/+$/, '')
            : INSTA_BASE_URL;

        this.client = axios.create({
            baseURL: effectiveBaseUrl,
            timeout: 20000,
            headers: {
                'user-key': this.apiKey,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });

        // Unconditional in production code; tests should mock axios-retry directly
        axiosRetry(this.client, {
            retries: 3,
            retryDelay: axiosRetry.exponentialDelay,
            retryCondition: (error) =>
                axiosRetry.isNetworkOrIdempotentRequestError(error) ||
                error.response?.status === 429
        });
    }

    /**
     * Search CIN by company name using InstaFinancials GetCIN API (v1 GET).
     */
    async searchCIN(searchTerm: string, mode: 'SW' | 'NC' = 'SW'): Promise<GetCINCandidate[]> {
        if (!searchTerm || !searchTerm.trim()) return [];
        const cleanTerm = searchTerm.trim();
        const cacheKey = `insta:search:${mode}:${cleanTerm.toUpperCase()}`;

        // Check Redis cache
        const cached = await cache.get<GetCINCandidate[]>(cacheKey);
        if (cached && Array.isArray(cached)) {
            return cached;
        }

        if (!this.apiKey) {
            console.warn('[InstaClient] API key missing, skipping remote searchCIN');
            return [];
        }

        try {
            const url = `/InstaReports/v1/GetCIN/Search/${encodeURIComponent(cleanTerm)}/Mode/${mode}`;
            const response = await this.client.get(url);
            const data = response.data;

            let candidates: GetCINCandidate[] = [];
            if (Array.isArray(data)) {
                candidates = data;
            } else if (data && Array.isArray(data.Data)) {
                candidates = data.Data;
            } else if (data && Array.isArray(data.Result)) {
                candidates = data.Result;
            }

            if (candidates.length > 0) {
                await cache.set(cacheKey, candidates, { ex: SEARCH_CACHE_TTL_SEC });
            }

            return candidates;
        } catch (error: any) {
            console.error(`[InstaClient] searchCIN failed for "${cleanTerm}":`, error.message);
            return [];
        }
    }

    /**
     * Orders a report asynchronously from InstaFinancials.
     * For BRiskFinancials (ownership), passes ["FIN","OD"].
     */
    async orderReport(
        product: 'BRiskFinancials' | 'InstaDetailed' | 'InstaGST',
        cinOrPan: string,
        stateCode?: string
    ): Promise<InstaOrderResponse> {
        if (!this.apiKey) {
            throw new Error('[InstaClient] Cannot order report without INSTAFINANCIALS_API_KEY');
        }

        let url = '';
        let body: any = {};

        if (product === 'BRiskFinancials' || product === 'InstaDetailed') {
            url = `/InstaReports/v1/BRiskFinancials/CompanyCIN/${cinOrPan}/OrderReport`;
            body = ['FIN', 'OD'];
        } else if (product === 'InstaGST') {
            const code = resolveStateCode(stateCode);
            url = `/InstaReports/v1/InstaGST/Input/${cinOrPan}/StateCode/${code}/OrderReport`;
            body = {};
        }

        const response = await this.client.post<InstaOrderResponse>(url, body);
        return response.data;
    }

    /**
     * Polls the status of an ordered report with exponential backoff until completion or timeout.
     */
    async pollStatus(
        product: 'BRiskFinancials' | 'InstaDetailed' | 'InstaGST',
        orderId: number | string,
        maxWaitMs: number = 45000
    ): Promise<InstaOrderStatusResponse> {
        const startTime = Date.now();
        let currentDelay = 2000;
        const actualProduct = product === 'InstaDetailed' ? 'BRiskFinancials' : product;

        while (Date.now() - startTime < maxWaitMs) {
            try {
                const url = `/InstaReports/v1/${actualProduct}/OrderID/${orderId}/GetStatus`;
                const response = await this.client.get<InstaOrderStatusResponse>(url);
                const data = response.data;
                const status = (data.OrderStatus || '').toLowerCase();

                if (
                    data.IsCompleted === true ||
                    status.includes('completed') ||
                    status.includes('delivered') ||
                    status.includes('order delivered')
                ) {
                    return data;
                }

                if (status.includes('cancelled') || status.includes('rejected') || status.includes('failed')) {
                    throw new Error(`[InstaClient] Report order ${orderId} terminated with status: ${data.OrderStatus}`);
                }
            } catch (err: any) {
                if (err.message?.includes('terminated with status')) throw err;
                console.warn(`[InstaClient] pollStatus attempt failed for OrderID ${orderId}:`, err.message);
            }

            await new Promise(resolve => setTimeout(resolve, currentDelay));
            currentDelay = Math.min(currentDelay * 2, 10000);
        }

        throw new Error(`[InstaClient] pollStatus timed out after ${maxWaitMs}ms for OrderID ${orderId}`);
    }

    /**
     * Downloads report payload after order is completed.
     */
    async downloadReport<T = any>(
        product: 'BRiskFinancials' | 'InstaDetailed' | 'InstaGST',
        orderId: number | string
    ): Promise<T> {
        const actualProduct = product === 'InstaDetailed' ? 'BRiskFinancials' : product;
        const url = `/InstaReports/v1/${actualProduct}/OrderID/${orderId}/DownloadReport`;
        const response = await this.client.get<T>(url);
        return response.data;
    }

    /**
     * Fetches full InstaBasic report via current documented v2 GET endpoint:
     * GET /InstaReports/v2/InstaBasic/CompanyCIN/{cin}?daysToIgnore=999
     * Returns company master data, current/past directors & signatories, and charge information.
     */
    async fetchInstaBasic(cin: string, daysToIgnore: number = 999): Promise<InstaBasicReport | null> {
        const cleanCin = cin.toUpperCase().trim();
        const reportCacheKey = `insta:basic:${cleanCin}`;
        const statusCacheKey = `insta:status:${cleanCin}`;

        const cachedReport = await cache.get<InstaBasicReport>(reportCacheKey);
        if (cachedReport) return cachedReport;

        if (!this.apiKey) {
            console.warn('[InstaClient] API key missing, skipping remote fetchInstaBasic');
            return null;
        }

        try {
            const url = `/InstaReports/v2/InstaBasic/CompanyCIN/${cleanCin}?daysToIgnore=${daysToIgnore}`;
            const response = await this.client.get<InstaBasicReport>(url);
            const report = response.data;

            if (report) {
                // Cache full basic report for 30 days
                await cache.set(reportCacheKey, report, { ex: REPORT_CACHE_TTL_SEC });

                // Cache lightweight status for 7 days
                if (report.CompanyStatus) {
                    await cache.set(
                        statusCacheKey,
                        { companyStatus: report.CompanyStatus, companyName: report.CompanyName },
                        { ex: STATUS_CACHE_TTL_SEC }
                    );
                }
            }

            return report;
        } catch (error: any) {
            console.error(`[InstaClient] fetchInstaBasic failed for CIN ${cleanCin}:`, error.message);
            return null;
        }
    }

    /**
     * Fetches BRiskFinancials report with Ownership Details (OD) and Financials (FIN).
     * Replaces legacy InstaDetailed report for corporate ownership/subsidiary hierarchy.
     */
    async fetchBRiskFinancials(cin: string): Promise<BRiskFinancialsReport | null> {
        const cleanCin = cin.toUpperCase().trim();
        const reportCacheKey = `insta:brisk:${cleanCin}`;

        const cached = await cache.get<BRiskFinancialsReport>(reportCacheKey);
        if (cached) return cached;

        if (!this.apiKey) {
            console.warn('[InstaClient] API key missing, skipping remote fetchBRiskFinancials');
            return null;
        }

        try {
            const order = await this.orderReport('BRiskFinancials', cleanCin);
            const orderId = order.OrderID;
            if (!orderId) return null;

            await this.pollStatus('BRiskFinancials', orderId);
            const report = await this.downloadReport<BRiskFinancialsReport>('BRiskFinancials', orderId);

            if (report) {
                await cache.set(reportCacheKey, report, { ex: REPORT_CACHE_TTL_SEC });
            }

            return report;
        } catch (error: any) {
            console.error(`[InstaClient] fetchBRiskFinancials failed for CIN ${cleanCin}:`, error.message);
            return null;
        }
    }

    /**
     * Alias for fetchBRiskFinancials for backward compatibility.
     */
    async fetchInstaDetailed(cin: string): Promise<InstaDetailedReport | null> {
        return this.fetchBRiskFinancials(cin);
    }

    /**
     * Fetches InstaGST report for a corporate PAN.
     */
    async fetchInstaGST(pan: string, stateCode?: string): Promise<InstaGSTReport | null> {
        const cleanPan = pan.toUpperCase().trim();
        const reportCacheKey = `insta:gst:${cleanPan}`;

        const cached = await cache.get<InstaGSTReport>(reportCacheKey);
        if (cached) return cached;

        if (!this.apiKey) {
            console.warn('[InstaClient] API key missing, skipping remote fetchInstaGST');
            return null;
        }

        try {
            const order = await this.orderReport('InstaGST', cleanPan, stateCode);
            const orderId = order.OrderID;
            if (!orderId) return null;

            await this.pollStatus('InstaGST', orderId);
            const report = await this.downloadReport<InstaGSTReport>('InstaGST', orderId);

            if (report) {
                await cache.set(reportCacheKey, report, { ex: REPORT_CACHE_TTL_SEC });
            }

            return report;
        } catch (error: any) {
            console.error(`[InstaClient] fetchInstaGST failed for PAN ${cleanPan}:`, error.message);
            return null;
        }
    }

    /**
     * Executes the full enrichment lifecycle:
     * 1. InstaBasic v2 sequentially (to extract PAN, directors, charges)
     * 2. BRiskFinancials (with OD ownership) & InstaGST in parallel
     * 3. Disambiguate GST branches
     * 4. Persist to Postgres canonical_entity_cache
     */
    async runEnrichmentLifecycle(
        cin: string,
        options?: {
            enrichTiers?: ('BASIC' | 'DETAILED' | 'GST')[];
            locationClues?: LocationClue;
        }
    ): Promise<CanonicalEntity> {
        const cleanCin = cin.toUpperCase().trim();
        const tiers = options?.enrichTiers || ['BASIC', 'DETAILED', 'GST'];

        // Step 1: Run InstaBasic v2 first
        const basic = await this.fetchInstaBasic(cleanCin);
        const pan = basic?.PAN;

        let detailed: BRiskFinancialsReport | null = null;
        let gst: InstaGSTReport | null = null;

        // Step 2: Run BRiskFinancials (ownership) and GST in parallel if requested
        if (tiers.includes('DETAILED') && tiers.includes('GST') && pan) {
            const [detRes, gstRes] = await Promise.allSettled([
                this.fetchBRiskFinancials(cleanCin),
                this.fetchInstaGST(pan)
            ]);
            if (detRes.status === 'fulfilled') detailed = detRes.value;
            if (gstRes.status === 'fulfilled') gst = gstRes.value;
        } else if (tiers.includes('DETAILED')) {
            detailed = await this.fetchBRiskFinancials(cleanCin);
        } else if (tiers.includes('GST') && pan) {
            gst = await this.fetchInstaGST(pan);
        }

        // Normalize status
        let status: CompanyStatus = 'ACTIVE';
        const rawStatus = (basic?.CompanyStatus || '').toUpperCase();
        if (rawStatus.includes('LIQUIDAT')) status = 'UNDER_LIQUIDATION';
        else if (rawStatus.includes('DISSOLV')) status = 'DISSOLVED';
        else if (rawStatus.includes('STRIKE')) status = 'STRIKE_OFF';
        else if (rawStatus.includes('AMALGAMAT')) status = 'AMALGAMATED';
        else if (rawStatus.includes('INACTIVE')) status = 'INACTIVE';
        else if (rawStatus.includes('ACTIVE')) status = 'ACTIVE';
        else status = 'UNKNOWN';

        // Directors and Signatories (deduplicated by DIN or name)
        const allDirectorSources = [
            ...(basic?.Directors || []),
            ...(basic?.Signatories || [])
        ];
        const seenKeys = new Set<string>();
        const directors: Director[] = [];
        for (const d of allDirectorSources) {
            const key = d.DIN || d.DirectorName;
            if (key && !seenKeys.has(key)) {
                seenKeys.add(key);
                directors.push({
                    din: d.DIN || '',
                    name: d.DirectorName || '',
                    designation: d.Designation || '',
                    appointedDate: d.DateOfAppointment,
                    cessationDate: d.DateOfCessation
                });
            }
        }

        // Charges (from BRiskFinancials and/or InstaBasic v2)
        const rawCharges = detailed?.Charges || basic?.Charges || [];
        const charges: CompanyCharge[] = rawCharges.map(c => ({
            chargeId: c.ChargeID,
            holderName: c.ChargeHolder || '',
            amount: c.Amount || 0,
            creationDate: c.DateOfCreation,
            status: c.Status
        }));


        // Establishments from GST
        const rawEstablishments: Establishment[] = [];
        if (gst?.Establishments && Array.isArray(gst.Establishments)) {
            for (const est of gst.Establishments) {
                if (est.PrincipalPlaceOfBusiness) {
                    rawEstablishments.push({
                        gstin: est.GSTIN || '',
                        tradeName: est.TradeName || est.LegalName,
                        stateCode: est.StateCode || (est.GSTIN ? est.GSTIN.substring(0, 2) : ''),
                        stateName: est.StateName || est.PrincipalPlaceOfBusiness.State,
                        address: est.PrincipalPlaceOfBusiness.Address,
                        pincode: est.PrincipalPlaceOfBusiness.Pincode,
                        status: est.Status,
                        isPrimary: false
                    });
                }
                if (est.AdditionalPlacesOfBusiness && Array.isArray(est.AdditionalPlacesOfBusiness)) {
                    for (const addPlace of est.AdditionalPlacesOfBusiness) {
                        rawEstablishments.push({
                            gstin: est.GSTIN || '',
                            tradeName: est.TradeName,
                            stateCode: est.StateCode || (est.GSTIN ? est.GSTIN.substring(0, 2) : ''),
                            stateName: est.StateName || addPlace.State,
                            address: addPlace.Address,
                            pincode: addPlace.Pincode,
                            status: est.Status,
                            isPrimary: false
                        });
                    }
                }
            }
        }

        // Branch disambiguation
        const { primaryEstablishment, scoredEstablishments } = disambiguateBranches(
            rawEstablishments,
            options?.locationClues
        );

        const establishments = scoredEstablishments.map(s => s.establishment);
        if (establishments.length === 0 && primaryEstablishment) {
            establishments.push(primaryEstablishment);
        }

        // Group Hierarchy
        const groupHierarchy: GroupHierarchy = {
            parentCin: detailed?.HoldingCompany?.CIN,
            parentName: detailed?.HoldingCompany?.CompanyName,
            ultimateParentCin: detailed?.UltimateHoldingCompany?.CIN,
            ultimateParentName: detailed?.UltimateHoldingCompany?.CompanyName,
            subsidiaries: (detailed?.Subsidiaries || []).map(s => ({ cin: s.CIN || '', name: s.CompanyName || '' })),
            associates: (detailed?.Associates || []).map(a => ({ cin: a.CIN || '', name: a.CompanyName || '' }))
        };

        const canonicalName = basic?.CompanyName || cleanCin;
        const entityId = deriveEntityId({ cin: cleanCin, pan, fallbackName: canonicalName });

        const canonicalEntity: CanonicalEntity = {
            entityId,
            canonicalName,
            cin: cleanCin,
            pan,
            companyStatus: status,
            incorporationDate: basic?.DateOfIncorporation,
            authorizedCapital: basic?.AuthorizedCapital,
            paidUpCapital: basic?.PaidUpCapital,
            registeredAddress: basic?.RegisteredAddress,
            registeredState: basic?.State,
            registeredPincode: basic?.Pincode,
            nicCode: basic?.NICCode,
            nicDescription: basic?.NICDescription,
            directors,
            charges,
            establishments,
            groupHierarchy,
            resolutionMethod: 'CIN_DIRECT',
            enrichmentStatus: 'COMPLETED',
            updatedAt: new Date().toISOString()
        };

        // Persist to Postgres
        await this.writeCanonicalEntity(canonicalEntity);

        return canonicalEntity;
    }

    /**
     * Persists canonical entity to database canonical_entity_cache and updates org_registry.
     */
    async writeCanonicalEntity(entity: CanonicalEntity): Promise<boolean> {
        try {
            await query(
                `INSERT INTO canonical_entity_cache (
                    entity_id, canonical_name, cin, pan, company_status,
                    incorporation_date, authorized_capital, paid_up_capital,
                    registered_address, registered_state, registered_pincode,
                    nic_code, nic_description, directors, charges, establishments,
                    group_hierarchy, resolution_method, enrichment_status, updated_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW()
                ) ON CONFLICT (entity_id) DO UPDATE SET
                    canonical_name = EXCLUDED.canonical_name,
                    cin = COALESCE(EXCLUDED.cin, canonical_entity_cache.cin),
                    pan = COALESCE(EXCLUDED.pan, canonical_entity_cache.pan),
                    company_status = EXCLUDED.company_status,
                    incorporation_date = COALESCE(EXCLUDED.incorporation_date, canonical_entity_cache.incorporation_date),
                    authorized_capital = COALESCE(EXCLUDED.authorized_capital, canonical_entity_cache.authorized_capital),
                    paid_up_capital = COALESCE(EXCLUDED.paid_up_capital, canonical_entity_cache.paid_up_capital),
                    registered_address = COALESCE(EXCLUDED.registered_address, canonical_entity_cache.registered_address),
                    registered_state = COALESCE(EXCLUDED.registered_state, canonical_entity_cache.registered_state),
                    registered_pincode = COALESCE(EXCLUDED.registered_pincode, canonical_entity_cache.registered_pincode),
                    nic_code = COALESCE(EXCLUDED.nic_code, canonical_entity_cache.nic_code),
                    nic_description = COALESCE(EXCLUDED.nic_description, canonical_entity_cache.nic_description),
                    directors = EXCLUDED.directors,
                    charges = EXCLUDED.charges,
                    establishments = EXCLUDED.establishments,
                    group_hierarchy = EXCLUDED.group_hierarchy,
                    resolution_method = EXCLUDED.resolution_method,
                    enrichment_status = EXCLUDED.enrichment_status,
                    updated_at = NOW()`,
                [
                    entity.entityId,
                    entity.canonicalName,
                    entity.cin || null,
                    entity.pan || null,
                    entity.companyStatus,
                    entity.incorporationDate ? new Date(entity.incorporationDate) : null,
                    entity.authorizedCapital || null,
                    entity.paidUpCapital || null,
                    entity.registeredAddress || null,
                    entity.registeredState || null,
                    entity.registeredPincode || null,
                    entity.nicCode || null,
                    entity.nicDescription || null,
                    JSON.stringify(entity.directors || []),
                    JSON.stringify(entity.charges || []),
                    JSON.stringify(entity.establishments || []),
                    JSON.stringify(entity.groupHierarchy || {}),
                    entity.resolutionMethod,
                    entity.enrichmentStatus
                ]
            );

            // Update org_registry if cin matches
            if (entity.cin) {
                await query(
                    `UPDATE org_registry 
                     SET pan = COALESCE($1, pan),
                         company_status = $2,
                         last_signal_at = NOW()
                     WHERE cin = $3`,
                    [entity.pan || null, entity.companyStatus, entity.cin]
                );
            }
            return true;
        } catch (dbErr: any) {
            console.error('[InstaClient] writeCanonicalEntity database write failed:', dbErr.message);
            return false;
        }
    }
}

// Lazy Singleton implementation
let _instance: InstaClient | null = null;
export function getInstaClient(): InstaClient {
    if (!_instance) {
        _instance = new InstaClient();
    }
    return _instance;
}
