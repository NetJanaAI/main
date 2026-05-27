import { Worker, Job } from 'bullmq';
import { connection, TIER1_QUEUE_NAME, TIER2_QUEUE_NAME, tier3Queue } from '../lib/queue';
import { cache } from '../lib/cache';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { emitLeadCard } from './lead-emitter';
import { KnowledgeGraphService } from './knowledge-graph';
import { OutreachService } from './outreach';
import { resolveEntitySafe } from './entity-resolver';
import { safeQueueIndiaMARTLead } from './collectors/indiamart-dedup';
import { callModel, parseModelJson } from '../lib/model-api';
import { jsonToToon } from '../lib/ai/toon';
import { TokenTracker } from '../lib/ai/token-tracker';

function computeIntentScore(baseStrength: number, lambda: number, collectedAt: string, corroborated: boolean, buyingStage: string): number {
    const collectedDate = new Date(collectedAt);
    const now = new Date();
    const daysOld = Math.max(0, (now.getTime() - collectedDate.getTime()) / (1000 * 3600 * 24));

    const base = baseStrength * 100;
    let decayScore = base * Math.exp(-lambda * daysOld);

    if (corroborated) decayScore = Math.min(100, decayScore * 1.4);

    // C-03: Unified buying stage enum — DECISION|CONSIDERATION|AWARENESS
    let final = decayScore;
    if (buyingStage === 'DECISION') final *= 1.0;
    else if (buyingStage === 'CONSIDERATION') final *= 0.8;
    else if (buyingStage === 'AWARENESS') final *= 0.6;
    // Any unrecognized stage (UNKNOWN, EVALUATION legacy) defaults to 0.7x
    else final *= 0.7;

    return Math.round(final);
}

// H-07: Return values that match CovospanPusher MinimalPushPayload types
function getVerityTier(score: number): 'TIER_1' | 'TIER_2' | 'TIER_3' {
    if (score >= 80) return 'TIER_1';
    if (score >= 60) return 'TIER_2';
    return 'TIER_3';
}

