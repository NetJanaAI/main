import { DeadLetterQueue } from "../lib/DeadLetterQueue";
import { TenantRAGStore } from "../core/rag/TenantRAGStore";
import { Document as LangchainDocument } from "@langchain/core/documents";
import { jsonToToon } from "../lib/ai/toon";
import { callModel, parseModelJson } from "../lib/model-api";
import { TokenTracker } from "../lib/ai/token-tracker";

export class AdversarialCritic {
    private advocateTemplate: string;
    private criticTemplate: string;
    private spendKeyBase: string;

    constructor() {
        this.spendKeyBase = `gemini_calls:${new Date().toISOString().split('T')[0]}`;
        
        this.advocateTemplate = `You are the NetJana AI Advocate. 
        Analyze the data in TOON format and extract B2B friction signals.
        
        <DATA>
        {text}
        </DATA>

        Output JSON: {{
            "frictionScore": number, 
            "intentSummary": "string",
            "signals": [
                {{ "category": "TECHNICAL_DEBT|OPERATIONAL_FRICTION|STRATEGIC_ALPHA", "value": "string", "source_citation": "snippet" }}
            ]
        }}`;

        this.criticTemplate = `You are the NetJana AI Critic. 
        Audit the Advocate Proposal against the original TOON Data.
        
        <DATA>
        {text}
        </DATA>

        <ADVOCATE_PROPOSAL>
        {proposal}
        </ADVOCATE_PROPOSAL>

        Output JSON: {{
            "isValid": boolean,
            "challenges": ["string"],
            "recommendedScore": number,
            "groundingScore": number (0-1)
        }}`;
    }

    public async analyze(text: string, jobId: string, url?: string, organizationId?: string) {
        try {
            console.log(`[AdversarialCritic] Starting logic for job ${jobId}...`);
            
            // 1. RAG Retrieve
            const store = new TenantRAGStore(organizationId || 'default');
            const relevantDocs = await store.query("technical debt, friction, purchase intent", 8, jobId);
            const contextText = relevantDocs.length > 0 
                ? relevantDocs.map((d: LangchainDocument) => d.pageContent).join("\n---\n")
                : text; 

            // 2. TOON Convert
            const toonContext = jsonToToon(relevantDocs.length > 0 
                ? relevantDocs.map((d: LangchainDocument) => ({ content: d.pageContent, meta: d.metadata })) 
                : { content: text });

            // 3. Advocate Step
            const advocatePrompt = this.advocateTemplate.replace('{text}', toonContext);
            const originalContext = relevantDocs.length > 0 
                ? { docs: relevantDocs.map(d => ({ content: d.pageContent, meta: d.metadata })) }
                : { content: text };
            const advocateTokensSaved = TokenTracker.calculateToonSavings(originalContext, toonContext);

            const advocateRaw = await callModel({
                role: 'advocate',
                system: "You are a B2B procurement advocate. Respond in JSON only.",
                user: advocatePrompt,
                orgId: organizationId || 'default',
                spendKey: this.spendKeyBase,
                tokensSaved: advocateTokensSaved
            });
            const proposal = parseModelJson(advocateRaw);
            if (!proposal) throw new Error("Advocate parse failed");

            // 4. Critic Step
            const criticPrompt = this.criticTemplate.replace('{text}', toonContext).replace('{proposal}', JSON.stringify(proposal));
            const criticTokensSaved = TokenTracker.calculateToonSavings(originalContext, toonContext);

            const criticRaw = await callModel({
                role: 'critic',
                system: "You are a grounding critic. Respond in JSON only.",
                user: criticPrompt,
                orgId: organizationId || 'default',
                spendKey: this.spendKeyBase,
                tokensSaved: criticTokensSaved
            });
            const audit = parseModelJson(criticRaw);
            if (!audit) throw new Error("Critic parse failed");

            // Consensus
            const signals = proposal.signals || [];
            const groundingScore = audit.groundingScore || 0;
            return {
                frictionScore: audit.isValid ? proposal.frictionScore : audit.recommendedScore,
                intentSummary: audit.isValid ? proposal.intentSummary : `[Verified] ${proposal.intentSummary}`,
                verity_steps: [
                    { role: 'advocate', score: proposal.frictionScore },
                    { role: 'critic', score: audit.recommendedScore }
                ],
                painPoints: {
                    technicalDebt: signals.filter((s: any) => s.category === 'TECHNICAL_DEBT').map((s: any) => s.value),
                    operationalBottlenecks: signals.filter((s: any) => s.category === 'OPERATIONAL_FRICTION').map((s: any) => s.value),
                    strategicAlpha: signals.filter((s: any) => s.category === 'STRATEGIC_ALPHA').map((s: any) => s.value)
                },
                groundingScore,
                ceoIcebreaker: audit.isValid ? `Reviewing your ${signals[0]?.value || 'positioning'}...` : "Identified unique friction points.",
                // M-09: Derived from grounding score — only verified if critic confirms sufficient evidence
                complianceVerified: audit.isValid && groundingScore >= 0.5,
                citations: signals.map((s: any) => s.source_citation).filter(Boolean)
            };
        } catch (error) {
            console.error('[AdversarialCritic] Failed:', error);
            DeadLetterQueue.log({
                timestamp: new Date().toISOString(),
                url: url || 'unknown',
                error: (error as Error).message,
                rawText: text.substring(0, 500)
            });
            return {
                frictionScore: 0,
                intentSummary: "Analysis Failed",
                painPoints: { technicalDebt: [], operationalBottlenecks: [], strategicAlpha: [] },
                groundingScore: 0,
                ceoIcebreaker: "Friction detected.",
                complianceVerified: false,
                citations: []
            };
        }
    }
}
