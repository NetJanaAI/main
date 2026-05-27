import { Router } from 'express';
import { query } from '../lib/database';
import { addSchedule, removeSchedule, listSchedules } from '../lib/scheduler';
import { TenantRequest } from '../middleware/tenant';

const router = Router();

// GET /api/schedules — List all active schedules
router.get('/', async (req: TenantRequest, res) => {
    try {
        const orgId = req.organizationId;
        const result = await query(`
            SELECT id, domain, cron_expression, use_online_ai, spider_mode, max_pages, organization_id, created_at, last_run
            FROM scrape_schedules
            WHERE (organization_id = $1 OR organization_id IS NULL)
            ORDER BY created_at DESC
        `, [orgId || null]);
        res.json(result.rows);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/schedules — Add a new schedule
router.post('/', async (req: TenantRequest, res) => {
    const { domain, cron_expression, use_online_ai, spider_mode, max_pages } = req.body;
    const orgId = req.organizationId;
    if (!domain || !cron_expression) {
        return res.status(400).json({ error: 'domain and cron_expression are required' });
    }

    try {
        const result = await query(`
            INSERT INTO scrape_schedules (domain, cron_expression, use_online_ai, spider_mode, max_pages, organization_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (organization_id, domain) DO UPDATE
            SET cron_expression = $2, use_online_ai = $3, spider_mode = $4, max_pages = $5, organization_id = $6
            RETURNING *
        `, [domain, cron_expression, use_online_ai || false, spider_mode || false, max_pages || 5, orgId || null]);

        const schedule = result.rows[0];
        addSchedule(schedule); // Register in the in-memory scheduler
        res.json(schedule);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/schedules/:id — Remove a schedule
router.delete('/:id', async (req: TenantRequest, res) => {
    const { id } = req.params;
    const orgId = req.organizationId;
    try {
        const result = await query(`
            DELETE FROM scrape_schedules 
            WHERE id = $1 AND (organization_id = $2 OR organization_id IS NULL)
            RETURNING domain
        `, [id, orgId || null]);
        if (!result.rows.length) return res.status(404).json({ error: 'Schedule not found' });
        removeSchedule(result.rows[0].domain);
        res.json({ message: `Schedule for ${result.rows[0].domain} removed.` });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
