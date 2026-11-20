import { Router, Response, Request } from 'express';
import { z } from 'zod';
import { query } from '../lib/database';
import crypto from 'crypto';
import { VanishProtocol } from '../core/rag/VanishProtocol';
import { DeadLetterQueue } from '../lib/DeadLetterQueue';
import { AuditTrail } from '../core/compliance/AuditTrail';
import { getApiKeySecret } from '../lib/secrets';
import { adminAuth } from '../middleware/adminAuth';
import { sendCraftMyFunnelLeadSignal, sendSampleCraftMyFunnelSignal } from '../core/CraftMyFunnelPusher';

const router = Router();

const TenantCreateBody = z.object({
    name: z.string().trim().min(1).max(200),
    quota_limit: z.number().int().positive().optional(),
});
const IdParam = z.string().uuid();
const IpAddBody = z.object({
    cidr: z.string().trim().min(1).max(64),
    label: z.string().max(200).optional(),
    organization_id: z.string().uuid().nullish(),
});
const CmfTestBody = z.object({
    leadId: z.string().min(1).max(128).optional(),
    campaignId: z.string().max(128).optional(),
    event: z.enum(['LEAD_CARD_READY', 'SIGNAL_INGESTED', 'INTENT_UPDATED']).optional(),
});

// P0-2 Fix: Authenticate all /api/admin/* routes before any handler runs.
// Requires Clerk session with admin role, or x-admin-secret header in standalone mode.
router.use(adminAuth);

// Set by adminAuth: the verified Clerk user id (or 'admin-secret' in standalone mode).
const adminActor = (req: Request): string => (req as any).adminActorId || 'unknown-admin';

// audit_logs rows belong to a tenant; an action with no tenant can only be logged to the server log.
async function auditAdmin(req: Request, action: string, organizationId: string | null | undefined, resource: string, metadata: object = {}) {
    if (!organizationId) {
        console.warn(`[AdminAudit] ${action} by ${adminActor(req)} on ${resource} ${JSON.stringify(metadata)}`);
        return;
    }
    await AuditTrail.log({ actorId: adminActor(req), organizationId, action, resource, metadata });
}

/**
 * POST /api/admin/tenants - Create a new tenant organization.
 */
