import { db } from '../lib/database';
import { Server } from 'socket.io';
import { CovospanPusher } from './CovospanPusher';
import { sendCraftMyFunnelLeadSignal } from './CraftMyFunnelPusher';
import { TenantRAGStore } from './rag/TenantRAGStore';
import { getSharedRedisClient } from '../lib/redis';

const redis = getSharedRedisClient();

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

        // FLOW-01: Index lead card into TenantRAGStore immediately after Postgres write.
        // OutreachGenerator calls store.query() — if the lead is not indexed here,
        // every outreach job fails with "Lead data not found in RAG store".
        try {
            const store = new TenantRAGStore(org_id || 'default');
            const pageContent = JSON.stringify({
                lead_id, company_name, sector, procurement_category,
                buying_stage, card_why_now, card_what_they_need, card_do_this,
                intent_score, geo_state
            });
            await store.upsert(
                'lead_card',
                lead_id,
                pageContent,
                { lead_id, org_id: org_id || 'default', type: 'lead_card' }
            );
        } catch (ragErr: any) {
            // Non-fatal: outreach will fall back to Postgres data if RAG index fails.
            console.warn('[LeadEmitter] RAG index failed (non-fatal):', ragErr.message);
        }
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

    // 3. Emit via Socket.IO
    if (io) {
        // Multi-tenant isolation: emit client-specific messages to the org room only
        if (org_id && org_id !== 'default') {
            io.to(`org:${org_id}`).emit('new_lead', leadData);
            io.to(`org:${org_id}`).emit('lead:new_card', leadData);
        } else {
            io.to('leads_stream').emit('new_lead', leadData);
        }
    }

    // 4. Push to ConvoSpan (fire-and-forget — never blocks the emitter)
    CovospanPusher.push(leadData, 'auto').catch(e =>
        console.warn('[LeadEmitter] CovospanPusher failed:', e.message)
    );

    sendCraftMyFunnelLeadSignal(leadData, { triggeredBy: 'auto' }).catch(e =>
        console.warn('[LeadEmitter] CraftMyFunnel push failed:', e.message)
    );
}
