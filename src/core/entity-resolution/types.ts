import { createHash } from 'crypto';

export type CompanyStatus = 
    | 'ACTIVE' 
    | 'UNDER_LIQUIDATION' 
    | 'DISSOLVED' 
    | 'INACTIVE' 
    | 'STRIKE_OFF' 
    | 'AMALGAMATED' 
    | 'UNKNOWN';

export type ResolutionMethod = 
    | 'EXACT_MATCH' 
    | 'CIN_DIRECT' 
    | 'PAN_MATCH' 
    | 'GSTIN_MATCH' 
    | 'PHONETIC' 
    | 'INSTA_SEARCH' 
    | 'LOCAL_FALLBACK';

export type EnrichmentStatus = 
    | 'PENDING' 
    | 'RUNNING' 
    | 'COMPLETED' 
    | 'FAILED' 
    | 'SKIPPED';

export interface Director {
    din: string;
    name: string;
    designation: string;
    appointedDate?: string;
    cessationDate?: string;
}

export interface CompanyCharge {
    chargeId?: string;
    holderName: string;
    amount: number;
    creationDate?: string;
    status?: string;
}

export interface Establishment {
    gstin: string;
    tradeName?: string;
    stateCode: string;
    stateName?: string;
    address?: string;
    pincode?: string;
    status?: string;
    isPrimary?: boolean;
}

export interface GroupHierarchy {
    parentCin?: string;
    parentName?: string;
    ultimateParentCin?: string;
    ultimateParentName?: string;
    subsidiaries?: Array<{ cin: string; name: string }>;
    associates?: Array<{ cin: string; name: string }>;
}

export interface CanonicalEntity {
    entityId: string;
    canonicalName: string;
    cin?: string;
    pan?: string;
    companyStatus: CompanyStatus;
    incorporationDate?: string;
    authorizedCapital?: number;
    paidUpCapital?: number;
    registeredAddress?: string;
    registeredState?: string;
    registeredPincode?: string;
    nicCode?: string;
    nicDescription?: string;
    directors: Director[];
    charges: CompanyCharge[];
    establishments: Establishment[];
    groupHierarchy: GroupHierarchy;
    resolutionMethod: ResolutionMethod;
    enrichmentStatus: EnrichmentStatus;
    createdAt?: string;
    updatedAt?: string;
}

export interface LocationClue {
    state?: string;
    city?: string;
    pincode?: string;
    address?: string;
    rawLocationText?: string;
}

export interface ResolutionQuery {
    rawName: string;
    geoState?: string;
    cinHint?: string;
    panHint?: string;
    gstinHint?: string;
    dinHint?: string;
    rawText?: string;
    locationClues?: LocationClue;
    sourceId?: string;
}

export interface ResolverOptions {
    enableInstaSearch?: boolean;
    enableAsyncEnrichment?: boolean;
    autoEnrichTiers?: ('BASIC' | 'DETAILED' | 'GST')[];
    fuzzyThreshold?: number;
}

export interface InstaOrderResponse {
    IsBillable?: boolean;
    OrderID?: number | string;
    OrderStatus?: string;
    Message?: string;
    Status?: string;
    ErrorCode?: number | string;
}

export interface InstaOrderStatusResponse {
    OrderID?: number | string;
    OrderStatus?: string;
    IsCompleted?: boolean;
    DownloadURL?: string;
    Message?: string;
}

export interface GetCINCandidate {
    CompanyCIN: string;
    CompanyName: string;
    CompanyStatus: string;
    Address?: string;
    IsPrevName?: boolean;
    score?: number;
}

export interface InstaBasicReport {
    CompanyCIN?: string;
    CompanyName?: string;
    CompanyStatus?: string;
    PAN?: string;
    DateOfIncorporation?: string;
    AuthorizedCapital?: number;
    PaidUpCapital?: number;
    RegisteredAddress?: string;
    State?: string;
    Pincode?: string;
    NICCode?: string;
    NICDescription?: string;
    Directors?: Array<{
        DIN?: string;
        DirectorName?: string;
        Designation?: string;
        DateOfAppointment?: string;
        DateOfCessation?: string;
    }>;
    [key: string]: any;
}

export interface InstaDetailedReport {
    CompanyCIN?: string;
    Charges?: Array<{
        ChargeID?: string;
        ChargeHolder?: string;
        Amount?: number;
        DateOfCreation?: string;
        Status?: string;
    }>;
    HoldingCompany?: {
        CIN?: string;
        CompanyName?: string;
    };
    UltimateHoldingCompany?: {
        CIN?: string;
        CompanyName?: string;
    };
    Subsidiaries?: Array<{
        CIN?: string;
        CompanyName?: string;
    }>;
    Associates?: Array<{
        CIN?: string;
        CompanyName?: string;
    }>;
    [key: string]: any;
}

export interface InstaGSTEstablishment {
    GSTIN?: string;
    LegalName?: string;
    TradeName?: string;
    StateCode?: string;
    StateName?: string;
    Status?: string;
    PrincipalPlaceOfBusiness?: {
        Address?: string;
        Pincode?: string;
        City?: string;
        State?: string;
    };
    AdditionalPlacesOfBusiness?: Array<{
        Address?: string;
        Pincode?: string;
        City?: string;
        State?: string;
    }>;
    [key: string]: any;
}

export interface InstaGSTReport {
    PAN?: string;
    Establishments?: InstaGSTEstablishment[];
    [key: string]: any;
}

export interface StatutoryExtractionResult {
    cins: string[];
    pans: string[];
    gstins: string[];
    dins: string[];
}

export interface EnrichmentJobData {
    cin: string;
    entityId: string;
    pan?: string;
    canonicalName: string;
    enrichTiers?: ('BASIC' | 'DETAILED' | 'GST')[];
    locationClues?: LocationClue;
}

/**
 * Derives a deterministic entity ID using SHA-256 hash with prefix 'org_ent_'.
 * Uses CIN -> PAN -> GSTIN -> canonicalName+state fallback.
 */
export function deriveEntityId(params: {
    cin?: string | null;
    pan?: string | null;
    gstin?: string | null;
    fallbackName?: string | null;
    fallbackState?: string | null;
}): string {
    let key = '';
    if (params.cin && params.cin.trim()) {
        key = `cin:${params.cin.toUpperCase().trim()}`;
    } else if (params.pan && params.pan.trim()) {
        key = `pan:${params.pan.toUpperCase().trim()}`;
    } else if (params.gstin && params.gstin.trim()) {
        key = `gstin:${params.gstin.toUpperCase().trim()}`;
    } else {
        const name = (params.fallbackName || 'UNKNOWN').toUpperCase().trim();
        const state = (params.fallbackState || 'IN').toUpperCase().trim();
        key = `name:${name}|state:${state}`;
    }
    const hash = createHash('sha256').update(key).digest('hex').substring(0, 24);
    return `org_ent_${hash}`;
}
