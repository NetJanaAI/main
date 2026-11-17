import { Router, Response } from 'express';
import { z } from 'zod';
import { db } from '../lib/database';
import { cache } from '../lib/cache';

import { requireTenant } from '../middleware/tenant';

const router = Router();
router.use(requireTenant);
const ToggleBody = z.object({ sourceId: z.string().min(1).max(64), enabled: z.boolean() });
const DEFAULT_SOURCES = ['indiamart', 'gem', 'mca', 'zauba', 'webscrape', 'funding', 'naukri', 'rera', 'parivesh'];

/**
 * GET /api/sources
 * Returns all source configurations for the organization.
 */
router.get('/', async (req: any, res: Response) => {
    const orgId = req.organizationId as string;
    try {
        const results = await db.queryWithOrg(
            `SELECT source_id, is_enabled FROM source_configs WHERE org_id = $1`,
            [orgId],
            orgId
        );
        if (results.rows.length === 0) {
            return res.json(DEFAULT_SOURCES.map(source_id => ({ source_id, is_enabled: true })));
        }
        res.json(results.rows);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/sources/toggle
 * Toggles a source enablement status.
 */
router.post('/toggle', async (req: any, res: Response) => {
    const orgId = req.organizationId as string;
    const parsed = ToggleBody.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'sourceId and enabled are required' });
    }
    const { sourceId, enabled } = parsed.data;

    try {
        await db.queryWithOrg(
            `INSERT INTO source_configs (org_id, source_id, is_enabled)
             VALUES ($1, $2, $3)
             ON CONFLICT (org_id, source_id)
             DO UPDATE SET is_enabled = EXCLUDED.is_enabled, updated_at = NOW()`,
            [orgId, sourceId, enabled],
            orgId
        );

        // Invalidate cache for this org's source settings
        await cache.del(`sources:${orgId}`);

        res.json({ success: true, sourceId, enabled });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
