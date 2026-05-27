import { Router, Request, Response } from 'express';
import { query } from '../lib/database';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
// @ts-ignore
import csvParse from 'csv-parse/sync';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Get all watch profiles
router.get('/', async (req: Request, res: Response) => {
    const orgId = (req as any).organizationId;
    if (!orgId) return res.status(400).json({ error: 'Organization ID required' });

    try {
        const result = await query(`SELECT * FROM watch_profiles WHERE org_id = $1 ORDER BY created_at DESC`, [orgId]);
        res.json({ profiles: result.rows });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Create a watch profile
router.post('/', async (req: Request, res: Response) => {
    const orgId = (req as any).organizationId;
    if (!orgId) return res.status(400).json({ error: 'Organization ID required' });

    const { keywords, regions, min_amount } = req.body;
    
    try {
        const result = await query(
            `INSERT INTO watch_profiles (profile_id, org_id, keywords, regions, min_amount) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [uuidv4(), orgId, JSON.stringify(keywords || []), JSON.stringify(regions || []), min_amount || 0]
        );
        res.status(201).json({ profile: result.rows[0] });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
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
                await query(
                    `INSERT INTO watch_profiles (profile_id, org_id, keywords, regions, min_amount) 
                     VALUES ($1, $2, $3, $4, $5)`,
                    [uuidv4(), orgId, JSON.stringify(keywords), JSON.stringify(regions), min_amount]
                );
                successCount++;
            }
        }

        res.json({ success: true, count: successCount, message: `Created ${successCount} profiles from CSV.` });
    } catch (e: any) {
        res.status(500).json({ error: `CSV Processing Error: ${e.message}` });
    }
});

export default router;
