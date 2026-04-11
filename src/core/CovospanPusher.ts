import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../lib/database';

export interface CovospanConfig {
    endpoint_url: string;   // ConvoSpan webhook URL
    api_key: string;        // ConvoSpan API key for x-api-key header
    hmac_secret?: string;   // Signs outbound payload for ConvoSpan to verify
    campaign_id?: string;   // Optional — route signals to a specific campaign
}

// ---------------------------------------------------------------------------
// Minimal push payload — verbose card fields are intentionally omitted.
// ConvoSpan can request the full card via GET /v1/intel/leads/{lead_id}.
// ---------------------------------------------------------------------------
export interface MinimalPushPayload {
    event: 'LEAD_CARD_READY' | 'SIGNAL_INGESTED' | 'INTENT_UPDATED';
    source: 'NetJana.AI / ConvoSpan Intel';
    timestamp: string;          // ISO-8601
    lead: {
        lead_id: string;        // UUID — anchor for the pull request
        company_name: string;
        intent_score: number;   // 0..100
        buying_stage?: 'AWARENESS' | 'CONSIDERATION' | 'DECISION' | 'UNKNOWN';
        verity_tier?: 'TIER_1' | 'TIER_2';
    };
    campaign_id?: string;
    meta: {
        pushed_by: 'auto' | 'manual';
        retry_attempt?: number;
    };
}

// ---------------------------------------------------------------------------
// Signing helpers
// ---------------------------------------------------------------------------

/**
 * Build the canonical signing input as: `${timestamp}.${nonce}.${rawBody}`
 * where rawBody is the exact UTF-8 string that will be sent over the wire.
 */
function buildSigningInput(timestamp: string, nonce: string, rawBody: string): string {
    return `${timestamp}.${nonce}.${rawBody}`;
}

/**
 * Compute x-netjana-signature.
 * Returns hex-lower HMAC-SHA256 of the signing input.
 */
