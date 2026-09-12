import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { Document } from "@langchain/core/documents";
import { RAGAuditLog } from "./RAGAuditLog";
import { AuditTrail } from "../compliance/AuditTrail";
import { ComplianceMatrix, ComplianceRegion } from "../compliance/ComplianceMatrix";
import { query, pool } from "../../lib/database";
import { ChunkingPipeline } from "./ChunkingPipeline";

// ---------------------------------------------------------------------------
// In-memory vector store fallback with TurboQuant compression
// ---------------------------------------------------------------------------
interface StoredDoc { 
    doc: Document; 
    vector?: number[];
    compressedVector?: Uint8Array;
    scale?: number;
    min?: number;
}

export class TurboQuant {
    static compress(vector: number[]): { compressed: Uint8Array, scale: number, min: number } {
        let min = Math.min(...vector);
        let max = Math.max(...vector);
        let scale = (max - min) / 255;
        if (scale === 0) scale = 1;

        const compressed = new Uint8Array(vector.length);
        for (let i = 0; i < vector.length; i++) {
            compressed[i] = Math.round((vector[i] - min) / scale);
        }
        return { compressed, scale, min };
    }

    static decompress(compressed: Uint8Array, scale: number, min: number): number[] {
        const floatVector = new Array(compressed.length);
        for (let i = 0; i < compressed.length; i++) {
            floatVector[i] = (compressed[i] * scale) + min;
        }
        return floatVector;
    }
}

class MemoryVectorStore {
    private docs: StoredDoc[] = [];
    private embeddings: any;

    constructor(embeddings: any) {
        this.embeddings = embeddings;
    }

    static async fromDocuments(docs: Document[], embeddings: any): Promise<MemoryVectorStore> {
        const store = new MemoryVectorStore(embeddings);
        await store.addDocuments(docs);
        return store;
    }

    async addDocuments(docs: Document[]): Promise<void> {
        const texts = docs.map(d => d.pageContent);
        const vectors = await this.embeddings.embedDocuments(texts);
        const enableTurboQuant = process.env.ENABLE_TURBOQUANT !== 'false';
        for (let i = 0; i < docs.length; i++) {
            if (enableTurboQuant) {
                const { compressed, scale, min } = TurboQuant.compress(vectors[i]);
                this.docs.push({ doc: docs[i], compressedVector: compressed, scale, min });
            } else {
                this.docs.push({ doc: docs[i], vector: vectors[i] });
            }
        }
    }

    async similaritySearch(query: string, k: number = 4): Promise<Document[]> {
        if (this.docs.length === 0) return [];
        const queryVec = await this.embeddings.embedQuery(query);
        const scored = this.docs.map(entry => {
            let baseVector = entry.vector;
            if (entry.compressedVector && entry.scale !== undefined && entry.min !== undefined) {
                baseVector = TurboQuant.decompress(entry.compressedVector, entry.scale, entry.min);
            }
            return {
                doc: entry.doc,
                score: baseVector ? cosineSimilarity(queryVec, baseVector) : 0
            };
        });
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, k).map(s => {
            s.doc.metadata.score = s.score;
            return s.doc;
        });
    }
}

export function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class RAGCrossContaminationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RAGCrossContaminationError';
    }
}

const globalJobStores = new Map<string, MemoryVectorStore>();

/**
 * Mock embeddings provider for deterministic, offline testing and dev fallback.
 */
export class FallbackEmbeddings {
    private hashToVector(text: string): number[] {
        let seed = 0;
        for (let i = 0; i < text.length; i++) {
            seed = ((seed << 5) - seed + text.charCodeAt(i)) | 0;
        }
        const vec = new Array(768);
        let norm = 0;
        for (let i = 0; i < 768; i++) {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            vec[i] = (seed / 0x7fffffff) * 2 - 1;
            norm += vec[i] * vec[i];
        }
        norm = Math.sqrt(norm);
        for (let i = 0; i < 768; i++) vec[i] /= norm;
        return vec;
    }
    async embedDocuments(texts: string[]): Promise<number[][]> {
        return texts.map(t => this.hashToVector(t));
    }
    async embedQuery(text: string): Promise<number[]> {
        return this.hashToVector(text);
    }
}

