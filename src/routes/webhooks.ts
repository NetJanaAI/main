import express from 'express';
import { Webhook } from 'svix';
import { query } from '../lib/database';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();
const CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET || '';

router.post('/clerk', async (req, res) => {
    if (!CLERK_WEBHOOK_SECRET) {
        console.error('[Clerk Webhook] Missing CLERK_WEBHOOK_SECRET');
        return res.status(500).json({ error: 'Config error' });
    }

    const svix_id = req.headers['svix-id'] as string;
    const svix_timestamp = req.headers['svix-timestamp'] as string;
    const svix_signature = req.headers['svix-signature'] as string;

    if (!svix_id || !svix_timestamp || !svix_signature) {
        return res.status(400).json({ error: 'Missing svix headers' });
    }

    const payload = (req as any).rawBody; // Need to ensure rawBody is available
    const wh = new Webhook(CLERK_WEBHOOK_SECRET);
    let evt: any;

    try {
        evt = wh.verify(payload, {
            'svix-id': svix_id,
            'svix-timestamp': svix_timestamp,
            'svix-signature': svix_signature,
        }) as any;
    } catch (err) {
        console.error('[Clerk Webhook] Verification failed:', err);
        return res.status(400).json({ error: 'Invalid signature' });
    }

    const { type, data } = evt;

    try {
        if (type === 'user.created') {
            const { id, first_name, last_name, email_addresses } = data;
            const email = email_addresses[0]?.email_address;
            const displayName = `${first_name || ''} ${last_name || ''}`.trim() || email || id;
            
            // Generate initial API key for the user
            const rawApiKey = `sk_live_${crypto.randomBytes(24).toString('hex')}`;
            const ADMIN_SECRET = process.env.HMAC_SECRET || 'dev-safety-fallback-do-not-use-in-prod';
            const apiKeyHash = crypto.createHmac('sha256', ADMIN_SECRET).update(rawApiKey).digest('hex');

            await query(
                `INSERT INTO tenants (name, display_name, clerk_user_id, api_key_hash, quota_limit) 
                 VALUES ($1, $2, $3, $4, $5) 
                 ON CONFLICT (clerk_user_id) DO UPDATE SET display_name = $2`,
                [email || id, displayName, id, apiKeyHash, 500]
            );
            
            console.log(`[Clerk Webhook] Tenant created for User: ${id}`);
        }

        if (type === 'organization.created') {
            const { id, name, slug } = data;
            
            // Generate initial API key for the organization
            const rawApiKey = `sk_live_${crypto.randomBytes(24).toString('hex')}`;
            const ADMIN_SECRET = process.env.HMAC_SECRET || 'dev-safety-fallback-do-not-use-in-prod';
            const apiKeyHash = crypto.createHmac('sha256', ADMIN_SECRET).update(rawApiKey).digest('hex');

            await query(
                `INSERT INTO tenants (name, display_name, clerk_org_id, api_key_hash, quota_limit) 
                 VALUES ($1, $2, $3, $4, $5) 
                 ON CONFLICT (clerk_org_id) DO UPDATE SET display_name = $2`,
                [slug || id, name, id, apiKeyHash, 1000] // Orgs might get more quota
            );

            console.log(`[Clerk Webhook] Tenant created for Organization: ${id}`);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[Clerk Webhook] DB Error:', err);
        res.status(500).json({ error: 'Internal database error' });
    }
});

export default router;
