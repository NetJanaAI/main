import { Router, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { CsvIngestionService, IngestOptions } from '../core/ingest/csv-ingestion-service';
import { TenantRequest, requireTenant } from '../middleware/tenant';

const router = Router();

// Multipart fields arrive as strings, JSON bodies as typed values.
const ProcessFields = z.object({
    csvText: z.string().optional(),
    type: z.enum(['company', 'employee', 'unified']).optional(),
    indexVector: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
});
const MappingSchema = z.record(z.string(), z.string());
router.use(requireTenant);
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 } // 15MB max
});

/**
 * POST /api/v1/ingest/csv/preview
 * Analyzes uploaded CSV, detects column headers, sample rows, and suggested field mappings.
 */
router.post('/preview', upload.single('file'), async (req: TenantRequest, res: Response) => {
    try {
        let csvContent = '';
        if (req.file) {
            csvContent = req.file.buffer.toString('utf-8');
        } else if (req.body?.csvText) {
            csvContent = String(req.body.csvText);
        } else {
            return res.status(400).json({ error: 'No CSV file or csvText provided' });
        }

        const preview = CsvIngestionService.previewCsv(csvContent);
        return res.json({
            ok: true,
            data: preview
        });
    } catch (err: any) {
        console.error('[CSV Ingest Preview] Error:', err.message);
        return res.status(400).json({
            ok: false,
            error: err.message || 'Failed to parse CSV file'
        });
    }
});

/**
 * POST /api/v1/ingest/csv/process
 * Ingests and persists company / employee rows into database.
 */
router.post('/process', upload.single('file'), async (req: TenantRequest, res: Response) => {
    try {
        const fields = ProcessFields.safeParse(req.body ?? {});
        if (!fields.success) return res.status(400).json({ error: 'Invalid payload' });
        let csvContent = '';
        if (req.file) {
            csvContent = req.file.buffer.toString('utf-8');
        } else if (fields.data.csvText) {
            csvContent = fields.data.csvText;
        } else {
            return res.status(400).json({ error: 'No CSV file or csvText provided' });
        }

        let mapping: Record<string, string> = {};
        if (req.body?.mapping) {
            try {
                const raw = typeof req.body.mapping === 'string' ? JSON.parse(req.body.mapping) : req.body.mapping;
                mapping = MappingSchema.parse(raw);
            } catch (_) {
                mapping = {};
            }
        }

        const type = fields.data.type ?? 'company';
        const indexVector = fields.data.indexVector === 'true' || fields.data.indexVector === true;
        const orgId = req.organizationId as string;

        const options: IngestOptions = {
            type,
            mapping,
            indexVector,
            orgId
        };

        const report = await CsvIngestionService.ingestCsv(csvContent, options);

        return res.json({
            ok: true,
            data: report
        });
    } catch (err: any) {
        console.error('[CSV Ingest Process] Error:', err.message);
        return res.status(500).json({
            ok: false,
            error: err.message || 'Failed to process CSV file'
        });
    }
});

/**
 * GET /api/v1/ingest/csv/template/:type
 * Downloads sample CSV template.
 */
router.get('/template/:type', (req: Request, res: Response) => {
    const rawType = req.params.type.toLowerCase();
    const type = (rawType === 'employee' || rawType === 'unified') ? rawType : 'company';
    const csvData = CsvIngestionService.getSampleCsvTemplate(type);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="netjana_sample_${type}_template.csv"`);
    return res.send(csvData);
});

export default router;
