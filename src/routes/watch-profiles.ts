import { Router, Request, Response, NextFunction } from 'express';
import { queryWithOrg } from '../lib/database';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { z } from 'zod';
// @ts-ignore
import csvParse from 'csv-parse/sync';

const router = Router();

const ProfileBody = z.object({
    keywords: z.array(z.string().min(1).max(100)).max(100).optional(),
    regions: z.array(z.string().min(1).max(100)).max(100).optional(),
    min_amount: z.number().nonnegative().optional(),
});
const MAX_UPLOAD_BYTES = 1024 * 1024;
const MAX_UPLOAD_ROWS = 500;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

function acceptFile(req: Request, res: Response, next: NextFunction) {
    upload.single('file')(req, res, (err: any) => {
        if (!err) return next();
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large' });
        return res.status(400).json({ error: 'Invalid upload' });
    });
}

// Get all watch profiles
router.get('/', async (req: Request, res: Response) => {
    const orgId = (req as any).organizationId;
    if (!orgId) return res.status(400).json({ error: 'Organization ID required' });

    try {
        const result = await queryWithOrg(
            `SELECT * FROM watch_profiles WHERE org_id = $1 ORDER BY created_at DESC`,
            [orgId],
            orgId
        );
        res.json({ profiles: result.rows });
    } catch (e: any) {
        console.error('[watch-profiles] Request failed:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create a watch profile
router.post('/', async (req: Request, res: Response) => {
    const orgId = (req as any).organizationId;
    if (!orgId) return res.status(400).json({ error: 'Organization ID required' });

    const parsed = ProfileBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });
    const { keywords, regions, min_amount } = parsed.data;

    try {
        const result = await queryWithOrg(
            `INSERT INTO watch_profiles (profile_id, org_id, keywords, regions, min_amount) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [uuidv4(), orgId, JSON.stringify(keywords || []), JSON.stringify(regions || []), min_amount || 0],
            orgId
        );
        res.status(201).json({ profile: result.rows[0] });
    } catch (e: any) {
        console.error('[watch-profiles] Request failed:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// CSV Upload for Bulk Creation
router.post('/upload', acceptFile, async (req: Request, res: Response) => {
    const orgId = (req as any).organizationId;
    if (!orgId) return res.status(400).json({ error: 'Organization ID required' });

    if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });

    try {
        const fileContent = req.file.buffer.toString('utf-8');
        // Expected CSV format: keywords (pipe separated), regions (pipe separated), min_amount
        const records = csvParse.parse(fileContent, {
            columns: true,
            skip_empty_lines: true
        });

        if ((records as any[]).length > MAX_UPLOAD_ROWS) {
            return res.status(400).json({ error: `Too many rows (maximum ${MAX_UPLOAD_ROWS})` });
        }

        let successCount = 0;
        for (const row of records as any[]) {
            const parsed = ProfileBody.safeParse({
                keywords: row.keywords ? row.keywords.split('|').map((k: string) => k.trim()).filter(Boolean) : [],
                regions: row.regions ? row.regions.split('|').map((r: string) => r.trim()).filter(Boolean) : [],
                min_amount: Math.max(parseInt(row.min_amount) || 0, 0),
            });
            if (!parsed.success) continue;
            const { keywords = [], regions = [], min_amount = 0 } = parsed.data;

            if (keywords.length > 0 || regions.length > 0) {
                await queryWithOrg(
                    `INSERT INTO watch_profiles (profile_id, org_id, keywords, regions, min_amount) 
                     VALUES ($1, $2, $3, $4, $5)`,
                    [uuidv4(), orgId, JSON.stringify(keywords), JSON.stringify(regions), min_amount],
                    orgId
                );
                successCount++;
            }
        }

        res.json({ success: true, count: successCount, message: `Created ${successCount} profiles from CSV.` });
    } catch (e: any) {
        console.error('[WatchProfiles] CSV processing failed:', e);
        res.status(500).json({ error: 'CSV processing failed' });
    }
});

export default router;
