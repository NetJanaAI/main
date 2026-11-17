import express, { Request, Response } from 'express';
import { query, queryWithOrg } from '../lib/database';
import { getApiKeySecret } from '../lib/secrets';
import { pullApiRateLimiter } from '../middleware/rateLimit';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

const router = express.Router();

// ---------------------------------------------------------------------------
// Pull API Key validation
// ---------------------------------------------------------------------------
// One key per tenant: the caller presents a tenant's own API key in x-api-key
// (the same key the rest of the API accepts) and can only pull that tenant's
// lead cards. There is no shared platform key.
// ---------------------------------------------------------------------------

async function resolvePullTenant(incoming: string | undefined): Promise<string | null> {
    if (!incoming) return null;
    const hash = crypto.createHmac('sha256', getApiKeySecret()).update(incoming).digest('hex');
    const result = await query('SELECT id FROM tenants WHERE api_key_hash = $1 AND deactivated_at IS NULL', [hash]);
    return result.rows[0]?.id ?? null;
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
    let orgId: string | null = null;
    try {
        orgId = await resolvePullTenant(callerKey);
    } catch (err: any) {
        console.error(`[Intel Pull] 500 | reqId=${requestId} auth lookup failed err=${err.message}`);
        return res.status(500).json({ error: 'InternalServerError', message: 'Failed to fetch lead details', request_id: requestId });
    }
    if (!orgId) {
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
        // Scoped to the tenant that owns the presented key.
        const leadResult = await queryWithOrg(
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
             WHERE lead_id = $1 AND org_id = $2
             LIMIT 1`,
            [lead_id, orgId],
            orgId
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
            const graphResult = await queryWithOrg(
                `SELECT influence_map FROM lead_influence_data WHERE lead_id = $1 AND organization_id = $2 LIMIT 1`,
                [lead_id, orgId],
                orgId
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
