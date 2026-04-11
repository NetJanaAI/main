import { Router, Response, Request } from 'express';
import { query } from '../lib/database';
import crypto from 'crypto';
import { VanishProtocol } from '../core/rag/VanishProtocol';

const router = Router();
const ADMIN_SECRET = process.env.HMAC_SECRET || 'dev-safety-fallback-do-not-use-in-prod';

/**
 * POST /api/admin/tenants - Create a new tenant organization.
 */
router.post('/tenants', async (req: Request, res: Response) => {
    const { name, quota_limit } = req.body;
    if (!name) return res.status(400).json({ error: 'Tenant name is required' });

    try {
        // Generate a secure API Key
        const apiKey = `netjana_sk_${crypto.randomBytes(24).toString('hex')}`;
        const apiKeyHash = crypto.createHmac('sha256', ADMIN_SECRET).update(apiKey).digest('hex');

        const result = await query(
            'INSERT INTO tenants (name, api_key_hash, quota_limit) VALUES ($1, $2, $3) RETURNING id, name, quota_limit',
            [name, apiKeyHash, quota_limit || 100]
        );

        res.json({
            message: 'Tenant created successfully. SAVE THIS API KEY - IT WILL NOT BE SHOWN AGAIN.',
            tenant: result.rows[0],
            apiKey: apiKey
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/admin/tenants - List all tenants and their current usage quotas.
 */
router.get('/tenants', async (req: Request, res: Response) => {
    try {
        const result = await query(`
            SELECT t.id, t.name, t.quota_limit, t.created_at,
                   (SELECT COUNT(*) FROM scrape_results WHERE organization_id = t.id) as current_usage
            FROM tenants t
            ORDER BY t.created_at DESC
        `);
        res.json(result.rows);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * DELETE /api/admin/tenants/:id/vanish - Execute GDPR hard purge of tenant data.
 */
router.delete('/tenants/:id/vanish', async (req: Request, res: Response) => {
    try {
        const organizationId = req.params.id;
        
        // Ensure tenant exists
        const orgRes = await query('SELECT name FROM tenants WHERE id = $1', [organizationId]);
        if (orgRes.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });
        
        await VanishProtocol.purge(organizationId);
        
        res.json({ message: `Vanish Protocol executed for ${orgRes.rows[0].name}. All data annihilated.` });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
