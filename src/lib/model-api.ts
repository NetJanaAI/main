/**
 * ModelAPI — Provider-agnostic LLM abstraction.
 * Edit MODEL_CONFIG to swap Gemini for any other provider.
 * Business logic files (gemini-chain, outreach) import this. Never LangChain directly.
 *
 * DEMO_MODE: When GOOGLE_API_KEY and OLLAMA_HOST are both absent, the FallbackLLM
 * returns realistic mock JSON per role so the full pipeline can be exercised locally
 * without spending any API credits.
 */

import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOllama } from '@langchain/ollama';
import { cache } from './cache';
import { TokenTracker } from './ai/token-tracker';
import { jsonToToon } from './ai/toon';

export type ModelRole = 'gate' | 'qualifier' | 'writer' | 'synthesizer' | 'advocate' | 'critic' | 'outreach';

const MODEL_CONFIG: Record<ModelRole, { model: string; maxTokens: number; temperature: number }> = {
    gate:        { model: 'gemini-1.5-flash', maxTokens: 128,  temperature: 0.1  },
    qualifier:   { model: 'gemini-1.5-pro',   maxTokens: 384,  temperature: 0.1  },
    writer:      { model: 'gemini-1.5-flash', maxTokens: 512,  temperature: 0.1  },
    synthesizer: { model: 'gemini-1.5-pro',   maxTokens: 768,  temperature: 0.15 },
    advocate:    { model: 'gemini-1.5-flash', maxTokens: 512,  temperature: 0.2  },
    critic:      { model: 'gemini-1.5-pro',   maxTokens: 1024, temperature: 0.1  },
    outreach:    { model: 'gemini-1.5-pro',   maxTokens: 512,  temperature: 0.7  },
};

// Realistic mock responses keyed by role. Used in DEMO_MODE (no API keys present).
const MOCK_RESPONSES: Record<ModelRole, () => string> = {
    gate: () => JSON.stringify({
        is_buyer: true,
        confidence: 0.87,
        valid: true,
        reason: "[DEMO] Company exhibits active procurement signals: new RFQ posted, procurement team expansion detected."
    }),
    qualifier: () => JSON.stringify({
        procurement_category: "Industrial Machinery & Equipment",
        procurement_timeline: "IMMEDIATE",
        buying_stage: "DECISION",
        pain_point: "[DEMO] Scaling production capacity — legacy equipment at 94% utilisation, Q3 deadline pressure.",
        confidence: "HIGH"
    }),
    writer: () => JSON.stringify({
        company: "[DEMO] Apex Manufacturing Pvt Ltd · Pune · Maharashtra · Industrial",
        why_now: "[DEMO] Company filed a RERA project clearance last week and posted 3 procurement RFQs on GeM Portal in the past 48 hours — capital expenditure cycle is live. Board approval for ₹4.2Cr equipment refresh confirmed in MCA filing.",
        what_they_need: "CNC milling centres and hydraulic press lines — minimum 2-unit batch",
        do_this: "Call procurement head directly — reference the GeM tender GEM/2024/B/INV-04821. Lead time sensitivity is high: competitor quote expires in 7 days."
    }),
    synthesizer: () => JSON.stringify({
        company: "[DEMO] Apex Manufacturing Pvt Ltd · Multi-Source",
        why_now: "[DEMO] Three overlapping signals confirmed: IndiaMART RFQ, GeM tender, and MCA director appointment — triangulated HIGH_VERITY intent.",
        what_they_need: "Full production line upgrade — phased procurement over 90 days",
        do_this: "Engage with a solution proposal citing all three evidence points. Present ROI model for 18-month payback."
    }),
    advocate: () => JSON.stringify({
        leads: [{ company: "[DEMO] Reliance Infra Projects", signal_strength: 0.82 }],
        frictionSignals: ["New Director appointed", "Import surge detected +340%"],
        overallAssessment: "[DEMO] Strong multi-signal corroboration. Recommend immediate outreach."
    }),
    critic: () => JSON.stringify({
        is_valid: true,
        confidence: "HIGH",
        refinedLeads: [],
        critiques: ["[DEMO] Signal validated — no contradictions found across source set."]
    }),
    outreach: () => JSON.stringify({
        coldEmail: {
            subject: "[DEMO] Re: GEM/2024/B/INV-04821 — CNC Line Procurement",
            body: "[DEMO] Hi [Name], I noticed Apex Manufacturing posted a GeM tender last week for CNC milling centres. We supply 14 of your sector peers in Pune. Can we get 20 minutes this week to share a comparable case study?"
        },
        linkedinNote: "[DEMO] Hi [Name], saw your team's GeM tender for CNC equipment — we work with 14 similar manufacturers in Pune. Happy to share a 2-page case study if useful.",
        callScript: {
            opener: "[DEMO] Hi, I'm calling about Apex Manufacturing's GeM tender posted this week for CNC equipment.",
            frictionHook: "[DEMO] I saw your production team is at 94% utilisation — that's exactly the threshold where our clients typically evaluate an upgrade.",
            cta: "[DEMO] Can I send over a quick comparison of options before your competitor quote expires?"
        }
    }),
};

