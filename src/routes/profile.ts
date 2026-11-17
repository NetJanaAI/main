import express from 'express';
import { z } from 'zod';
import { query } from '../lib/database';
import { cache } from '../lib/cache';
import crypto from 'crypto';
import { getHmacSecret, getApiKeySecret } from '../lib/secrets';

const router = express.Router();

// Key regeneration takes no input; a body is rejected rather than silently ignored.
const NoBody = z.object({}).strict();

router.get('/credits', async (req: any, res) => {
    const orgId = req.organizationId;
    if (!orgId) return res.status(401).json({ error: 'Auth required' });

    try {
        const tenantRes = await query('SELECT quota_limit, plan FROM tenants WHERE id = $1', [orgId]);
        if (tenantRes.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });

        const dateStr = new Date().toISOString().split('T')[0];
        const spendKey = `gemini_calls:${dateStr}`;
        // This is a global spend key currently in the project. 
        // In a real multi-tenant setting, we'd want per-tenant spend keys.
        // For now, let's use the global one or a tenant-specific one if we want to be accurate.
        const tenantSpendKey = `gemini_calls:${orgId}:${dateStr}`;
        
        const countStr = await cache.get<string>(tenantSpendKey);
        const used = countStr ? parseInt(countStr, 10) : 0;

        res.json({
            used,
            limit: tenantRes.rows[0].quota_limit,
            plan: tenantRes.rows[0].plan
        });
    } catch (err) {
        res.status(500).json({ error: 'Internal error' });
    }
});

router.post('/regenerate-key', async (req: any, res) => {
    const orgId = req.organizationId;
    if (!orgId) return res.status(401).json({ error: 'Auth required' });
    if (!NoBody.safeParse(req.body ?? {}).success) return res.status(400).json({ error: 'Invalid payload' });

    try {
        const rawApiKey = `sk_live_${crypto.randomBytes(24).toString('hex')}`;
        const ADMIN_SECRET = getApiKeySecret();
        const apiKeyHash = crypto.createHmac('sha256', ADMIN_SECRET).update(rawApiKey).digest('hex');

        await query('UPDATE tenants SET api_key_hash = $1 WHERE id = $2', [apiKeyHash, orgId]);

        res.json({ apiKey: rawApiKey });
    } catch (err) {
        res.status(500).json({ error: 'Internal error' });
    }
});

export default router;
