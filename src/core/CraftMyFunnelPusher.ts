import crypto from 'crypto';
import { query } from '../lib/database';

export type CraftMyFunnelEvent = 'LEAD_CARD_READY' | 'SIGNAL_INGESTED' | 'INTENT_UPDATED';
export type CraftMyFunnelBuyingStage = 'AWARENESS' | 'CONSIDERATION' | 'DECISION' | 'UNKNOWN';
export type CraftMyFunnelVerityTier = 'TIER_1' | 'TIER_2';

export interface CraftMyFunnelLeadPayload {
    event: CraftMyFunnelEvent;
    source: 'netjana-intel';
    timestamp: string;
    campaign_id?: string;
    lead: {
        lead_id: string;
        company_name: string;
        intent_score: number;
        geo_state?: string;
        sector?: string;
        source_id?: string;
        buying_stage: CraftMyFunnelBuyingStage;
        procurement_category?: string;
        procurement_timeline?: string;
        verity_tier: CraftMyFunnelVerityTier;
        is_triangulated?: boolean;
        card_company?: string;
        card_why_now?: string;
        card_what_they_need?: string;
        card_do_this?: string;
        created_at?: string;
    };
    meta: {
        pushed_by: 'netjana';
        retry_attempt: number;
    };
}

export interface CraftMyFunnelSuccessResponse {
    ok: boolean;
    signalId?: string;
    leadId?: string;
    campaignId?: string;
    duplicate?: boolean;
    connectionStatus?: string;
    verificationMode?: string;
    matched?: boolean;
    safeForAutomation?: boolean;
}

interface CraftMyFunnelConfig {
    apiBaseUrl: string;
    apiKey: string;
    hmacSecret: string;
}

interface SendOptions {
    event?: CraftMyFunnelEvent;
    campaignId?: string;
    retryAttempt?: number;
    triggeredBy?: 'auto' | 'manual';
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1000, 3000];

function getConfig(): CraftMyFunnelConfig | null {
    const apiBaseUrl = process.env.CRAFTMYFUNNEL_API_BASE_URL;
    const apiKey = process.env.CRAFTMYFUNNEL_API_KEY;
    const hmacSecret = process.env.CRAFTMYFUNNEL_NETJANA_HMAC_SECRET;

    if (!apiBaseUrl || !apiKey || !hmacSecret) {
        return null;
    }

    return { apiBaseUrl, apiKey, hmacSecret };
}

function normalizeBuyingStage(value: unknown): CraftMyFunnelBuyingStage {
    const stage = String(value || '').toUpperCase();
    if (stage === 'AWARENESS' || stage === 'CONSIDERATION' || stage === 'DECISION') {
        return stage;
    }
    return 'UNKNOWN';
}

function normalizeVerityTier(value: unknown): CraftMyFunnelVerityTier {
    return String(value).toUpperCase() === 'TIER_1' ? 'TIER_1' : 'TIER_2';
}

function toFiniteIntentScore(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return NaN;
    }
    return Math.round(numeric);
}

function assertValidPayload(payload: CraftMyFunnelLeadPayload) {
    if (!payload.lead.lead_id) {
        throw new Error('CraftMyFunnel payload missing lead.lead_id');
    }
    if (!payload.lead.company_name) {
        throw new Error('CraftMyFunnel payload missing lead.company_name');
    }
    if (!Number.isInteger(payload.lead.intent_score) || payload.lead.intent_score < 0 || payload.lead.intent_score > 100) {
        throw new Error('CraftMyFunnel payload intent_score must be an integer between 0 and 100');
    }
    if (!payload.timestamp) {
        throw new Error('CraftMyFunnel payload missing timestamp');
    }
    if (!payload.event) {
        throw new Error('CraftMyFunnel payload missing event');
    }
    if (payload.source !== 'netjana-intel') {
        throw new Error('CraftMyFunnel payload source must be netjana-intel');
    }
}

function buildEndpointUrl(apiBaseUrl: string): string {
    return `${apiBaseUrl.replace(/\/+$/, '')}/api/webhooks/netjana-intel`;
}

function buildSigningInput(timestamp: string, nonce: string, rawJsonBody: string): string {
    return `${timestamp}.${nonce}.${rawJsonBody}`;
}

export function computeCraftMyFunnelSignature(secret: string, timestamp: string, nonce: string, rawJsonBody: string): string {
    return crypto.createHmac('sha256', secret).update(buildSigningInput(timestamp, nonce, rawJsonBody), 'utf8').digest('hex');
}

