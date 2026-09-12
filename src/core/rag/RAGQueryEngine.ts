import { TenantRAGStore, RAGQueryOptions } from './TenantRAGStore';
import { callModel } from '../../lib/model-api';
import { query } from '../../lib/database';

export interface RAGSourceItem {
    id: string;
    docType: string;
    sourceId: string;
    entityId?: string;
    score: number;
    chunkIndex: number;
    snippet: string;
}

export interface RAGQueryResult {
    answer: string;
    sources: RAGSourceItem[];
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    tokensUsed: number;
    sourcesCount: number;
}

export class RAGQueryEngine {
    /**
     * Executes an end-to-end RAG query:
     * 1. Semantic retrieval of top-K chunks from TenantRAGStore (pgvector or in-memory fallback)
     * 2. Context enrichment with any published Company Wiki records
     * 3. LLM synthesis with grounded citations
     */
    static async query(opts: {
        orgId: string;
        question: string;
        entityId?: string;
        docTypes?: string[];
        k?: number;
    }): Promise<RAGQueryResult> {
        const { orgId, question, entityId, docTypes, k = 6 } = opts;
        const store = new TenantRAGStore(orgId);

        // 1. Retrieve top-K chunks
        const queryOptions: RAGQueryOptions = {
            entityId,
            docTypes
        };

        const documents = await store.query(question, k, undefined, undefined, queryOptions);

        // 2. Fetch published Wiki page if entityId is specified
        let wikiContext = '';
        if (entityId) {
            try {
                const wikiRes = await query(
                    `SELECT title, body_md, version, updated_at 
                     FROM wiki_pages 
                     WHERE org_id = $1 AND entity_id = $2 AND is_published = TRUE 
                     LIMIT 1`,
                    [orgId, entityId]
                );
                if (wikiRes.rows.length > 0) {
                    const wp = wikiRes.rows[0];
                    wikiContext = `[COMPANY WIKI: ${wp.title} (v${wp.version})]\n${wp.body_md}\n`;
                }
            } catch (err: any) {
                console.warn('[RAGQueryEngine] Wiki context fetch non-fatal error:', err.message);
            }
        }

        // Check if we have any information
        if (documents.length === 0 && !wikiContext) {
            return {
                answer: `No ingested intelligence, signals, or wiki entries were found for this query in your organization's knowledge base. Try resolving the entity first in Entity Intelligence or uploading documents to expand coverage.`,
                sources: [],
                confidence: 'LOW',
                tokensUsed: 0,
                sourcesCount: 0
            };
        }

        // Format sources for citations
        const sources: RAGSourceItem[] = documents.map((doc, idx) => ({
            id: doc.metadata.id || `chunk_${idx}`,
            docType: doc.metadata.docType || 'unknown',
            sourceId: doc.metadata.sourceId || 'source',
            entityId: doc.metadata.entityId,
            score: Math.round((doc.metadata.score || 0) * 100) / 100,
            chunkIndex: doc.metadata.chunkIndex || 0,
            snippet: doc.pageContent.substring(0, 200).replace(/\n+/g, ' ') + '...'
        }));

        // Compute overall retrieval confidence
        const avgScore = documents.length > 0 
            ? documents.reduce((acc, d) => acc + (d.metadata.score || 0), 0) / documents.length 
            : (wikiContext ? 0.9 : 0.4);

        const confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 
            avgScore >= 0.75 ? 'HIGH' :
            avgScore >= 0.50 ? 'MEDIUM' : 'LOW';

        // 3. Assemble Grounded Context Prompt
        const contextBlocks: string[] = [];

        if (wikiContext) {
            contextBlocks.push(`=== VERIFIED COMPANY WIKI ===\n${wikiContext}`);
        }

        documents.forEach((doc, idx) => {
            const header = `[SOURCE #${idx + 1} | Type: ${doc.metadata.docType || 'Doc'} | Source: ${doc.metadata.sourceId || 'System'}${doc.metadata.score ? ` | Relevance: ${(doc.metadata.score * 100).toFixed(0)}%` : ''}]`;
            contextBlocks.push(`${header}\n${doc.pageContent}`);
        });

        const fullContext = contextBlocks.join('\n\n');

        const systemPrompt = `Role: Senior B2B Corporate Intelligence Analyst [RAG_ENGINE].
Your task: Answer the user's question accurately using ONLY the provided verified context records.
Rules:
1. Ground every key factual statement in the provided context using direct citations like [SOURCE #1], [SOURCE #2], or [COMPANY WIKI].
2. Highlight key figures (statutory CIN/PAN, financial charges, director names, registered addresses, procurement bids).
3. If the context does not contain the answer, explicitly state what is missing rather than guessing or hallucinating.
4. Structure the output clearly with concise headers and bullet points.`;

        const userPrompt = `QUESTION:
${question}

AVAILABLE VERIFIED KNOWLEDGE CONTEXT:
${fullContext}

Please deliver a clear, grounded analysis.`;

        const dateStr = new Date().toISOString().split('T')[0];
        const spendKey = `rag_query_calls:${dateStr}`;

        let answer = '';
        try {
            answer = await callModel({
                role: 'synthesizer',
                system: systemPrompt,
                user: userPrompt,
                orgId,
                spendKey,
                dailyLimit: 600
            });
        } catch (llmErr: any) {
            console.warn('[RAGQueryEngine] LLM generation error, returning formatted excerpts:', llmErr.message);
            answer = `### Retrieved Intelligence Records:\n\n` +
                documents.map((d, i) => `**[Source #${i+1} - ${d.metadata.sourceId}]**\n${d.pageContent}\n`).join('\n---\n');
        }

        const estimatedTokens = Math.ceil((systemPrompt.length + userPrompt.length + answer.length) / 4);

        return {
            answer,
            sources,
            confidence,
            tokensUsed: estimatedTokens,
            sourcesCount: sources.length + (wikiContext ? 1 : 0)
        };
    }
}
