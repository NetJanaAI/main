import express, { Request, Response } from 'express';
import { query } from '../lib/database';
import { pullApiRateLimiter } from '../middleware/rateLimit';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

const router = express.Router();

// ---------------------------------------------------------------------------
// Pull API Key validation
// ---------------------------------------------------------------------------
// NETJANA_PULL_API_KEY is the key NetJana issues to authorised callers
// (e.g. ConvoSpan). Simple constant-time comparison — no DB round-trip needed
// for a single shared key.  If you need per-tenant pull keys in future, swap
// this for a DB lookup similar to ingestAuth.ts.
// ---------------------------------------------------------------------------

const PULL_API_KEY = process.env.NETJANA_PULL_API_KEY || '';

function verifyPullApiKey(incoming: string | undefined): boolean {
    if (!PULL_API_KEY) {
        // Safety valve: if key is not configured in production, block all pulls.
        const isProd = process.env.NODE_ENV === 'production';
        if (isProd) return false;
        // In dev, allow if key is not configured (degraded mode).
        return true;
    }
    if (!incoming) return false;
    // Use timing-safe comparison to prevent timing attacks.
    try {
        const a = Buffer.from(PULL_API_KEY.padEnd(64));
        const b = Buffer.from((incoming as string).padEnd(64));
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// GET /v1/intel/leads/:lead_id
// Full lead card pull — called by ConvoSpan when user clicks "Unlock full report"
// ---------------------------------------------------------------------------

router.get('/leads/:lead_id', pullApiRateLimiter, async (req: Request, res: Response) => {
    const requestId = uuidv4();
    const start = Date.now();
    const { lead_id } = req.params;
    const callerKey = req.headers['x-api-key'] as string | undefined;
    const callerSource = (req.headers['x-source'] as string | undefined) || 'unknown';

    // --- Auth ---
    if (!verifyPullApiKey(callerKey)) {
        console.warn(`[Intel Pull] 403 | reqId=${requestId} lead=${lead_id} source=${callerSource} key_present=${!!callerKey}`);
        return res.status(403).json({
            error: 'Forbidden',
            message: 'Invalid or missing x-api-key',
            request_id: requestId,
        });
    }

    // --- Basic input validation ---
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(lead_id)) {
        return res.status(400).json({
            error: 'BadRequest',
            message: 'lead_id must be a valid UUID',
            request_id: requestId,
        });
    }

    try {
        // --- Fetch full lead card ---
        const leadResult = await query(
            `SELECT
                lead_id,
                company_name,
                geo_state,
                sector,
                source_id,
                buying_stage,
                procurement_category,
                intent_score,
                verity_tier,
                is_triangulated,
                card_why_now,
                card_what_they_need,
                card_do_this,
                created_at
             FROM lead_cards
             WHERE lead_id = $1
             LIMIT 1`,
            [lead_id]
        );

        if (leadResult.rows.length === 0) {
            const latencyMs = Date.now() - start;
            console.info(`[Intel Pull] 404 | reqId=${requestId} lead=${lead_id} source=${callerSource} latency=${latencyMs}ms`);
            return res.status(404).json({
                error: 'NotFound',
                message: 'Lead not found',
                request_id: requestId,
            });
        }

        const lead = leadResult.rows[0];

        // --- Fetch optional graph (influence map) ---
        let graph: { nodes: any[]; edges: any[] } | null = null;
        try {
            const graphResult = await query(
                `SELECT influence_map FROM lead_influence_data WHERE lead_id = $1 LIMIT 1`,
                [lead_id]
            );
            if (graphResult.rows.length > 0 && graphResult.rows[0].influence_map) {
                const raw = graphResult.rows[0].influence_map;
                // influence_map may be stored as JSONB or a JSON string
                const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                graph = {
                    nodes: parsed.nodes || [],
                    edges: parsed.edges || [],
                };
            }
        } catch {
            // Graph fetch is best-effort — do not fail the request.
            graph = null;
        }

        const latencyMs = Date.now() - start;
        console.info(
            `[Intel Pull] 200 | reqId=${requestId} lead=${lead_id} source=${callerSource} latency=${latencyMs}ms`
        );

        return res.json({
            request_id: requestId,
            lead: {
                lead_id: lead.lead_id,
                company_name: lead.company_name,
                geo_state: lead.geo_state || null,
                sector: lead.sector || null,
                source_id: lead.source_id || null,
                buying_stage: lead.buying_stage || 'UNKNOWN',
                procurement_category: lead.procurement_category || null,
                intent_score: lead.intent_score,
                verity_tier: lead.verity_tier || null,
                is_triangulated: lead.is_triangulated || false,
                card_why_now: lead.card_why_now || null,
                card_what_they_need: lead.card_what_they_need || null,
                card_do_this: lead.card_do_this || null,
                created_at: lead.created_at,
            },
            graph,
        });

    } catch (err: any) {
        const latencyMs = Date.now() - start;
        console.error(`[Intel Pull] 500 | reqId=${requestId} lead=${lead_id} source=${callerSource} latency=${latencyMs}ms err=${err.message}`);
        return res.status(500).json({
            error: 'InternalServerError',
            message: 'Failed to fetch lead details',
            request_id: requestId,
        });
    }
});

export default router;
