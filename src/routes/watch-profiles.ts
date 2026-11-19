import { Router, Request, Response } from 'express';
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
const upload = multer({ storage: multer.memoryStorage() });

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
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
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

        let successCount = 0;
        for (const row of records as any[]) {
            const keywords = row.keywords ? row.keywords.split('|').map((k: string) => k.trim()) : [];
            const regions = row.regions ? row.regions.split('|').map((r: string) => r.trim()) : [];
            const min_amount = parseInt(row.min_amount) || 0;

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
