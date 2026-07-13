import 'dotenv/config';
import { db } from '../src/lib/database';
import crypto from 'crypto';

async function testRLS() {
    console.log('[RLS-Test] Initializing DB schema...');
    await db.initDb();

    const tenantA_id = crypto.randomUUID();
    const tenantB_id = crypto.randomUUID();

    console.log(`[RLS-Test] Test Tenant A: ${tenantA_id}`);
    console.log(`[RLS-Test] Test Tenant B: ${tenantB_id}`);

    const leadA_id = crypto.randomUUID();
    const leadB_id = crypto.randomUUID();

    try {
        // 1. Insert records as System to bypass RLS scopes
        console.log('[RLS-Test] Inserting test records as System...');
        await db.queryAsSystem(
            `INSERT INTO tenants (id, name, quota_limit) VALUES ($1, $2, 100), ($3, $4, 100)`,
            [tenantA_id, `Test Tenant A ${tenantA_id}`, tenantB_id, `Test Tenant B ${tenantB_id}`]
        );

        await db.queryAsSystem(
            `INSERT INTO lead_cards (
                lead_id, org_id, company_name, geo_state, sector,
                source_id, source_tier, verity_tier, intent_score, decay_score
            ) VALUES 
            ($1, $2, 'Company A', 'Dubai', 'Tech', 'source_a', 'TIER_1', 'VERITY_1', 95, 95.0),
            ($3, $4, 'Company B', 'Abu Dhabi', 'Finance', 'source_b', 'TIER_2', 'VERITY_2', 75, 75.0)`,
            [leadA_id, tenantA_id, leadB_id, tenantB_id]
        );

        console.log('[RLS-Test] Records inserted successfully.');

        // 2. Query as Tenant A
        console.log('[RLS-Test] Verifying query scoped to Tenant A...');
        const resultA = await db.queryWithOrg(
            'SELECT company_name, org_id FROM lead_cards',
            [],
            tenantA_id
        );
        console.log(`[RLS-Test] Tenant A returned ${resultA.rows.length} rows.`);
        resultA.rows.forEach(r => console.log(`  - Row: ${r.company_name} (org: ${r.org_id})`));
        if (resultA.rows.length !== 1 || resultA.rows[0].company_name !== 'Company A') {
            throw new Error('RLS Failure: Scoped query for Tenant A returned incorrect or multiple rows.');
        }

        // 3. Query as Tenant B
        console.log('[RLS-Test] Verifying query scoped to Tenant B...');
        const resultB = await db.queryWithOrg(
            'SELECT company_name, org_id FROM lead_cards',
            [],
            tenantB_id
        );
        console.log(`[RLS-Test] Tenant B returned ${resultB.rows.length} rows.`);
        resultB.rows.forEach(r => console.log(`  - Row: ${r.company_name} (org: ${r.org_id})`));
        if (resultB.rows.length !== 1 || resultB.rows[0].company_name !== 'Company B') {
            throw new Error('RLS Failure: Scoped query for Tenant B returned incorrect or multiple rows.');
        }

        // 4. Query as system (bypass RLS)
        console.log('[RLS-Test] Verifying query as System (bypass_rls)...');
        const resultSystem = await db.queryAsSystem(
            'SELECT company_name, org_id FROM lead_cards WHERE org_id IN ($1, $2)',
            [tenantA_id, tenantB_id]
        );
        console.log(`[RLS-Test] System query returned ${resultSystem.rows.length} rows.`);
        resultSystem.rows.forEach(r => console.log(`  - Row: ${r.company_name} (org: ${r.org_id})`));
        if (resultSystem.rows.length !== 2) {
            throw new Error('RLS Failure: System query failed to bypass RLS restrictions.');
        }

        console.log('[RLS-Test] ✅ SUCCESS! Row Level Security and System Bypass verified.');

    } finally {
        console.log('[RLS-Test] Cleaning up test records...');
        await db.queryAsSystem('DELETE FROM lead_cards WHERE lead_id IN ($1, $2)', [leadA_id, leadB_id]);
        await db.queryAsSystem('DELETE FROM tenants WHERE id IN ($1, $2)', [tenantA_id, tenantB_id]);
        console.log('[RLS-Test] Cleanup complete.');
    }
}

testRLS().catch(err => {
    console.error('[RLS-Test] ❌ Test failed:', err.message);
    process.exit(1);
});
