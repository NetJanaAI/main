import { Router } from 'express';
import { query } from '../lib/database';
import { TenantRequest } from '../middleware/tenant';

const router = Router();

// GET /api/capsules — List all capsule delivery logs
router.get('/', async (req: TenantRequest, res) => {
    try {
        const orgId = req.organizationId;
        const result = await query(`
            SELECT id, job_id, domain, status, delivered_at, created_at,
                   capsule->>'friction_score' as friction_score,
                   capsule->>'ceo_icebreaker_intent' as icebreaker
            FROM capsule_log
            WHERE (organization_id = $1 OR organization_id IS NULL)
            ORDER BY created_at DESC
            LIMIT 100
        `, [orgId || null]);
        res.json(result.rows);
    } catch (e: any) {
        console.error('[Capsules API] Query failed:', e.message);
        res.status(500).json({ error: 'Failed to retrieve capsule log' });
    }
});

// GET /api/capsules/:id — Get a single capsule
router.get('/:id', async (req: TenantRequest, res) => {
    try {
        const orgId = req.organizationId;
        const result = await query(
            `SELECT * FROM capsule_log WHERE id = $1 AND (organization_id = $2 OR organization_id IS NULL)`,
            [req.params.id, orgId || null]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Capsule not found' });
        res.json(result.rows[0]);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
