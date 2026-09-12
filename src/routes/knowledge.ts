import { Router, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
const pdf = require('pdf-parse');
import { TenantRAGStore } from '../core/rag/TenantRAGStore';
import { ChunkingPipeline } from '../core/rag/ChunkingPipeline';
import { RAGQueryEngine } from '../core/rag/RAGQueryEngine';
import { TenantRequest } from '../middleware/tenant';
import { query } from '../lib/database';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

const QuerySchema = z.object({
    question: z.string().min(2, 'Question must be at least 2 characters long'),
    entityId: z.string().optional(),
    docTypes: z.array(z.string()).optional(),
    k: z.number().min(1).max(20).optional().default(6)
});

/**
 * POST /api/knowledge/query
 * Natural language Q&A over the organization's ingested knowledge base.
 */
router.post('/query', async (req: TenantRequest, res: Response) => {
    try {
        const orgId = req.organizationId || 'default';
        const parseResult = QuerySchema.safeParse(req.body);

        if (!parseResult.success) {
            return res.status(400).json({
                error: 'ValidationError',
                details: parseResult.error.issues
            });
        }

        const { question, entityId, docTypes, k } = parseResult.data;

        const result = await RAGQueryEngine.query({
            orgId,
            question,
            entityId,
            docTypes,
            k
        });

        res.json(result);
    } catch (err: any) {
        console.error('[Knowledge API] Query failed:', err.message);
        res.status(500).json({ error: 'RAG query failed', details: err.message });
    }
});

/**
 * POST /api/knowledge/upload
 * Uploads a document (PDF or Text/Markdown/CSV), chunks it with sliding window,
 * and indexes each chunk into the persistent RAG vector store.
 */
router.post('/upload', upload.single('file'), async (req: TenantRequest, res: Response) => {
    try {
        const orgId = req.organizationId || 'default';
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const entityId = req.body.entityId || null;
        const sourceLabel = req.file.originalname;
        let text = '';

        if (req.file.mimetype === 'application/pdf') {
            const data = await pdf(req.file.buffer);
            text = data.text;
        } else {
            text = req.file.buffer.toString('utf-8');
        }

        if (!text || !text.trim()) {
            return res.status(422).json({ error: 'Uploaded document contains no readable text' });
        }

        // Chunk text using 512 token sliding window with 50-token overlap
        const rawChunks = ChunkingPipeline.chunkText(text, 512, 50);
        const store = new TenantRAGStore(orgId);

        const chunks = rawChunks.map((chunk, idx) => ({
            content: `[DOCUMENT UPLOAD: ${sourceLabel} - Part ${idx + 1}/${rawChunks.length}]\n${chunk}`,
            chunkIndex: idx,
            contentHash: ChunkingPipeline.hashContent(chunk),
            metadata: {
                filename: sourceLabel,
                mimetype: req.file!.mimetype,
                entityId,
                part: idx + 1,
                totalParts: rawChunks.length,
                uploadedAt: new Date().toISOString()
            }
        }));

        const insertedCount = await store.upsertBatch(chunks, 'upload', sourceLabel, entityId || undefined);

        res.json({
            message: 'Document processed, chunked, and indexed successfully.',
            filename: sourceLabel,
            chunks: insertedCount,
            entityId,
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        console.error('[Knowledge API] Upload failed:', error.message);
        res.status(500).json({ error: 'Failed to process document', details: error.message });
    }
});

/**
 * GET /api/knowledge/sources
 * Returns a distinct inventory of all ingested sources for the organization.
 */
router.get('/sources', async (req: TenantRequest, res: Response) => {
    try {
        const orgId = req.organizationId || 'default';

        const result = await query(
            `SELECT 
                source_id,
                doc_type,
                entity_id,
                COUNT(*) as chunk_count,
                MIN(created_at) as first_indexed,
                MAX(updated_at) as last_updated
             FROM rag_embeddings
             WHERE org_id = $1
             GROUP BY source_id, doc_type, entity_id
             ORDER BY last_updated DESC`,
            [orgId]
        );

        res.json({
            sources: result.rows,
            total: result.rows.length
        });
    } catch (err: any) {
        // If DB query fails or table empty, return empty list gracefully
        console.warn('[Knowledge API] Sources query warning:', err.message);
        res.json({ sources: [], total: 0 });
    }
});

/**
 * GET /api/knowledge/stats
 * Returns aggregated statistics of all indexed knowledge chunks.
 */
router.get('/stats', async (req: TenantRequest, res: Response) => {
    try {
        const orgId = req.organizationId || 'default';
        const store = new TenantRAGStore(orgId);
        const stats = await store.getTenantStats();
        res.json({ stats });
    } catch (err: any) {
        console.error('[Knowledge API] Stats error:', err.message);
        res.status(500).json({ error: 'Failed to fetch knowledge statistics' });
    }
});

/**
 * DELETE /api/knowledge/sources/:sourceId
 * Removes all embeddings associated with a specific source.
 */
router.delete('/sources/:sourceId', async (req: TenantRequest, res: Response) => {
    try {
        const orgId = req.organizationId || 'default';
        const { sourceId } = req.params;

        await query(
            `DELETE FROM rag_embeddings WHERE org_id = $1 AND source_id = $2`,
            [orgId, sourceId]
        );

        res.json({ message: `Source "${sourceId}" successfully purged from knowledge base.` });
    } catch (err: any) {
        console.error('[Knowledge API] Delete source error:', err.message);
        res.status(500).json({ error: 'Failed to delete source', details: err.message });
    }
});

export default router;
