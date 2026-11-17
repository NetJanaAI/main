import express from 'express';
import { z } from 'zod';
import { Webhook } from 'svix';
import { query, withSystemTransaction } from '../lib/database';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { createClerkClient } from '@clerk/backend';
import { getHmacSecret, getApiKeySecret } from '../lib/secrets';
import { RazorpayService } from '../standalone/services/RazorpayService';

const router = express.Router();

const ClerkEvent = z.object({ type: z.string(), data: z.record(z.string(), z.unknown()) });
const RazorpayEvent = z.object({
    event: z.string().optional(),
    created_at: z.number().optional(),
    payload: z.object({
        subscription: z.object({
            entity: z.object({ id: z.string(), status: z.string() }).partial().optional(),
        }).optional(),
    }).optional(),
});
const CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET || '';
const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

// Offboarding only switches the tenant off. Erasing data is a deliberate admin action (VanishProtocol.purge).
// The IS NULL guard keeps the first timestamp when Clerk redelivers an event.
async function deactivateTenant(column: 'clerk_user_id' | 'clerk_org_id', clerkId: unknown) {
    if (typeof clerkId !== 'string' || !clerkId) return;
    const result = await query(
        `UPDATE tenants SET deactivated_at = NOW() WHERE ${column} = $1 AND deactivated_at IS NULL`,
        [clerkId]
    );
    if (result.rowCount) console.log(`[Clerk Webhook] Tenant deactivated for ${column}=${clerkId}`);
}

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

    const clerkEvent = ClerkEvent.safeParse(evt);
    if (!clerkEvent.success) return res.status(400).json({ error: 'Invalid payload' });
    const { type } = clerkEvent.data;
    const data: any = clerkEvent.data.data;

    try {
        if (type === 'user.created') {
            const { id, first_name, last_name, email_addresses } = data;
            const email = email_addresses[0]?.email_address;
            const displayName = `${first_name || ''} ${last_name || ''}`.trim() || email || id;
            
            // Generate initial API key for the user
            const rawApiKey = `sk_live_${crypto.randomBytes(24).toString('hex')}`;
            const ADMIN_SECRET = getApiKeySecret();
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
            const ADMIN_SECRET = getApiKeySecret();
            const apiKeyHash = crypto.createHmac('sha256', ADMIN_SECRET).update(rawApiKey).digest('hex');

            await query(
                `INSERT INTO tenants (name, display_name, clerk_org_id, api_key_hash, quota_limit) 
                 VALUES ($1, $2, $3, $4, $5) 
                 ON CONFLICT (clerk_org_id) DO UPDATE SET display_name = $2`,
                [slug || id, name, id, apiKeyHash, 1000] // Orgs might get more quota
            );

            console.log(`[Clerk Webhook] Tenant created for Organization: ${id}`);
        }

        if (type === 'user.deleted') {
            await deactivateTenant('clerk_user_id', data?.id);
        }

        if (type === 'organization.deleted') {
            await deactivateTenant('clerk_org_id', data?.id);
        }

        if (type === 'organizationMembership.deleted') {
            // One member leaving must not lock the others out: deactivate only when nobody is left.
            const organizationId = data?.organization?.id;
            if (typeof organizationId === 'string' && organizationId) {
                const members = await clerkClient.organizations.getOrganizationMembershipList({ organizationId, limit: 1 });
                if (members.totalCount === 0) await deactivateTenant('clerk_org_id', organizationId);
            }
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[Clerk Webhook] DB Error:', err);
        res.status(500).json({ error: 'Internal database error' });
    }
});

const RAZORPAY_STATUSES = new Set([
    'created', 'authenticated', 'active', 'pending', 'halted', 'cancelled', 'completed', 'expired', 'paused',
]);

// The tenant plan a subscription status implies. Transitional states leave the plan as it was.
const PLAN_FOR_STATUS: Record<string, 'paid' | 'free' | undefined> = {
    active: 'paid',
    halted: 'free',
    cancelled: 'free',
    completed: 'free',
    expired: 'free',
};

// Razorpay subscription lifecycle events. Delivery is at least once and can be out of order, so the
// event id is recorded in the same transaction as its effect (a failed update is retried, a repeat is
// a no-op) and an event older than the one already applied is ignored. The status stored is the one
// Razorpay reports, and the tenant is found by the subscription id we stored at signup, never by notes.
router.post('/razorpay', async (req, res) => {
    if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
        console.error('[Razorpay Webhook] Missing RAZORPAY_WEBHOOK_SECRET');
        return res.status(500).json({ error: 'Config error' });
    }
    const raw: Buffer | string = (req as any).rawBody;
    const signature = req.headers['x-razorpay-signature'] as string | undefined;
    if (!raw || !RazorpayService.verifyWebhook(raw, signature)) {
        return res.status(400).json({ error: 'Invalid signature' });
    }

    let evt: any;
    try {
        const parsedEvent = RazorpayEvent.safeParse(JSON.parse(raw.toString()));
        if (!parsedEvent.success) return res.status(400).json({ error: 'Invalid payload' });
        evt = parsedEvent.data;
    } catch {
        return res.status(400).json({ error: 'Invalid payload' });
    }

    const eventId = req.headers['x-razorpay-event-id'];
    if (typeof eventId !== 'string' || !eventId) {
        return res.status(400).json({ error: 'Missing event id' });
    }

    const entity = evt?.payload?.subscription?.entity;
    if (typeof evt?.event !== 'string' || !evt.event.startsWith('subscription.') || !entity?.id) {
        return res.json({ success: true, ignored: true });
    }
    if (!RAZORPAY_STATUSES.has(entity.status)) {
        console.warn(`[Razorpay Webhook] Ignoring unexpected status for ${entity.id}`);
        return res.json({ success: true, ignored: true });
    }

    const eventAt = Number.isFinite(evt.created_at) ? evt.created_at : Math.floor(Date.now() / 1000);
    try {
        let duplicate = false;
        await withSystemTransaction(async (client) => {
            const recorded = await client.query(
                'INSERT INTO razorpay_events (event_id, event_type) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING RETURNING event_id',
                [eventId, evt.event]
            );
            if (recorded.rows.length === 0) {
                duplicate = true;
                return;
            }
            const result = await client.query(
                `UPDATE tenants
                    SET razorpay_subscription_status = $1,
                        plan = CASE WHEN $2::text IS NOT NULL AND plan IN ('free', 'paid') THEN $2::text ELSE plan END,
                        razorpay_status_at = to_timestamp($3)
                  WHERE razorpay_subscription_id = $4
                    AND (razorpay_status_at IS NULL OR razorpay_status_at <= to_timestamp($3))
                RETURNING id`,
                [entity.status, PLAN_FOR_STATUS[entity.status] ?? null, eventAt, entity.id]
            );
            if (result.rows.length === 0) console.warn(`[Razorpay Webhook] No tenant, or a newer event already applied, for subscription ${entity.id}`);
        });
        res.json(duplicate ? { success: true, duplicate: true } : { success: true });
    } catch (err) {
        console.error('[Razorpay Webhook] DB Error:', err);
        res.status(500).json({ error: 'Internal database error' });
    }
});

export default router;
