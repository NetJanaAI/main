import 'dotenv/config';
import { query } from './src/lib/database';
import Redis from 'ioredis';

async function runAudit() {
    try {
        await require('./src/lib/database').db.initDb();
        console.log("=== Q1: Prompt 3 Outputs (Generic vs Specific) ===");
        const res1 = await query(`
            SELECT card_what_they_need, card_do_this 
            FROM lead_cards 
            LIMIT 50
        `);
        let genericCount = 0;
        let specificCount = 0;

        for (const row of res1.rows) {
            const text = (row.card_what_they_need + " " + row.card_do_this).toLowerCase();
            if (text.includes('priority follow-up') || text.includes('investigate') || text.length < 20) {
                genericCount++;
            } else {
                specificCount++;
            }
        }
        console.log(`Generic: ${genericCount}, Specific: ${specificCount}`);
        if (res1.rows.length > 0) {
            console.log("Sample Generic:", res1.rows.find(r => r.card_do_this.includes('Investigate')));
            console.log("Sample Specific:", res1.rows.find(r => !r.card_do_this.includes('Investigate')));
        }

        console.log("\n=== Q2: Feedback Tags (Wrong) ===");
        const res2 = await query(`
            SELECT source_id, 
                   COUNT(*) as total_leads,
                   SUM(CASE WHEN feedback_status = 'wrong' THEN 1 ELSE 0 END) as wrong_feedback
            FROM lead_cards
            WHERE feedback_status IS NOT NULL
            GROUP BY source_id
        `);
        console.table(res2.rows);

        console.log("\n=== Q3: Entity Duplicates ===");
        const res3 = await query(`
            SELECT company_name, geo_state, COUNT(*) as c, array_agg(org_id) as orgs
            FROM lead_cards
            GROUP BY company_name, geo_state
            HAVING COUNT(*) > 1
            LIMIT 10
        `);
        console.table(res3.rows);

        console.log("\n=== Q4: Gemini Chain Latency ===");
        const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
        const latencyKeys = await redis.keys('latency:*');
        for (const key of latencyKeys) {
            const type = await redis.type(key);
            if (type === 'list') {
                const vals = await redis.lrange(key, 0, -1);
                console.log(key, vals.length, "entries");
            }
        }

    } catch (e: any) {
        console.error("Audit error:", e.message);
    }
    process.exit(0);
}

runAudit();