function sign(secret: string, signingInput: string): string {
    return crypto.createHmac('sha256', secret).update(signingInput, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// CovospanPusher
// ---------------------------------------------------------------------------

export class CovospanPusher {
    private static MAX_RETRIES = 3;
    private static RETRY_DELAY_MS = [1000, 3000, 8000]; // Exponential backoff

    /**
     * Load ConvoSpan config for this org from DB.
     * Falls back to global env vars if not configured per-org.
     */
    static async getConfig(orgId: string): Promise<CovospanConfig | null> {
        // 1. Try per-org DB config first
        try {
            const res = await db.query(
                `SELECT endpoint_url, api_key, hmac_secret, campaign_id
                 FROM covospan_configs WHERE org_id = $1 AND is_active = TRUE LIMIT 1`,
                [orgId]
            );
            if (res.rows[0]) return res.rows[0] as CovospanConfig;
        } catch {
            // DB unavailable — fall through to env var config
        }

        // 2. Fallback to global env vars (suitable for single-tenant / standalone mode)
        const envUrl = process.env.CONVOSPAN_WEBHOOK_URL;
        const envKey = process.env.CONVOSPAN_API_KEY;
        if (envUrl && envKey) {
            return {
                endpoint_url: envUrl,
                api_key: envKey,
                hmac_secret: process.env.NETJANA_HMAC_SECRET,
                campaign_id: undefined,
            };
        }

        return null;
    }

    /**
     * Push a minimal signal to ConvoSpan.
     *
     * Signing: HMAC-SHA256( `${timestamp}.${nonce}.${rawBody}` )
     *
     * Retry strategy: reuse the SAME nonce+timestamp+signature for all retry
     * attempts of a single push() call. This ensures ConvoSpan's nonce dedup
     * treats them as the same event — idempotent. Each fresh push() call gets
     * a new nonce.
     */
    static async push(leadData: any, triggeredBy: 'auto' | 'manual' = 'auto'): Promise<void> {
        const orgId = leadData.org_id;
        const leadId = leadData.lead_id;

        const config = await CovospanPusher.getConfig(orgId);

        if (!config) {
            await CovospanPusher.log(leadId, orgId, 'SKIPPED', 'ConvoSpan endpoint not configured for this org.', triggeredBy);
            return;
        }

        // Build minimal payload — do NOT include card_why_now / card_what_they_need /
        // card_do_this / graph data. These are available via the pull API.
        const payload: MinimalPushPayload = {
            event: 'LEAD_CARD_READY',
            source: 'NetJana.AI / ConvoSpan Intel',
            timestamp: new Date().toISOString(),
            lead: {
                lead_id: leadData.lead_id,
                company_name: leadData.company_name,
                intent_score: leadData.intent_score,
                buying_stage: leadData.buying_stage || 'UNKNOWN',
                verity_tier: leadData.verity_tier,
            },
            campaign_id: config.campaign_id,
            meta: { pushed_by: triggeredBy },
        };

        // Serialise ONCE — the exact bytes we send must be what we sign.
        const bodyStr = JSON.stringify(payload);

        // Generate nonce + timestamp for this push call (reused across retries)
        const nonce = uuidv4();
        const timestampSec = String(Math.floor(Date.now() / 1000));

        // Pre-compute signature (same for all retries of this push invocation)
        let signature: string | undefined;
        const hmacSecret = config.hmac_secret || process.env.NETJANA_HMAC_SECRET;
        if (hmacSecret) {
            signature = sign(hmacSecret, buildSigningInput(timestampSec, nonce, bodyStr));
        }

        // Build headers
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'x-api-key': config.api_key,
            'x-source': 'netjana-intel',
            'x-netjana-timestamp': timestampSec,
            'x-netjana-nonce': nonce,
        };
        if (signature) {
            headers['x-netjana-signature'] = signature;
        }

        // Push with retry (same nonce/signature per push attempt — idempotent)
        let lastError = '';
        for (let attempt = 0; attempt < CovospanPusher.MAX_RETRIES; attempt++) {
            try {
                if (attempt > 0) {
                    await new Promise(r => setTimeout(r, CovospanPusher.RETRY_DELAY_MS[attempt - 1]));
                }

                const res = await fetch(config.endpoint_url, {
                    method: 'POST',
                    headers,
                    body: bodyStr,
                    signal: AbortSignal.timeout(10_000),
                });

                if (res.ok) {
                    const responseText = await res.text().catch(() => '');
                    await CovospanPusher.log(leadId, orgId, 'SUCCESS', responseText.slice(0, 500), triggeredBy, attempt + 1, config.campaign_id);
                    return;
                }

                lastError = `HTTP ${res.status}: ${await res.text().catch(() => '')}`.slice(0, 500);
                console.warn(`[CovospanPusher] Attempt ${attempt + 1} failed for lead ${leadId}: ${lastError}`);

            } catch (err: any) {
                lastError = err.message || 'Network error';
                console.warn(`[CovospanPusher] Attempt ${attempt + 1} exception for lead ${leadId}:`, lastError);
            }
        }

        await CovospanPusher.log(leadId, orgId, 'FAILED', lastError, triggeredBy, CovospanPusher.MAX_RETRIES, config.campaign_id);
    }

    /**
     * Synchronous push for testing / manual trigger.
     * Returns result instead of fire-and-forget.
     * Uses minimal payload + correct HMAC signing.
     */
    static async performTestPush(leadData: any): Promise<{ ok: boolean; status?: number; error?: string; latency_ms?: number }> {
        const orgId = leadData.org_id;
        const config = await CovospanPusher.getConfig(orgId);
        if (!config) return { ok: false, error: 'Not configured' };

        const start = Date.now();

        const payload: MinimalPushPayload = {
            event: 'LEAD_CARD_READY',
            source: 'NetJana.AI / ConvoSpan Intel',
            timestamp: new Date().toISOString(),
            lead: {
                lead_id: leadData.lead_id || uuidv4(),
                company_name: leadData.company_name || 'TEST_COMPANY',
                intent_score: 99,
                buying_stage: 'UNKNOWN',
                verity_tier: 'TIER_1',
            },
            meta: { pushed_by: 'manual' },
        };

        const bodyStr = JSON.stringify(payload);
        const nonce = uuidv4();
        const timestampSec = String(Math.floor(Date.now() / 1000));

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'x-api-key': config.api_key,
            'x-source': 'netjana-intel',
            'x-netjana-timestamp': timestampSec,
            'x-netjana-nonce': nonce,
        };

        const hmacSecret = config.hmac_secret || process.env.NETJANA_HMAC_SECRET;
        if (hmacSecret) {
            headers['x-netjana-signature'] = sign(hmacSecret, buildSigningInput(timestampSec, nonce, bodyStr));
        }

        try {
            const res = await fetch(config.endpoint_url, {
                method: 'POST',
                headers,
                body: bodyStr,
                signal: AbortSignal.timeout(5000),
            });
            const latency = Date.now() - start;
            if (res.ok) {
                await CovospanPusher.log(leadData.lead_id, orgId, 'SUCCESS', 'Test Push Successful', 'manual', 1, config.campaign_id);
                return { ok: true, status: res.status, latency_ms: latency };
            }
            const errorText = await res.text().catch(() => 'No body');
            await CovospanPusher.log(leadData.lead_id, orgId, 'FAILED', `Test Failed: HTTP ${res.status}`, 'manual', 1, config.campaign_id);
            return { ok: false, status: res.status, error: errorText.slice(0, 500) };
        } catch (err: any) {
            return { ok: false, error: err.message };
        }
    }

    // Exported for testing — allows external code to reproduce a signature
    // given fixed inputs (used in test-netjana-push.ts).
    static computeSignature(secret: string, timestampSec: string, nonce: string, rawBody: string): string {
        return sign(secret, buildSigningInput(timestampSec, nonce, rawBody));
    }

    private static async log(
        leadId: string,
        orgId: string,
        status: 'SUCCESS' | 'FAILED' | 'SKIPPED',
        detail: string,
        triggeredBy: 'auto' | 'manual',
        attempts: number = 0,
        campaignId?: string
    ): Promise<void> {
        try {
            await db.query(
                `INSERT INTO covospan_push_log
                    (lead_id, org_id, status, detail, triggered_by, attempts, campaign_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [leadId, orgId, status, detail, triggeredBy, attempts, campaignId || null]
            );
        } catch (e: any) {
            console.warn('[CovospanPusher] Failed to write push log:', e.message);
        }
    }
}
