export type ComplianceRegion = 'EU' | 'US' | 'IN' | 'UAE' | 'GLOBAL';

export interface DataResidencyRule {
    region: ComplianceRegion;
    mustStayLocal: boolean;
    requiresHmac: boolean;
    retentionDays: number;
}

export class ComplianceMatrix {
    private static RULES: Record<ComplianceRegion, DataResidencyRule> = {
        'EU': { region: 'EU', mustStayLocal: true, requiresHmac: true, retentionDays: 730 }, // GDPR
        'US': { region: 'US', mustStayLocal: false, requiresHmac: true, retentionDays: 365 }, // CCPA
        'IN': { region: 'IN', mustStayLocal: true, requiresHmac: true, retentionDays: 1825 }, // DPDP
        'UAE': { region: 'UAE', mustStayLocal: true, requiresHmac: true, retentionDays: 1825 },
        'GLOBAL': { region: 'GLOBAL', mustStayLocal: false, requiresHmac: false, retentionDays: 90 }
    };

    /**
     * Enforces regional residency. If a region requires local-only storage,
     * this method flags whether the current operation is compliant.
     */
    static checkResidencyCompliance(dataRegion: ComplianceRegion, currentServerRegion: string): boolean {
        const rule = this.RULES[dataRegion] || this.RULES.GLOBAL;
        
        if (rule.mustStayLocal) {
             // In a real cloud setup, we'd check if currentServerRegion matches dataRegion
             // e.g. 'eu-central-1' matches 'EU'
             return currentServerRegion.includes(dataRegion.toLowerCase());
        }
        
        return true;
    }

    /**
     * Returns the mandatory encryption/hashing requirements for a region.
     */
    static getSecurityRequirements(region: ComplianceRegion) {
        return this.RULES[region] || this.RULES.GLOBAL;
    }
}