const embeddingModel = process.env.GEMINI_EMBEDDING_MODEL || "text-embedding-004";

export const ragEmbeddings = process.env.GOOGLE_API_KEY 
    ? new GoogleGenerativeAIEmbeddings({
        apiKey: process.env.GOOGLE_API_KEY,
        modelName: embeddingModel,
    })
    : (() => {
        console.warn('[TenantRAGStore] GOOGLE_API_KEY missing. Activating FallbackEmbeddings.');
        return new FallbackEmbeddings() as any;
    })();

export interface RAGQueryOptions {
    entityId?: string;
    docTypes?: string[];
    minScore?: number;
}

export class TenantRAGStore {
    private organizationId: string;

    constructor(organizationId: string) {
        this.organizationId = organizationId || 'default';
    }

    private getNamespace(docType: string, docId: string, region: string = 'global'): string {
        const ns = `rag:${this.organizationId}:${region}:${docType}:${docId}`;
        this.validateNamespace(ns);
        return ns;
    }

    private validateNamespace(ns: string) {
        if (ns.includes(':covospan_edge:') && this.organizationId !== 'covospan_edge') {
            throw new RAGCrossContaminationError(`Unauthorized access attempt to COVOSPAN_EDGE namespace detected by Org: ${this.organizationId}`);
        }
        if (!ns.startsWith(`rag:${this.organizationId}:`) && !ns.startsWith('rag:netjana_intel:')) {
            throw new RAGCrossContaminationError(`Namespace violation: Org ${this.organizationId} attempting to access ${ns}`);
        }
    }

    /**
     * Upserts a document chunk into the persistent pgvector store,
     * falling back to in-memory store if Postgres is unavailable.
     */
    async upsert(
        docType: string,
        docId: string,
        text: string,
        metadata: any = {},
        requestId?: string,
        region: string = 'global',
        entityId?: string,
        sourceId?: string
    ): Promise<boolean> {
        const serverRegion = process.env.REGION_ID || 'global';
        if (!ComplianceMatrix.checkResidencyCompliance(region.toUpperCase() as ComplianceRegion, serverRegion)) {
             throw new Error(`Compliance violation: Data for ${region} cannot be stored in ${serverRegion}`);
        }

        const ns = this.getNamespace(docType, docId, region);
        const contentHash = ChunkingPipeline.hashContent(text);
        const resolvedEntityId = entityId || metadata.entityId || null;
        const resolvedSourceId = sourceId || metadata.sourceId || docId;
        const chunkIndex = metadata.chunkIndex !== undefined ? metadata.chunkIndex : 0;

        await RAGAuditLog.log({
            organizationId: this.organizationId,
            namespace: ns,
            operation: 'write',
            docId,
            requestId,
            metadata: { docType, region, entityId: resolvedEntityId, sourceId: resolvedSourceId }
        });

        await AuditTrail.log({
            actorId: `rag:${this.organizationId}`,
            organizationId: this.organizationId,
            action: 'RAG_WRITE',
            resource: ns,
            metadata: { docType, region }
        });

        // 1. Try persistent PostgreSQL pgvector store if configured
        if (pool && process.env.RAG_USE_PGVECTOR !== 'false') {
            try {
                const vector = await ragEmbeddings.embedQuery(text);
                const vectorString = `[${vector.join(',')}]`;

                // Try inserting with vector(768)
                const upsertSql = `
                    INSERT INTO rag_embeddings (
                        org_id, entity_id, doc_type, source_id, chunk_index,
                        content, content_hash, metadata, embedding, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
                    ON CONFLICT (org_id, doc_type, content_hash)
                    DO UPDATE SET
                        content = EXCLUDED.content,
                        metadata = EXCLUDED.metadata,
                        embedding = EXCLUDED.embedding,
                        entity_id = COALESCE(EXCLUDED.entity_id, rag_embeddings.entity_id),
                        source_id = COALESCE(EXCLUDED.source_id, rag_embeddings.source_id),
                        updated_at = NOW();
                `;

                await query(upsertSql, [
                    this.organizationId,
                    resolvedEntityId,
                    docType,
                    resolvedSourceId,
                    chunkIndex,
                    text,
                    contentHash,
                    JSON.stringify({ ...metadata, ns, docId }),
                    vectorString
                ]);

                return true;
            } catch (dbError: any) {
                console.warn(`[TenantRAGStore] Postgres pgvector upsert failed, falling back to memory store:`, dbError.message);
            }
        }

        // 2. In-Memory fallback store
        let store = globalJobStores.get(ns);
        if (!store) {
            store = await MemoryVectorStore.fromDocuments(
                [new Document({ pageContent: text, metadata: { ...metadata, ns, docType, entityId: resolvedEntityId, sourceId: resolvedSourceId } })],
                ragEmbeddings
            );
            globalJobStores.set(ns, store);
        } else {
            await store.addDocuments([
                new Document({ pageContent: text, metadata: { ...metadata, ns, docType, entityId: resolvedEntityId, sourceId: resolvedSourceId } })
            ]);
        }

        return true;
    }

