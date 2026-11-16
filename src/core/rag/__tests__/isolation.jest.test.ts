import { TenantRAGStore, RAGCrossContaminationError } from "../TenantRAGStore";
import { AnonymizationPipeline } from "../AnonymizationPipeline";

describe('RAG tenant isolation', () => {
    const storeA = new TenantRAGStore("Org_Alpha");
    const storeB = new TenantRAGStore("Org_Beta");

    it('keeps Org A data out of Org B queries', async () => {
        await storeA.upsert("leads", "lead_001", "Confidential Alpha Prospect: Siddhartha", { revenue: "100M" });
        expect(await storeB.query("Siddharth")).toHaveLength(0);
    });

    it('blocks access to the covospan_edge namespace', async () => {
        await storeA.upsert("leads", "stealth_doc", "Sensitive", {}, "req_123");
        expect(() => (storeA as any).getNamespace("covospan_edge", "leak")).toThrow(RAGCrossContaminationError);
    });

    it('lets CovoSpan read anonymised signals from the shared pool', async () => {
        await AnonymizationPipeline.processAndDistill({
            companyName: "Alpha Corp",
            contactPII: { email: "boss@alpha.com" },
            frictionSignals: { risk: 0.8 },
            organizationId: "Org_Alpha",
            signalType: "risk",
            signalStrength: 0.85,
            region: "Dubai",
            industry: "Logistics"
        }, true);
        const shared = await new TenantRAGStore("covospan_edge").query("Logistics");
        expect(shared.some((r) => r.pageContent.includes("Market Signature"))).toBe(true);
    });
});
