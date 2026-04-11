import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { Document } from "@langchain/core/documents";
import { RAGAuditLog } from "./RAGAuditLog.js";
import { IS_COVOSPAN } from "../../config/mode";
import { AuditTrail } from "../compliance/AuditTrail";
import { ComplianceMatrix, ComplianceRegion } from "../compliance/ComplianceMatrix";

// ---------------------------------------------------------------------------
// Lightweight in-memory vector store — drop-in replacement for the removed
// langchain/vectorstores/memory module (removed in langchain v1.x).
// Uses cosine similarity against Gemini embeddings.
// ---------------------------------------------------------------------------
interface StoredDoc { 
    doc: Document; 
    vector?: number[];          // Legacy uncompressed
    compressedVector?: Uint8Array; // TurboQuant compressed (4-8 bit simulation)
    scale?: number;
    min?: number;
}

/**
 * Experimental TurboQuant-inspired Vector Compression
 * Simulates the QJL/PolarQuant logic by reducing 64-bit bounds to an 8-bit typed array
 * (achieving up to 8x VRAM/RAM compression per vector) before pushing to the RAG memory store.
 */
class TurboQuant {
    static compress(vector: number[]): { compressed: Uint8Array, scale: number, min: number } {
        // In actual TurboQuant, vectors are randomly rotated (PolarQuant) to uniform energy.
        // Then quantized. Here we implement a uniform scalar quantizer bound.
        let min = Math.min(...vector);
        let max = Math.max(...vector);
        let scale = (max - min) / 255;
        if (scale === 0) scale = 1; // Prevent div zero

        const compressed = new Uint8Array(vector.length);
        for (let i = 0; i < vector.length; i++) {
            compressed[i] = Math.round((vector[i] - min) / scale);
        }
        return { compressed, scale, min };
    }

    static decompress(compressed: Uint8Array, scale: number, min: number): number[] {
        const floatVector = new Array(compressed.length);
        for (let i = 0; i < compressed.length; i++) {
            // Apply residual correction matrix (simulated)
            floatVector[i] = (compressed[i] * scale) + min;
        }
        return floatVector;
    }
}

class MemoryVectorStore {
    private docs: StoredDoc[] = [];
    private embeddings: GoogleGenerativeAIEmbeddings;

    constructor(embeddings: GoogleGenerativeAIEmbeddings) {
        this.embeddings = embeddings;
    }

    static async fromDocuments(docs: Document[], embeddings: GoogleGenerativeAIEmbeddings): Promise<MemoryVectorStore> {
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
        return scored.slice(0, k).map(s => s.doc);
    }
}

function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
// ---------------------------------------------------------------------------


export class RAGCrossContaminationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RAGCrossContaminationError';
    }
}

// Internal store map (Shared core)
const globalJobStores = new Map<string, MemoryVectorStore>();

/**
 * Mock embeddings provider for graceful fallback when GOOGLE_API_KEY is missing.
 * H-08: Returns deterministic pseudo-random vectors seeded by text hash.
 * Zero vectors cause cosine similarity = 0/0 = NaN, breaking relevance ranking.
 * Seeded random vectors maintain stable, reproducible document ordering.
 */