    /**
     * Batch upsert of TextChunks for high throughput indexing.
     */
    async upsertBatch(
        chunks: Array<{ content: string; chunkIndex: number; contentHash: string; metadata: any }>,
        docType: string,
        sourceId: string,
        entityId?: string
    ): Promise<number> {
        let inserted = 0;
        for (const chunk of chunks) {
            const success = await this.upsert(
                docType,
                `${sourceId}_chunk_${chunk.chunkIndex}`,
                chunk.content,
                { ...chunk.metadata, chunkIndex: chunk.chunkIndex },
                undefined,
                'global',
                entityId,
                sourceId
            );
            if (success) inserted++;
        }
        return inserted;
    }

    /**
     * Semantic similarity query over the tenant's knowledge store.
     */
    async query(
        queryText: string,
        k: number = 5,
        requestId?: string,
        region?: string,
        options: RAGQueryOptions = {}
    ): Promise<Document[]> {
        await RAGAuditLog.log({
            organizationId: this.organizationId,
            namespace: `query:${this.organizationId}`,
            operation: 'read',
            requestId,
            metadata: { query: queryText, k, options }
        });

        // 1. Try persistent PostgreSQL query first
        if (pool && process.env.RAG_USE_PGVECTOR !== 'false') {
            try {
                const queryVector = await ragEmbeddings.embedQuery(queryText);
                const vectorString = `[${queryVector.join(',')}]`;

                let sql = `
                    SELECT 
                        id, content, doc_type, source_id, entity_id, chunk_index, metadata,
                        1 - (embedding <=> $1::vector) as score
                    FROM rag_embeddings
                    WHERE org_id = $2
                `;
                const params: any[] = [vectorString, this.organizationId];
                let paramIndex = 3;

                if (options.entityId) {
                    sql += ` AND (entity_id = $${paramIndex} OR metadata->>'entityId' = $${paramIndex})`;
                    params.push(options.entityId);
                    paramIndex++;
                }

                if (options.docTypes && options.docTypes.length > 0) {
                    sql += ` AND doc_type = ANY($${paramIndex})`;
                    params.push(options.docTypes);
                    paramIndex++;
                }

                sql += ` ORDER BY embedding <=> $1::vector ASC LIMIT $${paramIndex}`;
                params.push(k);

                const res = await query(sql, params);
                if (res.rows.length > 0) {
                    return res.rows.map(row => new Document({
                        pageContent: row.content,
                        metadata: {
                            ...(typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata),
                            id: row.id,
                            docType: row.doc_type,
                            sourceId: row.source_id,
                            entityId: row.entity_id,
                            chunkIndex: row.chunk_index,
                            score: parseFloat(row.score) || 0
                        }
                    }));
                }
            } catch (dbErr: any) {
                console.warn(`[TenantRAGStore] Postgres pgvector query error, using memory fallback:`, dbErr.message);
            }
        }

        // 2. In-Memory fallback search
        const results: Document[] = [];
        for (const [ns, store] of globalJobStores.entries()) {
            const isMatch = ns.startsWith(`rag:${this.organizationId}:`) || ns.startsWith('rag:netjana_intel:');
            const regionMatch = !region || ns.includes(`:${region}:`);
            
            if (isMatch && regionMatch) {
                const hits = await store.similaritySearch(queryText, k);
                results.push(...hits);
            }
        }

        // Filter by options if provided
        let filtered = results;
        if (options.entityId) {
            filtered = filtered.filter(doc => doc.metadata.entityId === options.entityId);
        }
        if (options.docTypes && options.docTypes.length > 0) {
            filtered = filtered.filter(doc => options.docTypes!.includes(doc.metadata.docType));
        }

        return filtered
            .sort((a, b) => (b.metadata.score || 0) - (a.metadata.score || 0))
            .slice(0, k);
    }