export function mapLeadCardToCraftMyFunnelPayload(leadData: any, options: SendOptions = {}): CraftMyFunnelLeadPayload {
    const timestamp = leadData.created_at || new Date().toISOString();
    const payload: CraftMyFunnelLeadPayload = {
        event: options.event || 'LEAD_CARD_READY',
        source: 'netjana-intel',
        timestamp,
        campaign_id: options.campaignId,
        lead: {
            lead_id: String(leadData.lead_id || ''),
            company_name: String(leadData.company_name || leadData.card_company || '').trim(),
            intent_score: toFiniteIntentScore(leadData.intent_score),
            geo_state: leadData.geo_state || undefined,
            sector: leadData.sector || undefined,
            source_id: leadData.source_id || undefined,
            buying_stage: normalizeBuyingStage(leadData.buying_stage),
            procurement_category: leadData.procurement_category || undefined,
            procurement_timeline: leadData.procurement_timeline || undefined,
            verity_tier: normalizeVerityTier(leadData.verity_tier),
            is_triangulated: Boolean(leadData.is_triangulated),
            card_company: leadData.card_company || leadData.company_name || undefined,
            card_why_now: leadData.card_why_now || undefined,
            card_what_they_need: leadData.card_what_they_need || undefined,
            card_do_this: leadData.card_do_this || undefined,
            created_at: leadData.created_at || timestamp,
        },
        meta: {
            pushed_by: 'netjana',
            retry_attempt: options.retryAttempt || 0,
        }
    };

    assertValidPayload(payload);
    return payload;
}

function shouldRetry(status: number): boolean {
    return status === 429 || status >= 500;
}

function redactKey(apiKey: string): string {
    if (apiKey.length <= 4) {
        return '***';
    }
    return `***${apiKey.slice(-4)}`;
}