router.post('/tenants', async (req: Request, res: Response) => {
    const parsed = TenantCreateBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Tenant name is required' });
    const { name, quota_limit } = parsed.data;

    try {
        // Generate a secure API Key
        const apiKey = `netjana_sk_${crypto.randomBytes(24).toString('hex')}`;
        const apiKeyHash = crypto.createHmac('sha256', getApiKeySecret()).update(apiKey).digest('hex');

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
            actorId: adminActor(req),
            organizationId: result.rows[0].id,
            action: 'TENANT_CREATE',
            resource: `tenant:${result.rows[0].id}`,
            metadata: { name, quota_limit }
        });
    } catch (e: any) {
        console.error('[admin] Request failed:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/admin/tenants/:id/rotate-key - Rotate a tenant's API key.
 */
router.post('/tenants/:id/rotate-key', async (req: Request, res: Response) => {
    const id = IdParam.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid tenant id' });
    try {
        const organizationId = id.data;
        const newApiKey = `netjana_sk_${crypto.randomBytes(24).toString('hex')}`;
        const apiKeyHash = crypto.createHmac('sha256', getApiKeySecret()).update(newApiKey).digest('hex');

        await query('UPDATE tenants SET api_key_hash = $1 WHERE id = $2', [apiKeyHash, organizationId]);

        res.json({
            success: true,
            message: 'API Key rotated successfully. SAVE THIS NEW KEY - IT WILL NOT BE SHOWN AGAIN.',
            apiKey: newApiKey
        });

        // Audit Log
        await AuditTrail.log({
            actorId: adminActor(req),
            organizationId,
            action: 'API_KEY_ROTATE',
            resource: `tenant:${organizationId}`,
            metadata: { reason: 'manual_rotation' }
        });
    } catch (e: any) {
        console.error('[admin] Request failed:', e);
        res.status(500).json({ error: 'Internal server error' });
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
        console.error('[admin] Request failed:', e);
        res.status(500).json({ error: 'Internal server error' });
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
        
        await auditAdmin(req, 'ADMIN_TENANT_VANISH', organizationId, `tenant:${organizationId}`, { name: orgRes.rows[0].name });
        await VanishProtocol.purge(organizationId);
        
        res.json({ message: `Vanish Protocol executed for ${orgRes.rows[0].name}. All data annihilated.` });
    } catch (e: any) {
        console.error('[admin] Request failed:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

async function dlqOrganization(id: string): Promise<string | null> {
    const found = await query('SELECT organization_id FROM dead_letter_queue WHERE id = $1', [id]);
    return found.rows[0]?.organization_id ?? null;
}

/**
 * GET /api/admin/dlq - List failed analysis signals.
 */
router.get('/dlq', async (req: Request, res: Response) => {
    try {
        const failures = await DeadLetterQueue.getAll();
        res.json(failures);
    } catch (e: any) {
        console.error('[admin] Request failed:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/admin/dlq/:id/retry - Trigger retry for a specific failed signal.
 */
router.post('/dlq/:id/retry', async (req: Request, res: Response) => {
    if (!IdParam.safeParse(req.params.id).success) return res.status(400).json({ error: 'Invalid id' });
    try {
        await auditAdmin(req, 'ADMIN_DLQ_RETRY', await dlqOrganization(req.params.id), `dlq:${req.params.id}`);
        await DeadLetterQueue.retry(req.params.id);
        res.json({ success: true, message: 'Signal re-enqueued for analysis.' });
    } catch (e: any) {
        console.error('[admin] Request failed:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * DELETE /api/admin/dlq/:id - Dismiss/Discard a failed signal.
 */
router.delete('/dlq/:id', async (req: Request, res: Response) => {
    try {
        await auditAdmin(req, 'ADMIN_DLQ_DISMISS', await dlqOrganization(req.params.id), `dlq:${req.params.id}`);
        await DeadLetterQueue.delete(req.params.id);
        res.json({ success: true, message: 'Signal dismissed from DLQ.' });
    } catch (e: any) {
        console.error('[admin] Request failed:', e);
        res.status(500).json({ error: 'Internal server error' });
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
        console.error('[admin] Request failed:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/admin/security/ips - Add allowed ingress IP/CIDR.
 */
router.post('/security/ips', async (req: Request, res: Response) => {
    const parsed = IpAddBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'CIDR is required' });
    const { cidr, label, organization_id } = parsed.data;

    try {
        const result = await query(
            'INSERT INTO allowed_ips (cidr, label, organization_id) VALUES ($1, $2, $3) RETURNING id, cidr, label',
            [cidr, label, organization_id || null]
        );
        res.json(result.rows[0]);

        // Audit Log
        await AuditTrail.log({
            actorId: adminActor(req),
            organizationId: organization_id || '00000000-0000-0000-0000-000000000000', // System-level
            action: 'IP_ALLOWLIST_ADD',
            resource: `ip:${cidr}`,
            metadata: { label }
        });
    } catch (e: any) {
        console.error('[admin] Request failed:', e);
        res.status(500).json({ error: 'Internal server error' });
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
            actorId: adminActor(req),
            organizationId: checkRes.rows[0].organization_id || '00000000-0000-0000-0000-000000000000',
            action: 'IP_ALLOWLIST_REMOVE',
            resource: `ip:${checkRes.rows[0].cidr}`,
            metadata: { id }
        });
    } catch (e: any) {
        console.error('[admin] Request failed:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

function maskSensitiveMetadata(obj: any): any {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(maskSensitiveMetadata);
    
    const sensitiveKeys = new Set([
        'email', 'ip', 'token', 'key', 'apikey', 'password', 'secret', 
        'cidr', 'rawtext', 'pii', 'api_key', 'hmac_secret', 'secretkey'
    ]);
    const masked: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
        const keyLower = k.toLowerCase();
        const isSensitive = sensitiveKeys.has(keyLower) || 
                            keyLower.includes('secret') || 
                            keyLower.includes('key') || 
                            keyLower.includes('token') ||
                            keyLower.includes('email');
        if (isSensitive) {
            masked[k] = '[MASKED]';
        } else if (typeof v === 'object') {
            masked[k] = maskSensitiveMetadata(v);
        } else {
            masked[k] = v;
        }
    }
    return masked;
}

/**
 * GET /api/admin/security/audit - List Recent Security Events.
 * SEC-06: Paginated & masked for non-super-admins.
 */
router.get('/security/audit', async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string || '50'), 200);
    const offset = parseInt(req.query.offset as string || '0');
    const adminRole = (req as any).adminRole;

    try {
        const countRes = await query('SELECT COUNT(*) FROM audit_logs');
        const total = parseInt(countRes.rows[0].count, 10);

        const result = await query(`
            SELECT a.*, t.name as organization_name 
            FROM audit_logs a
            LEFT JOIN tenants t ON a.organization_id = t.id
            ORDER BY a.timestamp DESC 
            LIMIT $1 OFFSET $2
        `, [limit, offset]);

        let logs = result.rows;
        if (adminRole !== 'super_admin') {
            logs = logs.map(row => {
                const updated = { ...row };
                if (updated.metadata) {
                    updated.metadata = maskSensitiveMetadata(updated.metadata);
                }
                // Mask actor IP address if present in row level details
                if (updated.actor_ip) updated.actor_ip = '[MASKED]';
                return updated;
            });
        }

        res.json({
            logs,
            total,
            limit,
            offset
        });
    } catch (e: any) {
        console.error('[admin] Request failed:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/admin/integrations/craftmyfunnel/test
 * Sends either a synthetic sample signal or an existing lead card to CraftMyFunnel.
 */
router.post('/integrations/craftmyfunnel/test', async (req: Request, res: Response) => {
    const parsed = CmfTestBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });
    const { leadId, campaignId, event } = parsed.data;

    try {
        if (!leadId) {
            const result = await sendSampleCraftMyFunnelSignal({ org_id: (req as any).organizationId });
            return res.json(result);
        }

        const leadRes = await query('SELECT * FROM lead_cards WHERE lead_id = $1', [leadId]);
        if (leadRes.rows.length === 0) {
            return res.status(404).json({ error: 'Lead not found' });
        }

        const result = await sendCraftMyFunnelLeadSignal(leadRes.rows[0], {
            campaignId,
            event,
            triggeredBy: 'manual',
        });
        return res.json(result);
    } catch (e: any) {
        return res.status(502).json({ ok: false, error: e.message });
    }
});

export default router;
