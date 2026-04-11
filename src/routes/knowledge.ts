import { Router } from 'express';
import multer from 'multer';
const pdf = require('pdf-parse');
import { TenantRAGStore } from '../core/rag/TenantRAGStore';
import { TenantRequest } from '../middleware/tenant';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * POST /api/knowledge/upload
 * Upload a document (PDF/Text) to be ingested into the RAG vector store.
 */
router.post('/upload', upload.single('file'), async (req: TenantRequest, res) => {
    try {
        const orgId = req.organizationId || 'default';
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const jobId = req.body.jobId || 'global';
        let text = '';

        if (req.file.mimetype === 'application/pdf') {
            const data = await pdf(req.file.buffer);
            text = data.text;
        } else {
            text = req.file.buffer.toString('utf-8');
        }

        const store = new TenantRAGStore(orgId);
        await store.upsert('knowledge', jobId, text, {
            filename: req.file.originalname,
            type: 'upload',
            mimetype: req.file.mimetype,
            uploadedAt: new Date().toISOString()
        });

        // Simple chunk estimation (naive word count based)
        const chunkCount = Math.ceil(text.split(/\s+/).length / 200);

        res.json({
            message: 'Document ingested successfully',
            jobId,
            filename: req.file.originalname,
            chunks: chunkCount
        });
    } catch (error: any) {
        console.error('[Knowledge API] Upload failed:', error.message);
        res.status(500).json({ error: 'Failed to process document', details: error.message });
    }
});

export default router;