async function logCraftMyFunnelDelivery(
    leadId: string,
    orgId: string,
    status: 'RECEIVED' | 'LOST' | 'DOWN' | 'SKIPPED',
    detail: string,
    triggeredBy: 'auto' | 'manual',
    options: {
        requestSent?: boolean;
        ackReceived?: boolean;
        responseStatus?: number;
        attempts?: number;
        campaignId?: string;
        connectionStatus?: string;
        verificationMode?: string;
        matched?: boolean;
        safeForAutomation?: boolean;
    } = {}
) {
    try {
        await query(
            `INSERT INTO craftmyfunnel_push_log (
                lead_id, org_id, status, request_sent, ack_received, response_status,
                detail, triggered_by, attempts, campaign_id, connection_status,
                verification_mode, matched, safe_for_automation
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [
                leadId,
                orgId,
                status,
                options.requestSent || false,
                options.ackReceived || false,
                options.responseStatus || null,
                detail.slice(0, 500),
                triggeredBy,
                options.attempts || 0,
                options.campaignId || null,
                options.connectionStatus || null,
                options.verificationMode || null,
                typeof options.matched === 'boolean' ? options.matched : null,
                typeof options.safeForAutomation === 'boolean' ? options.safeForAutomation : null,
            ]
        );
    } catch (error: any) {
        console.warn('[CraftMyFunnel] Failed to write push log:', error.message);
    }
}

async function readResponseText(response: Response): Promise<string> {
    try {
        return await response.text();
    } catch {
        return '';
    }
}

export async function sendCraftMyFunnelLeadSignal(
    signal: any,
    options: SendOptions = {}
): Promise<CraftMyFunnelSuccessResponse | { ok: false; error: string; status?: number }> {
    const leadId = String(signal?.lead_id || '');
    const orgId = String(signal?.org_id || 'default');
    const triggeredBy = options.triggeredBy || 'auto';
    const config = getConfig();
    if (!config) {
        console.info('[CraftMyFunnel] Skipping send because integration env vars are not fully configured.');
        if (leadId) {
            await logCraftMyFunnelDelivery(
                leadId,
                orgId,
                'DOWN',
                'CraftMyFunnel integration env vars are not fully configured.',
                triggeredBy,
                { requestSent: false, ackReceived: false, attempts: 0, campaignId: options.campaignId }
            );
        }
        return { ok: false, error: 'CraftMyFunnel integration is not configured' };
    }

    const payload = mapLeadCardToCraftMyFunnelPayload(signal, options);
    const rawBody = JSON.stringify(payload);
    const nonce = crypto.randomUUID();
    const timestamp = payload.timestamp;
    const signature = computeCraftMyFunnelSignature(config.hmacSecret, timestamp, nonce, rawBody);
    const endpointUrl = buildEndpointUrl(config.apiBaseUrl);

    const headers = {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'x-source': 'netjana-intel',
        'x-netjana-timestamp': timestamp,
        'x-netjana-nonce': nonce,
        'x-netjana-signature': signature,
    };

    let lastStatus: number | undefined;
    let lastError = 'Unknown CraftMyFunnel delivery error';

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const payloadWithAttempt = attempt === 0 ? payload : {
            ...payload,
            meta: { ...payload.meta, retry_attempt: attempt }
        };
        const bodyForAttempt = attempt === 0 ? rawBody : JSON.stringify(payloadWithAttempt);
        const signatureForAttempt = attempt === 0
            ? signature
            : computeCraftMyFunnelSignature(config.hmacSecret, timestamp, nonce, bodyForAttempt);

        try {
            if (attempt > 0) {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]));
            }

            const response = await fetch(endpointUrl, {
                method: 'POST',
                headers: {
                    ...headers,
                    'x-netjana-signature': signatureForAttempt,
                },
                body: bodyForAttempt,
                signal: AbortSignal.timeout(10_000),
            });

            if (response.ok) {
                const responseJson = await response.json() as CraftMyFunnelSuccessResponse;
                console.info(`[CraftMyFunnel] Delivered ${payload.event} for lead ${payload.lead.lead_id} to ${endpointUrl} using key ${redactKey(config.apiKey)}.`);
                await logCraftMyFunnelDelivery(
                    payload.lead.lead_id,
                    orgId,
                    'RECEIVED',
                    'CraftMyFunnel acknowledged webhook payload.',
                    triggeredBy,
                    {
                        requestSent: true,
                        ackReceived: true,
                        responseStatus: 200,
                        attempts: attempt + 1,
                        campaignId: options.campaignId,
                        connectionStatus: responseJson.connectionStatus,
                        verificationMode: responseJson.verificationMode,
                        matched: responseJson.matched,
                        safeForAutomation: responseJson.safeForAutomation,
                    }
                );
                return responseJson;
            }

            lastStatus = response.status;
            const responseText = (await readResponseText(response)).slice(0, 300);
            lastError = `HTTP ${response.status}${responseText ? `: ${responseText}` : ''}`;
            console.warn(`[CraftMyFunnel] Attempt ${attempt + 1} failed for lead ${payload.lead.lead_id}: ${lastError}`);

            if (!shouldRetry(response.status)) {
                await logCraftMyFunnelDelivery(
                    payload.lead.lead_id,
                    orgId,
                    'LOST',
                    lastError,
                    triggeredBy,
                    {
                        requestSent: true,
                        ackReceived: false,
                        responseStatus: response.status,
                        attempts: attempt + 1,
                        campaignId: options.campaignId,
                    }
                );
                return { ok: false, error: lastError, status: response.status };
            }
        } catch (error: any) {
            lastError = error?.message || 'Network error';
            console.warn(`[CraftMyFunnel] Attempt ${attempt + 1} errored for lead ${payload.lead.lead_id}: ${lastError}`);
        }
    }

    await logCraftMyFunnelDelivery(
        payload.lead.lead_id,
        orgId,
        'DOWN',
        lastError,
        triggeredBy,
        {
            requestSent: true,
            ackReceived: false,
            responseStatus: lastStatus,
            attempts: MAX_ATTEMPTS,
            campaignId: options.campaignId,
        }
    );
    return { ok: false, error: lastError, status: lastStatus };
}

export async function sendSampleCraftMyFunnelSignal(
    overrides: (Partial<CraftMyFunnelLeadPayload['lead']> & { org_id?: string }) = {}
) {
    const now = new Date().toISOString();
    return sendCraftMyFunnelLeadSignal({
        org_id: overrides.org_id || 'default',
        lead_id: overrides.lead_id || crypto.randomUUID(),
        company_name: overrides.company_name || 'Example Corp',
        intent_score: overrides.intent_score ?? 87,
        geo_state: overrides.geo_state || 'CA',
        sector: overrides.sector || 'Manufacturing',
        source_id: overrides.source_id || 'netjana-source-id',
        buying_stage: overrides.buying_stage || 'DECISION',
        procurement_category: overrides.procurement_category || 'AI outreach',
        procurement_timeline: overrides.procurement_timeline || '30-60 days',
        verity_tier: overrides.verity_tier || 'TIER_1',
        is_triangulated: overrides.is_triangulated ?? true,
        card_company: overrides.card_company || 'Example Corp',
        card_why_now: overrides.card_why_now || 'Recent buying signal',
        card_what_they_need: overrides.card_what_they_need || 'Outbound workflow support',
        card_do_this: overrides.card_do_this || 'Route to sales',
        created_at: overrides.created_at || now,
    });
}
