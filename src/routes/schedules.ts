import { Router } from 'express';
import { z } from 'zod';
import * as cron from 'node-cron';
import { query } from '../lib/database';
import { addSchedule, removeSchedule, listSchedules } from '../lib/scheduler';
import { TenantRequest } from '../middleware/tenant';

const router = Router();

const ScheduleBody = z.object({
    domain: z.string().trim().min(1).max(253),
    cron_expression: z.string().trim().min(1).max(100),
    use_online_ai: z.boolean().optional(),
    spider_mode: z.boolean().optional(),
    max_pages: z.number().int().min(1).max(100).optional(),
});

// GET /api/schedules — List all active schedules
router.get('/', async (req: TenantRequest, res) => {
    try {
        const orgId = req.organizationId;
        if (!orgId) return res.status(401).json({ error: 'Unauthorized' });
        const result = await query(`
            SELECT id, domain, cron_expression, use_online_ai, spider_mode, max_pages, organization_id, created_at, last_run
            FROM scrape_schedules
            WHERE organization_id = $1
            ORDER BY created_at DESC
        `, [orgId]);
        res.json(result.rows);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/schedules — Add a new schedule
router.post('/', async (req: TenantRequest, res) => {
    const orgId = req.organizationId;
    if (!orgId) return res.status(401).json({ error: 'Unauthorized' });
    const parsed = ScheduleBody.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'domain and cron_expression are required' });
    }
    const { domain, cron_expression, use_online_ai, spider_mode, max_pages } = parsed.data;
    if (!cron.validate(cron_expression)) return res.status(400).json({ error: 'Invalid cron expression' });

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
    if (!orgId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const result = await query(`
            DELETE FROM scrape_schedules 
            WHERE id = $1 AND organization_id = $2
            RETURNING domain
        `, [id, orgId]);
        if (!result.rows.length) return res.status(404).json({ error: 'Schedule not found' });
        removeSchedule(id);
        res.json({ message: `Schedule for ${result.rows[0].domain} removed.` });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
