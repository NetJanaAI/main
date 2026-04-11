import { TenantRAGStore } from "./TenantRAGStore";

export interface SignalData {
    companyName: string;
    contactPII: Record<string, any>;
    frictionSignals: Record<string, any>;
    organizationId: string;
    signalType: string;
    signalStrength: number;
    region: string;
    industry: string;
}

export class AnonymizationPipeline {
    private static SHARED_STORE = new TenantRAGStore('netjana_intel');

    /**
     * Processes a raw lead signal into an anonymized market signature.
     * Legal data path for tenant RAG -> Shared store.
     */
    static async processAndDistill(data: SignalData, optIn: boolean) {
        if (!optIn) {
            throw new Error(`Anonymization failed: Organization ${data.organizationId} has not opted-in to NetJana Intel Network.`);
        }

        console.log(`[NetJana-Intel] Distilling signal for ${data.signalType} from Org: ${data.organizationId}`);

        // a. Strip PII and Identifiers
        // b. Keep only categorical and numerical data
        const anonymized = {
            signalType: data.signalType,
            signalStrength: this.addNoise(data.signalStrength),
            region: data.region,
            industry: data.industry,
            timestamp: new Date().toISOString()
        };

        // c. Construct namespace: rag:netjana_intel:{signalType}:{region}:{YYYY-MM}
        const dateKey = new Date().toISOString().slice(0, 7); // YYYY-MM
        const nsType = `signal_${anonymized.signalType}`;
        const nsId = `${anonymized.region}_${dateKey}`;

        // d. Write to secure shared pool
        await this.SHARED_STORE.upsert(
            nsType,
            nsId,
            `Market Signature: ${anonymized.signalType} strength ${anonymized.signalStrength.toFixed(2)} in ${anonymized.region} (${anonymized.industry})`,
            anonymized
        );

        return true;
    }

    private static addNoise(val: number): number {
        // Add ±10% noise jitter to prevent reverse-engineering
        const jitter = (Math.random() * 0.2) - 0.1; // -10% to +10%
        return val * (1 + jitter);
    }
}