let demoModeWarned = false;

/**
 * DEMO_MODE Fallback — returns mock JSON per role. No API call is made.
 * Activate by running without GOOGLE_API_KEY or OLLAMA_HOST in .env.
 */
class FallbackLLM {
    private role: ModelRole;
    constructor(role: ModelRole) { this.role = role; }
    async invoke(_input: any): Promise<{ content: string }> {
        if (!demoModeWarned) {
            console.warn('[ModelAPI] ⚠  DEMO_MODE ACTIVE — No GOOGLE_API_KEY or OLLAMA_HOST found. All inference will return structured mock data. Set GOOGLE_API_KEY in .env to enable live AI.');
            demoModeWarned = true;
        }
        return { content: MOCK_RESPONSES[this.role]() };
    }
}

export interface ModelCallOptions {
    role: ModelRole;
    system: string;
    user: string;
    orgId: string;
    spendKey: string;
    dailyLimit?: number;
    tokensSaved?: number; // Estimated tokens already saved by TOON before calling
}

export async function callModel(opts: ModelCallOptions): Promise<string> {
    const { role, system, user, orgId, spendKey, dailyLimit = 400, tokensSaved = 0 } = opts;

    const count = parseInt((await cache.get(spendKey)) || '0', 10);
    if (count >= dailyLimit) {
        throw new Error(`[ModelAPI] Daily spend limit reached for key: ${spendKey}`);
    }

    const config = MODEL_CONFIG[role];
    let client: any;

    if (process.env.GOOGLE_API_KEY) {
        client = new ChatGoogleGenerativeAI({
            model: config.model,
            maxOutputTokens: config.maxTokens,
            temperature: config.temperature,
        });
    } else if (process.env.OLLAMA_HOST) {
        client = new ChatOllama({
            baseUrl: process.env.OLLAMA_HOST,
            model: 'phi3', 
            temperature: config.temperature,
        });
    } else {
        client = new FallbackLLM(role);
    }

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const userPrompt = attempt === 0
                ? user
                : user + '\nReturn ONLY the JSON object. No markdown, no explanation.';
            
            const res = await client.invoke([['system', system], ['user', userPrompt]]);
            
            // Extract Usage Metadata (LangChain style)
            const usage = res.usage_metadata || res.response_metadata?.usage || {
                input_tokens: TokenTracker.estimateTokens(system + userPrompt),
                output_tokens: TokenTracker.estimateTokens(res.content as string)
            };

            // Record Usage
            await TokenTracker.recordUsage({
                orgId,
                role,
                model: config.model,
                inputTokens: usage.input_tokens || usage.prompt_tokens || 0,
                outputTokens: usage.output_tokens || usage.completion_tokens || 0,
                tokensSaved
            });

            await cache.incr(spendKey);
            return res.content as string;
        } catch (error) {
            console.warn(`[ModelAPI] Inference attempt ${attempt + 1} failed for ${role}:`, (error as Error).message);
            if (attempt === 1) throw error;
        }
    }
    throw new Error(`[ModelAPI] All retries exhausted for role: ${role}`);
}

export function parseModelJson(raw: string): any {
    try {
        // Strip markdown code fences first
        let cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();

        // M-04: Find the first balanced JSON object by tracking brace depth
        // instead of greedy regex which captures non-JSON text between first '{' and last '}'
        const startIdx = cleaned.indexOf('{');
        if (startIdx === -1) return null;

        let depth = 0;
        let endIdx = -1;
        for (let i = startIdx; i < cleaned.length; i++) {
            if (cleaned[i] === '{') depth++;
            else if (cleaned[i] === '}') depth--;
            if (depth === 0) { endIdx = i; break; }
        }
        if (endIdx === -1) return null;

        return JSON.parse(cleaned.substring(startIdx, endIdx + 1));
    } catch {
        // Fallback: try greedy match as last resort
        try {
            const match = raw.match(/\{[\s\S]*\}/);
            if (match) return JSON.parse(match[0]);
        } catch {}
        return null;
    }
}
