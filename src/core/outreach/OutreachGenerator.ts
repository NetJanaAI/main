import crypto from 'crypto';
import { TenantRAGStore } from "../../core/rag/TenantRAGStore";
import { SecureLogger } from "../../utils/logger";
import { injectInfluenceContext } from "../toon/influenceInjector";
import { cache } from "../../lib/cache";
import { callModel, parseModelJson } from "../../lib/model-api";
import { getHmacSecret } from "../../lib/secrets";

export interface OutreachPayload {
    coldEmail: { subject: string; body: string };
    linkedinNote: string;
    callScript: { opener: string; frictionHook: string; cta: string };
    qualityScore: number;
    metadata: {
        tone: string;
        region: string;
        timestamp: string;
        signature: string;
        isRewritten: boolean;
        criticIssues: string[];
    };
}

export class OutreachGenerator {
    constructor() {}

    /**
     * Main Generation Orchestrator
     */
    async generate(leadId: string, organizationId: string, tone: string = 'direct'): Promise<OutreachPayload> {
        const spendKeyBase = `gemini_calls:outreach:${new Date().toISOString().split('T')[0]}`;
        
        // 1. Load context from RAG
        const store = new TenantRAGStore(organizationId);
        const leadDocs = await store.query(`lead details id:${leadId}`, 1, leadId);
        
        if (leadDocs.length === 0) throw new Error("Lead data not found in RAG store.");
        const lead = leadDocs[0].metadata;

        // Load influence map if exists
        const influenceDocs = await store.query(`influence map id:${leadId}`, 1, `influence:${leadId}`);
        const influenceMap = influenceDocs.length > 0 ? influenceDocs[0].metadata : null;

        // 2. Generate Primary Assets
        const influenceContext = injectInfluenceContext(influenceMap as any);
        const prompt = `${this.buildToonPrompt(lead, influenceMap, tone)}\n\n${influenceContext}`;
        
        const genRaw = await callModel({
            role: 'outreach',
            system: "You are a professional B2B outreach writer for the India/UAE corridor. Respond in JSON only.",
            user: prompt,
            orgId: organizationId,
            spendKey: spendKeyBase
        });
        let assets = parseModelJson(genRaw);
        if (!assets) throw new Error("Outreach generation parse failed");

        // 3. Adversarial Quality Loop
        const criticResult = await this.auditQuality(assets, lead, spendKeyBase, organizationId);
        let finalAssets = assets;
        let isRewritten = false;

        if (criticResult.score < 70 && criticResult.rewrite) {
             console.log(`[OutreachGen] Quality score ${criticResult.score} too low. Attempting adversarial rewrite...`);
             finalAssets = criticResult.rewrittenAssets || assets;
             isRewritten = true;
        }

        // 4. Final Packaging & Signing
        const payload: OutreachPayload = {
            ...finalAssets,
            qualityScore: criticResult.score,
            metadata: {
                tone,
                region: lead.region || 'Unknown',
                timestamp: new Date().toISOString(),
                signature: '', 
                isRewritten,
                criticIssues: criticResult.issues || []
            }
        };

        payload.metadata.signature = this.signPayload(payload, leadId, organizationId);

        // 5. Cache in Upstash
        await cache.set(`outreach:${organizationId}:${leadId}:latest`, JSON.stringify(payload), { ex: 30 * 24 * 60 * 60 });

        return payload;
    }

    private buildToonPrompt(lead: any, influenceMap: any, tone: string): string {
        const frictionSignals = lead.signals || [];
        const touchpoints = influenceMap ? (influenceMap.tradeBodies || []).concat(influenceMap.events || []) : [];
        const isTender = lead.source_id === 'gem_xml' || lead.watch_profile_id || (lead.rawPayload && lead.rawPayload.bid_id);

        return `[TOON:OUTREACH_GEN_v1]
ROLE: Expert B2B outreach writer, India/UAE corridor specialist
TONE: ${tone}

TARGET:
  company=${lead.companyName || lead.domain || lead.company_name}
  industry=${lead.industry || lead.sector || 'B2B'}
  region=${lead.region || lead.geo_state || 'India/UAE'}

FRICTION_SIGNALS:
${frictionSignals.map((s: any) => `  - ${s.type || 'Signal'}: ${s.description || s.value} (strength: ${s.score || 80})`).join('\n')}

RULES:
- Reference AT LEAST ONE friction signal explicitly in each asset
- UAE region: reference GITEX/DIFC context if present
- Zero generic phrases
${isTender ? '- Context: This is a Tender Watch Match. Highlight our capacity to fulfill the tender requirements and reference the tender ID if available.' : ''}

OUTPUT: JSON only
{
  "coldEmail": { "subject": string, "body": string },
  "linkedinNote": string,
  "callScript": { "opener": string, "frictionHook": string, "cta": string }
}
[/TOON]`;
    }

    private async auditQuality(assets: any, lead: any, spendKeyBase: string, orgId: string) {
        const criticPrompt = `[TOON:OUTREACH_CRITIC_v1]
Review this B2B outreach for specificity and regional accuracy.
ASSETS: ${JSON.stringify(assets)}
LEAD_REGION: ${lead.region}

Output JSON: { "score": number, "issues": string[], "rewrite": boolean, "rewrittenAssets": { ...SAME_STRUCTURE... } }
[/TOON]`;

        const criticRaw = await callModel({
            role: 'critic',
            system: "You are an outreach quality auditor. Respond in JSON only.",
            user: criticPrompt,
            orgId,
            spendKey: spendKeyBase
        });
        const result = parseModelJson(criticRaw);
        return result || { score: 100, issues: [], rewrite: false };
    }

    private signPayload(payload: any, leadId: string, organizationId: string): string {
        const dataToSign = `${leadId}:${organizationId}:${JSON.stringify(payload.coldEmail)}`;
        return crypto.createHmac('sha256', getHmacSecret('outreach payload signing'))
            .update(dataToSign)
            .digest('hex');
    }
}
