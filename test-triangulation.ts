import { connection, rawSignalsQueue } from './src/lib/queue';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

const redis = new Redis(connection as any);

async function simulateTriangulation() {
    console.log("🚀 Starting Triangulation Simulation...");

    // 1. Clear Redis for deterministic test
    const companyClass = "TECH_CORP_TEST_XYZ";
    await redis.del(`orgs:index`, `org:local_test_hash`, `org:local_test_hash:recent_signals`, `org:local_test_hash:ctx_history`);

    // 2. Inject Signal 1 (Funding)
    const sig1 = {
        signal_id: uuidv4(),
        source_id: 'funding',
        source_tier: 'TIER_2',
        collected_at: new Date().toISOString(),
        company_name_raw: companyClass,
        company_name_clean: companyClass,
        geo_state: 'KARNATAKA',
        sector_inferred: 'Technology',
        signal_strength_I0: 0.8,
        lambda: 0.05,
        raw_payload: { round: 'Series B', amount: '$20M', investors: 'Sequoia' },
        pii_safe: true
    };

    console.log(`[+] Injecting Signal 1: ${sig1.source_id}`);
    await rawSignalsQueue.add('process_raw', sig1, { jobId: sig1.signal_id });

    // Wait 5 seconds to let worker process Signal 1
    console.log("Waiting 5s for pipeline processing...");
    await new Promise(r => setTimeout(r, 5000));

    // 3. Inject Signal 2 (Naukri) - Same company, different source
    const sig2 = {
        signal_id: uuidv4(),
        source_id: 'naukri',
        source_tier: 'TIER_2',
        collected_at: new Date().toISOString(),
        company_name_raw: companyClass,
        company_name_clean: companyClass,
        geo_state: 'KARNATAKA',
        sector_inferred: 'Technology',
        signal_strength_I0: 0.85,
        lambda: 0.1,
        raw_payload: { role: 'Head of Procurement', experience: '10+ years', budget_managed: '₹50Cr+' },
        pii_safe: true
    };

    console.log(`[+] Injecting Signal 2: ${sig2.source_id}`);
    await rawSignalsQueue.add('process_raw', sig2, { jobId: sig2.signal_id });

    console.log("Check the application logs to observe the 4th Gemini 'Triangulation Synthesis' prompt triggering for Signal 2.");
    process.exit(0);
}

simulateTriangulation().catch(console.error);
