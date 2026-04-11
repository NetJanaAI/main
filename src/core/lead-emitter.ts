import Redis from 'ioredis';
import { db } from '../lib/database';
import { connection } from '../lib/queue';
import { Server } from 'socket.io';
import { CovospanPusher } from './CovospanPusher';

const redis = new Redis(connection as any);

export async function emitLeadCard(io: Server, leadData: any) {
    const {
        lead_id, org_id, company_name, geo_state, sector,
        source_id, source_tier, verity_tier, buying_stage,
        procurement_category, procurement_timeline,
        intent_score, decay_score,
        // C-04/M-08: Now extracted and persisted
        is_triangulated, triangulated_sources, corroborated, signal_count,
        card_company, card_why_now, card_what_they_need, card_do_this,
        created_at
    } = leadData;

    try {
        // 1. Write to PostgreSQL table "lead_cards"
        // C-04/M-07: Upsert on (org_id, source_id) so repeat signals for the
        // same org merge instead of creating duplicate rows with new UUIDs.
        const query = `
            INSERT INTO lead_cards (
                lead_id, org_id, company_name, geo_state, sector,
                source_id, source_tier, verity_tier, buying_stage,
                procurement_category, procurement_timeline,
                intent_score, decay_score,
                is_triangulated, triangulated_sources, corroborated, signal_count,
                card_company, card_why_now, card_what_they_need, card_do_this,
                created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
            ON CONFLICT (lead_id) DO UPDATE SET
                intent_score = GREATEST(lead_cards.intent_score, EXCLUDED.intent_score),
                decay_score = GREATEST(lead_cards.decay_score, EXCLUDED.decay_score),
                signal_count = lead_cards.signal_count + 1,
                is_triangulated = EXCLUDED.is_triangulated,
                triangulated_sources = EXCLUDED.triangulated_sources,
                corroborated = EXCLUDED.corroborated,
                card_why_now = EXCLUDED.card_why_now,
                card_what_they_need = EXCLUDED.card_what_they_need,
                card_do_this = EXCLUDED.card_do_this
        `;
        const values = [
            lead_id, org_id, company_name, geo_state, sector,
            source_id, source_tier, verity_tier, buying_stage,
            procurement_category, procurement_timeline,
            intent_score, decay_score,
            is_triangulated || false,
            triangulated_sources ? JSON.stringify(triangulated_sources) : null,
            corroborated || false,
            signal_count || 1,
            card_company, card_why_now, card_what_they_need, card_do_this,
            created_at
        ];

        await db.query(query, values);
    } catch (e: any) {
        console.warn('[LeadEmitter] Failed to persist LeadCard to Postgres:', e.message);
    }

    try {
        // 2. Write to Redis
        const pipeline = redis.pipeline();
        pipeline.zadd('live_leads', intent_score, lead_id);
        pipeline.setex(`lead:${lead_id}`, 24 * 3600, JSON.stringify(leadData));
        await pipeline.exec();
    } catch (e: any) {
        console.warn('[LeadEmitter] Failed to persist LeadCard to Redis:', e.message);
    }

    // 3. Emit via Socket.Io
    if (io) {
        io.to('leads_stream').emit('new_lead', leadData);
    }

    // 4. Push to ConvoSpan (fire-and-forget — never blocks the emitter)
    CovospanPusher.push(leadData, 'auto').catch(e =>
        console.warn('[LeadEmitter] CovospanPusher failed:', e.message)
    );
}