export function setupGeminiWorkers(io: Server) {
    // ---------------------------------------------------------
    // TIER_1 WORKER (Bypass Gemini for speed)
    // ---------------------------------------------------------
    const tier1Worker = new Worker(TIER1_QUEUE_NAME, async (job: Job) => {
        const { signal, is_triangulated } = job.data;

        // Resolve entity with phonetic matching and lock
        const orgId = await resolveEntitySafe(
            signal.company_name_raw,
            signal.geo_state,
            signal.cin || undefined
        );

        // M-05: Infer buying stage from source type instead of hardcoding DECISION
        const inferredBuyingStage = signal.source_id === 'gem' ? 'DECISION' :
            signal.source_id === 'indiamart' ? 'CONSIDERATION' :
            signal.source_id === 'funding' ? 'AWARENESS' : 'CONSIDERATION';

        const intentScore = computeIntentScore(signal.signal_strength_I0, signal.lambda, signal.collected_at, is_triangulated, inferredBuyingStage);
        const baseScore = signal.signal_strength_I0 * 100;
        const daysOld = Math.max(0, (new Date().getTime() - new Date(signal.collected_at).getTime()) / (1000 * 3600 * 24));
        const decayScore = baseScore * Math.exp(-signal.lambda * daysOld);

        const leadCard = {
            lead_id: uuidv4(),
            org_id: orgId,
            company_name: signal.company_name_clean,
            geo_state: signal.geo_state,
            sector: signal.sector_inferred,
            source_id: signal.source_id,
            source_tier: signal.source_tier,
            verity_tier: getVerityTier(intentScore),
            buying_stage: inferredBuyingStage,
            procurement_category: signal.sector_inferred,
            procurement_timeline: 'IMMEDIATE',
            intent_score: intentScore,
            decay_score: Math.min(100, is_triangulated ? decayScore * 1.4 : decayScore),
            is_triangulated,
            // C-04: corroborated tracks triangulation status
            corroborated: is_triangulated,
            signal_count: 1,
            card_company: `${signal.company_name_clean} · ${signal.geo_state} · ${signal.sector_inferred}`,
            card_why_now: `High-priority TIER_1 signal from ${signal.source_id} detected. Requires immediate review. Data collected at ${signal.collected_at}`,
            card_what_they_need: `Priority follow-up for ${signal.sector_inferred}`,
            card_do_this: `Contact immediately regarding ${signal.source_id} listing.`,
            created_at: new Date().toISOString(),
            feedback_status: null,
            feedback_at: null
        };

        await emitLeadCard(io, leadCard);

        if (intentScore >= 90) {
            await OutreachService.enqueueForApproval(leadCard.lead_id, leadCard.org_id);
        }

        return { status: 'tier1_processed', lead_id: leadCard.lead_id };
    }, { connection, concurrency: 5 });

    // ---------------------------------------------------------
    // TIER_2 WORKER (3/4-Prompt Full Chain using ModelAPI)
    // ---------------------------------------------------------
    const tier2Worker = new Worker(TIER2_QUEUE_NAME, async (job: Job) => {
        const { signal, is_triangulated, triangulated_sources } = job.data;
        const dateStr = new Date().toISOString().split('T')[0];
        const spendKey = `gemini_calls:${dateStr}`;

        // ModelAPI manages the daily limit check, but we can also perform it here for io.emit
        const newCount = await cache.incr(spendKey);
        await cache.expire(spendKey, 86_400); // 24h TTL
        if (newCount > 400) {
            await cache.decr(spendKey); // rollback so limit is accurate
            io.emit('cost_alert', { message: 'Daily Gemini spend guard triggered (>400 calls). TIER_2 paused.' });
            throw new Error('[SpendGuard] Daily Gemini limit of 400 reached.');
        }

        // H-05: Handle empty TOON payload
        const toonPayload = (signal.raw_payload && Object.keys(signal.raw_payload).length > 0)
            ? jsonToToon(signal.raw_payload)
            : 'NO_DATA';

        // Resolve entity
        const orgId = await resolveEntitySafe(
            signal.company_name_raw,
            signal.geo_state,
            signal.cin || undefined
        );

        // --- 1. GATE ---
        const gateSysPrompt = "Role: B2B Gatekeeper [TOON_PARSER]. Respond JSON only.";
        const gateUserPrompt = `[TOON:GATE_v1]
TARGET: Identify buying intent
DATA:
${toonPayload}
MARKET: ${signal.geo_market}
RULES:
- Match hiring_SC | new_license(DMCC/ADGM) | import_spike | tenders
OUT: { "is_buyer": bool, "confidence": num, "valid": bool, "reason": "str" }
[/TOON]`;

        const tokensSaved = TokenTracker.calculateToonSavings(signal.raw_payload || {}, toonPayload);
        
        let gateResult;
        try {
            const gateRaw = await callModel({ role: 'gate', system: gateSysPrompt, user: gateUserPrompt, orgId, spendKey, tokensSaved });
            gateResult = parseModelJson(gateRaw);
        } catch (e) { throw new Error('Gate prompt failure: ' + (e as Error).message); }

        if (!gateResult || !gateResult.is_buyer) {
            await cache.incr(`discarded:${signal.source_id}:${dateStr}`);
            return { status: 'discarded' };
        }

        // --- 2. QUALIFIER ---
        const kgContext = await KnowledgeGraphService.getGraphContext(signal.company_name_clean);
        const qualSysPrompt = "Role: Procurement Analyst [TOON_PARSER]. Respond JSON only.";
        const qualUserPrompt = `[TOON:QUALIFIER_v1]
COMP: ${signal.company_name_clean} | LOC: ${signal.geo_state} (${signal.geo_market})
SRC: ${signal.source_id}
DATA:
${toonPayload}
KG_CTX: ${kgContext || 'NONE'}

TASKS:
1. procurement_category -> focus area
2. procurement_timeline -> IMMEDIATE|NEAR_TERM|PIPELINE
3. buying_stage -> DECISION|CONSIDERATION|AWARENESS
4. pain_point -> core issue (1 line)
5. confidence -> HIGH|MEDIUM|LOW (based on KG+Data)

OUT: { "procurement_category": "str", "procurement_timeline": "enum", "buying_stage": "enum", "pain_point": "str", "confidence": "enum" }
[/TOON]`;

        let qualResult;
        try {
            const qualRaw = await callModel({ role: 'qualifier', system: qualSysPrompt, user: qualUserPrompt, orgId, spendKey, tokensSaved });
            qualResult = parseModelJson(qualRaw);
        } catch (e) { throw new Error('Qualifier prompt failure: ' + (e as Error).message); }

        if (!qualResult) throw new Error('Unparseable Qualifier output');

        if (qualResult.confidence === 'LOW') {
            await tier3Queue.add('enrichment_pool', { ...job.data, org_id: orgId });
            return { status: 'downgraded_to_tier3' };
        }

        // --- 3. LEAD WRITER / TRIANGULATION SYNTHESIS ---
        let writerSysPrompt = "Role: B2B Synthesizer [TOON_PARSER]. Respond JSON only.";
        // M-03: Include TOON data in writer prompt for evidence grounding
        let writerUserPrompt = `[TOON:LEAD_GEN_v1]
TARGET: Generate Lead Card
COMP: ${signal.company_name_clean} | MRKT: ${signal.geo_market}
CTX_PAIN: ${qualResult.pain_point}
CAT: ${qualResult.procurement_category} | STAGE: ${qualResult.buying_stage}
EVIDENCE:
${toonPayload}

OUT: { "company": "Name · City · State · Sector", "why_now": "<2 sentences citing evidence", "what_they_need": "specific item", "do_this": "action step" }
[/TOON]`;

        if (is_triangulated && triangulated_sources) {
            writerSysPrompt = "Role: Triangulation Synthesizer [TOON_PARSER]. Respond JSON only.";

            const ctxHistoryList = await cache.lrange(`org:${orgId}:ctx_history`, 0, -1);
            let prevContext = "";
            for (const sigId of ctxHistoryList) {
                if (sigId !== signal.signal_id) {
                    const ctx = await cache.get(`signal_ctx:${sigId}`);
                    if (ctx) {
                        prevContext += `PREV_CTX: ${ctx}\n`;
                        break;
                    }
                }
            }

            writerUserPrompt = `[TOON:META_SYNTHESIS_v1]
COMP: ${signal.company_name_clean}, ${signal.geo_state} | IND: ${signal.sector_inferred}
OVERLAP_SRCS: ${triangulated_sources.join(', ')}
CURR_DATA: ${toonPayload}
${prevContext}
PRI_CAT: ${qualResult.procurement_category}

OUT: { "company": "Name · Target", "why_now": "Citing multiple sources <2s", "what_they_need": "merged need", "do_this": "meta action" }
[/TOON]`;
        }

        let writerResult;
        try {
            const writerRaw = await callModel({ role: 'writer', system: writerSysPrompt, user: writerUserPrompt, orgId, spendKey, tokensSaved });
            writerResult = parseModelJson(writerRaw);
        } catch (e) { throw new Error('Lead Writer prompt failure: ' + (e as Error).message); }

        const intentScore = computeIntentScore(signal.signal_strength_I0, signal.lambda, signal.collected_at, is_triangulated, qualResult.buying_stage);
        const daysOld = Math.max(0, (new Date().getTime() - new Date(signal.collected_at).getTime()) / (1000 * 3600 * 24));
        const decayScore = (signal.signal_strength_I0 * 100) * Math.exp(-signal.lambda * daysOld);

        const leadCard = {
            lead_id: uuidv4(),
            org_id: orgId,
            company_name: signal.company_name_clean,
            geo_state: signal.geo_state,
            sector: signal.sector_inferred,
            source_id: signal.source_id,
            source_tier: signal.source_tier,
            verity_tier: getVerityTier(intentScore),
            buying_stage: qualResult.buying_stage,
            procurement_category: qualResult.procurement_category,
            procurement_timeline: qualResult.procurement_timeline,
            intent_score: intentScore,
            decay_score: Math.min(100, is_triangulated ? decayScore * 1.4 : decayScore),
            is_triangulated,
            triangulated_sources,
            // C-04: corroborated tracks triangulation status
            corroborated: is_triangulated,
            signal_count: 1,
            card_company: writerResult?.company || `${signal.company_name_clean} · ${signal.geo_state} · ${signal.sector_inferred}`,
            card_why_now: writerResult?.why_now || `Qualified TIER_2 signal from ${signal.source_id}.`,
            card_what_they_need: writerResult?.what_they_need || qualResult.procurement_category,
            card_do_this: writerResult?.do_this || `Investigate ${signal.source_id} lead.`,
            created_at: new Date().toISOString(),
            feedback_status: null,
            feedback_at: null
        };

        await emitLeadCard(io, leadCard);

        if (intentScore >= 70) {
            await OutreachService.enqueueForApproval(leadCard.lead_id, leadCard.org_id);
        }

        return { status: 'lead_card_generated', lead_id: leadCard.lead_id };
    }, { connection, concurrency: 2 });
}

export async function queueIndiaMARTSignal(lead: any, organizationId: string): Promise<void> {
    await safeQueueIndiaMARTLead(lead, organizationId);
}
