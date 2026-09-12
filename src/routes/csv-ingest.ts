import { Router, Request, Response } from 'express';
import multer from 'multer';
import { CsvIngestionService, IngestOptions } from '../core/ingest/csv-ingestion-service';
import { TenantRequest } from '../middleware/tenant';

const router = Router();
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
        let csvContent = '';
        if (req.file) {
            csvContent = req.file.buffer.toString('utf-8');
        } else if (req.body?.csvText) {
            csvContent = String(req.body.csvText);
        } else {
            return res.status(400).json({ error: 'No CSV file or csvText provided' });
        }

        let mapping: Record<string, string> = {};
        if (req.body?.mapping) {
            try {
                mapping = typeof req.body.mapping === 'string'
                    ? JSON.parse(req.body.mapping)
                    : req.body.mapping;
            } catch (_) {
                mapping = {};
            }
        }

        const type = (req.body?.type as any) || 'company';
        const indexVector = req.body?.indexVector === 'true' || req.body?.indexVector === true;
        const orgId = req.organizationId || req.headers['x-organization-id'] as string || 'default';

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