class FallbackEmbeddings {
    private hashToVector(text: string): number[] {
        // Simple seeded PRNG based on text hash for deterministic results
        let seed = 0;
        for (let i = 0; i < text.length; i++) {
            seed = ((seed << 5) - seed + text.charCodeAt(i)) | 0;
        }
        const vec = new Array(768);
        let norm = 0;
        for (let i = 0; i < 768; i++) {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            vec[i] = (seed / 0x7fffffff) * 2 - 1; // range [-1, 1]
            norm += vec[i] * vec[i];
        }
        // Normalize to unit vector so cosine similarity is meaningful
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

const embeddings = process.env.GOOGLE_API_KEY 
    ? new GoogleGenerativeAIEmbeddings({
        apiKey: process.env.GOOGLE_API_KEY,
        modelName: "embedding-001",
    })
    : (() => {
        console.warn('[TenantRAGStore] GOOGLE_API_KEY missing. Activating FallbackEmbeddings.');
        return new FallbackEmbeddings() as any;
    })();

export class TenantRAGStore {
    private organizationId: string;

    constructor(organizationId: string) {
        this.organizationId = organizationId;
    }

    /**
     * Enforces strict namespace isolation.
     * rag:{orgId}:{region}:{docType}:{docId}
     */
    private getNamespace(docType: string, docId: string, region: string = 'global'): string {
        const ns = `rag:${this.organizationId}:${region}:${docType}:${docId}`;
        this.validateNamespace(ns);
        return ns;
    }

    private validateNamespace(ns: string) {
        // Rule: Tenant must never access covospan_edge namespace
        if (ns.includes(':covospan_edge:') && this.organizationId !== 'covospan_edge') {
            throw new RAGCrossContaminationError(`Unauthorized access attempt to COVOSPAN_EDGE namespace detected by Org: ${this.organizationId}`);
        }
        
        // Rule: Enforce own organization boundaries
        if (!ns.startsWith(`rag:${this.organizationId}:`) && !ns.startsWith('rag:netjana_intel:')) {
            throw new RAGCrossContaminationError(`Namespace violation: Org ${this.organizationId} attempting to access ${ns}`);
        }
    }

    async upsert(docType: string, docId: string, text: string, metadata: any = {}, requestId?: string, region: string = 'global') {
        // Enforce Regional Residency
        const serverRegion = process.env.REGION_ID || 'global';
        if (!ComplianceMatrix.checkResidencyCompliance(region.toUpperCase() as ComplianceRegion, serverRegion)) {
             throw new Error(`Compliance violation: Data for ${region} cannot be stored in ${serverRegion}`);
        }

        const ns = this.getNamespace(docType, docId, region);
        
        // Log operation
        await RAGAuditLog.log({
            organizationId: this.organizationId,
            namespace: ns,
            operation: 'write',
            docId,
            requestId
        });

        await AuditTrail.log({
            actorId: `rag:${this.organizationId}`,
            organizationId: this.organizationId,
            action: 'RAG_WRITE',
            resource: ns,
            metadata: { docType, region }
        });

        // Use the existing logic to index
        // For the memory store implementation, we map namespace to the jobStore key
        let store = globalJobStores.get(ns);
        if (!store) {
            store = await MemoryVectorStore.fromDocuments([new Document({ pageContent: text, metadata: { ...metadata, ns } })], embeddings);
            globalJobStores.set(ns, store);
        } else {
            await store.addDocuments([new Document({ pageContent: text, metadata: { ...metadata, ns } })]);
        }
        return true;
    }

    async query(queryText: string, k: number = 5, requestId?: string, region?: string): Promise<Document[]> {
        // Enforce isolation by filtering searches within namespaces belonging to THIS org
        // and optionally restricted to a specific region (Edge Rerouting)
        // In local MemoryVectorStore, we simulate this by querying specific keys
        // or filtering results by metadata.ns startsWith 'rag:{orgId}:'
        
        await RAGAuditLog.log({
            organizationId: this.organizationId,
            namespace: `query:${this.organizationId}`,
            operation: 'read',
            requestId
        });

        const results: Document[] = [];
        // This is a simplified memory implementation. In a real Vector DB (Pinecone/Milvus), 
        // we would pass a filter: { ns: { $regex: `^rag:${this.organizationId}:` } }
        for (const [ns, store] of globalJobStores.entries()) {
            const isMatch = ns.startsWith(`rag:${this.organizationId}:`) || ns.startsWith('rag:netjana_intel:');
            const regionMatch = !region || ns.includes(`:${region}:`);
            
            if (isMatch && regionMatch) {
                const hits = await store.similaritySearch(queryText, k);
                results.push(...hits);
            }
        }

        return results.sort((a, b) => (b.metadata.score || 0) - (a.metadata.score || 0)).slice(0, k);
    }

    async delete(docType: string, docId: string, requestId?: string) {
        const ns = this.getNamespace(docType, docId);
        await RAGAuditLog.log({
            organizationId: this.organizationId,
            namespace: ns,
            operation: 'delete',
            docId,
            requestId
        });
        globalJobStores.delete(ns);
    }

    async clearJobData(jobId: string) {
        // Remove all namespaces associated with this job
        for (const ns of globalJobStores.keys()) {
            if (ns.includes(`:${jobId}`)) {
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
        // Remove all namespaces associated with this tenant
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

    async getTenantStats() {
        // Implementation for stats
        const stats: Record<string, number> = {};
        for (const ns of globalJobStores.keys()) {
            if (ns.startsWith(`rag:${this.organizationId}:`)) {
                const parts = ns.split(':');
                const docType = parts[2] || 'unknown';
                stats[docType] = (stats[docType] || 0) + 1;
            }
        }
        return stats;
    }
}
