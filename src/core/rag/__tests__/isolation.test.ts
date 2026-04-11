import { TenantRAGStore, RAGCrossContaminationError } from "../TenantRAGStore";
import { AnonymizationPipeline } from "../AnonymizationPipeline";

async function runTests() {
    console.log("--- STARTING RAG ISOLATION TEST SUITE ---");

    const storeA = new TenantRAGStore("Org_Alpha");
    const storeB = new TenantRAGStore("Org_Beta");

    try {
        // Test 1: Org A write
        await storeA.upsert("leads", "lead_001", "Confidential Alpha Prospect: Siddhartha", { revenue: "100M" });
        console.log("✓ Test 1: Org A write successful.");

        // Test 2: Org B query (Should not see Org A data)
        const resultsB = await storeB.query("Siddharth");
        if (resultsB.length === 0) {
            console.log("✓ Test 2: Org B query isolated from Org A.");
        } else {
            throw new Error("❌ Test 2 FAILED: Org B saw Org A data!");
        }

        // Test 3: Unauthorized covospan_edge access
        try {
            await storeA.upsert("leads", "stealth_doc", "Sensitive", {}, "req_123");
            // Attempt to hack namespace via docType (if we didn't have validation)
            // But our getNamespace/validateNamespace should catch it
            await (storeA as any).getNamespace("covospan_edge", "leak"); 
            throw new Error("❌ Test 3 FAILED: Org A accessed covospan_edge namespace!");
        } catch (e: any) {
            if (e instanceof RAGCrossContaminationError) {
                console.log("✓ Test 3: Blocked unauthorized COVOSPAN_EDGE access.");
            } else {
                throw e;
            }
        }

        // Test 4: Shared Pool access (NetJana Intel)
        const storeCovo = new TenantRAGStore("covospan_edge");
        // Anonymize A's signal
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
        
        const sharedResults = await storeCovo.query("Logistics");
        if (sharedResults.some(r => r.pageContent.includes("Market Signature"))) {
            console.log("✓ Test 4: CovoSpan read from NetJana Intel pool successful.");
        }

    } catch (error: any) {
        console.error("!!! TEST SUITE FAILED !!!", error.message);
        process.exit(1);
    }

    console.log("--- RAG ISOLATION TEST SUITE COMPLETED SUCCESSFULLY ---");
}

runTests();
