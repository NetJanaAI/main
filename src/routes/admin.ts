import { Router, Response, Request } from 'express';
import { query } from '../lib/database';
import crypto from 'crypto';
import { VanishProtocol } from '../core/rag/VanishProtocol';
import { DeadLetterQueue } from '../lib/DeadLetterQueue';
import { AuditTrail } from '../core/compliance/AuditTrail';
import { getHmacSecret } from '../lib/secrets';

const router = Router();

/**
 * POST /api/admin/tenants - Create a new tenant organization.
 */
router.post('/tenants', async (req: Request, res: Response) => {
    const { name, quota_limit } = req.body;
    if (!name) return res.status(400).json({ error: 'Tenant name is required' });

    try {
        // Generate a secure API Key
        const apiKey = `netjana_sk_${crypto.randomBytes(24).toString('hex')}`;
        const apiKeyHash = crypto.createHmac('sha256', getHmacSecret('tenant API key hashing')).update(apiKey).digest('hex');

        const result = await query(
            'INSERT INTO tenants (name, api_key_hash, quota_limit) VALUES ($1, $2, $3) RETURNING id, name, quota_limit',
            [name, apiKeyHash, quota_limit || 100]
        );

        res.json({
            message: 'Tenant created successfully. SAVE THIS API KEY - IT WILL NOT BE SHOWN AGAIN.',
            tenant: result.rows[0],
            apiKey: apiKey
        });

        // Audit Log
        await AuditTrail.log({
            actorId: (req as any).auth?.userId || 'system',
            organizationId: result.rows[0].id,
            action: 'TENANT_CREATE',
            resource: `tenant:${result.rows[0].id}`,
            metadata: { name, quota_limit }
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/admin/tenants/:id/rotate-key - Rotate a tenant's API key.
 */
router.post('/tenants/:id/rotate-key', async (req: Request, res: Response) => {
    try {
        const organizationId = req.params.id;
        const newApiKey = `netjana_sk_${crypto.randomBytes(24).toString('hex')}`;
        const apiKeyHash = crypto.createHmac('sha256', getHmacSecret('tenant API key rotation')).update(newApiKey).digest('hex');

        await query('UPDATE tenants SET api_key_hash = $1 WHERE id = $2', [apiKeyHash, organizationId]);

        res.json({
            success: true,
            message: 'API Key rotated successfully. SAVE THIS NEW KEY - IT WILL NOT BE SHOWN AGAIN.',
            apiKey: newApiKey
        });

        // Audit Log
        await AuditTrail.log({
            actorId: (req as any).auth?.userId || 'system',
            organizationId,
            action: 'API_KEY_ROTATE',
            resource: `tenant:${organizationId}`,
            metadata: { reason: 'manual_rotation' }
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

/**
 * GET /api/admin/dlq - List failed analysis signals.
 */
router.get('/dlq', async (req: Request, res: Response) => {
    try {
        const failures = await DeadLetterQueue.getAll();
        res.json(failures);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/admin/dlq/:id/retry - Trigger retry for a specific failed signal.
 */
router.post('/dlq/:id/retry', async (req: Request, res: Response) => {
    try {
        await DeadLetterQueue.retry(req.params.id);
        res.json({ success: true, message: 'Signal re-enqueued for analysis.' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * DELETE /api/admin/dlq/:id - Dismiss/Discard a failed signal.
 */
router.delete('/dlq/:id', async (req: Request, res: Response) => {
    try {
        await DeadLetterQueue.delete(req.params.id);
        res.json({ success: true, message: 'Signal dismissed from DLQ.' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/admin/security/ips - List allowed ingress IPs.
 */
router.get('/security/ips', async (req: Request, res: Response) => {
    try {
        const result = await query('SELECT * FROM allowed_ips ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /api/admin/security/ips - Add allowed ingress IP/CIDR.
 */
router.post('/security/ips', async (req: Request, res: Response) => {
    const { cidr, label, organization_id } = req.body;
    if (!cidr) return res.status(400).json({ error: 'CIDR is required' });

    try {
        const result = await query(
            'INSERT INTO allowed_ips (cidr, label, organization_id) VALUES ($1, $2, $3) RETURNING id, cidr, label',
            [cidr, label, organization_id || null]
        );
        res.json(result.rows[0]);

        // Audit Log
        await AuditTrail.log({
            actorId: (req as any).auth?.userId || 'system',
            organizationId: organization_id || '00000000-0000-0000-0000-000000000000', // System-level
            action: 'IP_ALLOWLIST_ADD',
            resource: `ip:${cidr}`,
            metadata: { label }
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * DELETE /api/admin/security/ips/:id - Remove IP/CIDR from allowlist.
 */
router.delete('/security/ips/:id', async (req: Request, res: Response) => {
    try {
        const id = req.params.id;
        const checkRes = await query('SELECT cidr, organization_id FROM allowed_ips WHERE id = $1', [id]);
        if (checkRes.rows.length === 0) return res.status(404).json({ error: 'Entry not found' });

        await query('DELETE FROM allowed_ips WHERE id = $1', [id]);
        res.json({ success: true });

        // Audit Log
        await AuditTrail.log({
            actorId: (req as any).auth?.userId || 'system',
            organizationId: checkRes.rows[0].organization_id || '00000000-0000-0000-0000-000000000000',
            action: 'IP_ALLOWLIST_REMOVE',
            resource: `ip:${checkRes.rows[0].cidr}`,
            metadata: { id }
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/admin/security/audit - List Recent Security Events.
 */
router.get('/security/audit', async (req: Request, res: Response) => {
    try {
        const result = await query(`
            SELECT a.*, t.name as organization_name 
            FROM audit_logs a
            LEFT JOIN tenants t ON a.organization_id = t.id
            ORDER BY a.timestamp DESC 
            LIMIT 100
        `);
        res.json(result.rows);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