    /**
     * Delete documents by docType and optional entityId or sourceId.
     */
    async delete(docType: string, docId: string, requestId?: string) {
        const ns = this.getNamespace(docType, docId);
        await RAGAuditLog.log({
            organizationId: this.organizationId,
            namespace: ns,
            operation: 'delete',
            docId,
            requestId
        });

        if (pool && process.env.RAG_USE_PGVECTOR !== 'false') {
            try {
                await query(
                    `DELETE FROM rag_embeddings 
                     WHERE org_id = $1 AND doc_type = $2 AND (source_id = $3 OR entity_id = $3)`,
                    [this.organizationId, docType, docId]
                );
            } catch (e: any) {
                console.warn('[TenantRAGStore] DB delete failed:', e.message);
            }
        }

        globalJobStores.delete(ns);
    }

    async clearJobData(jobId: string) {
        if (pool && process.env.RAG_USE_PGVECTOR !== 'false') {
            try {
                await query(
                    `DELETE FROM rag_embeddings 
                     WHERE org_id = $1 AND (source_id = $2 OR metadata->>'jobId' = $2 OR metadata->>'docId' = $2)`,
                    [this.organizationId, jobId]
                );
            } catch (e: any) {
                console.warn('[TenantRAGStore] DB clearJobData failed:', e.message);
            }
        }

        for (const ns of globalJobStores.keys()) {
            const parts = ns.split(':');
            if (parts.includes(jobId)) {
                globalJobStores.delete(ns);
            }
        }
        
        await RAGAuditLog.log({
            organizationId: this.organizationId,
            namespace: `cleanup:${jobId}`,
            operation: 'delete'
        });
    }

    async clearStore() {
        if (pool && process.env.RAG_USE_PGVECTOR !== 'false') {
            try {
                await query(`DELETE FROM rag_embeddings WHERE org_id = $1`, [this.organizationId]);
            } catch (e: any) {
                console.warn('[TenantRAGStore] DB clear failed:', e.message);
            }
        }

        for (const ns of globalJobStores.keys()) {
            if (ns.startsWith(`rag:${this.organizationId}:`)) {
                globalJobStores.delete(ns);
            }
        }

        await RAGAuditLog.log({
            organizationId: this.organizationId,
            namespace: `cleanup_all:${this.organizationId}`,
            operation: 'delete'
        });
    }

    /**
     * Retrieves aggregated statistics of indexed documents for the organization.
     */
    async getTenantStats(): Promise<Record<string, number>> {
        const stats: Record<string, number> = {
            entity: 0,
            signal: 0,
            upload: 0,
            wiki: 0,
            total: 0
        };

        if (pool && process.env.RAG_USE_PGVECTOR !== 'false') {
            try {
                const res = await query(
                    `SELECT doc_type, COUNT(*) as count 
                     FROM rag_embeddings 
                     WHERE org_id = $1 
                     GROUP BY doc_type`,
                    [this.organizationId]
                );
                for (const row of res.rows) {
                    stats[row.doc_type] = parseInt(row.count, 10) || 0;
                    stats.total += stats[row.doc_type];
                }
                return stats;
            } catch (e: any) {
                // fall through to memory count
            }
        }

        for (const ns of globalJobStores.keys()) {
            if (ns.startsWith(`rag:${this.organizationId}:`)) {
                const parts = ns.split(':');
                const docType = parts[3] || parts[2] || 'unknown';
                stats[docType] = (stats[docType] || 0) + 1;
                stats.total++;
            }
        }

        return stats;
    }
}
