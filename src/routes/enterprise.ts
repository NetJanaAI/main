import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { query, queryWithOrg, withOrgTransaction } from '../lib/database';
import { RazorpayService } from '../standalone/services/RazorpayService';

const router = Router();

const FREE_SEATS = 3;
const EXTRA_SEAT_INR = 500;

const addSeatSchema = z.object({
    userEmail: z.string().email(),
    userName: z.string().min(1).max(200),
    organizationId: z.string().optional(),
});

class SeatError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}

/**
 * Enterprise Seat Management API
 * POST /api/enterprise/seats/add
 */
router.post('/seats/add', async (req: any, res) => {
    // The tenant comes from the authenticated session or API key, never from the body.
    const organizationId = req.organizationId;
    if (!organizationId) return res.status(401).json({ error: 'Unauthorized' });
    if (req.body?.organizationId && req.body.organizationId !== organizationId) {
        return res.status(403).json({ error: 'Unauthorized: Cannot manage seats for other organizations.' });
    }
    // Inside a Clerk organization only its admins add seats (a seat can be billed).
    const orgRole = req.auth?.org_role;
    if (orgRole && orgRole !== 'org:admin' && orgRole !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: Organization admin role required to add seats.' });
    }
    const parsed = addSeatSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid seat details' });
    const { userEmail, userName } = parsed.data;

    const seatId = `seat_${crypto.randomUUID()}`;
    try {
        // One transaction: if billing a paid seat fails, the seat is rolled back instead of
        // being left active and unbilled. The tenant row lock serialises concurrent adds so two
        // requests cannot both see "3 seats" and skip billing.
        await withOrgTransaction(organizationId, async (client) => {
            const tenant = await client.query(
                'SELECT razorpay_subscription_id, razorpay_subscription_status FROM tenants WHERE id = $1 FOR UPDATE',
                [organizationId]
            );
            // Only an active subscription can be billed; created/halted/cancelled ones cannot.
            const row = tenant.rows[0];
            const subscriptionId: string | null =
                row?.razorpay_subscription_status === 'active' ? (row.razorpay_subscription_id ?? null) : null;

            const inserted = await client.query(
                `INSERT INTO organization_seats (id, organization_id, email, name, status)
                 VALUES ($1, $2, $3, $4, 'active')
                 ON CONFLICT (organization_id, email) DO NOTHING
                 RETURNING id`,
                [seatId, organizationId, userEmail, userName]
            );
            if (inserted.rows.length === 0) throw new SeatError(409, 'A seat for this email already exists.');

            const countRes = await client.query(
                'SELECT COUNT(*) FROM organization_seats WHERE organization_id = $1',
                [organizationId]
            );
            if (parseInt(countRes.rows[0].count, 10) <= FREE_SEATS) return;

            if (!subscriptionId) {
                throw new SeatError(402, 'Seats beyond the free quota need an active subscription. Start one at POST /api/enterprise/billing/subscribe.');
            }
            try {
                await RazorpayService.billExtraUsage(subscriptionId, EXTRA_SEAT_INR, `Extra Seat: ${userEmail}`);
            } catch (billingError: any) {
                console.error(`[Seats] Billing failed for org=${organizationId}: ${billingError.message}`);
                throw new SeatError(502, 'Billing failed; the seat was not added.');
            }
        });
        res.json({ message: 'Seat added successfully', seatId });
    } catch (e: any) {
        if (e instanceof SeatError) return res.status(e.status).json({ error: e.message });
        console.error(`[Seats] Add failed for org=${organizationId}: ${e.message}`);
        res.status(500).json({ error: 'Failed to add seat' });
    }
});

/**
 * GET /api/enterprise/seats
 */
router.get('/seats', async (req: any, res) => {
    const orgId = req.organizationId;
    if (!orgId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const result = await queryWithOrg(
            'SELECT id, email, name, status, created_at FROM organization_seats WHERE organization_id = $1',
            [orgId],
            orgId
        );
        res.json(result.rows);
    } catch (e: any) {
        console.error(`[Seats] List failed for org=${orgId}: ${e.message}`);
        res.status(500).json({ error: 'Failed to list seats' });
    }
});

function isOrgAdmin(req: any): boolean {
    const orgRole = req.auth?.org_role;
    return !orgRole || orgRole === 'org:admin' || orgRole === 'admin';
}

/**
 * POST /api/enterprise/billing/subscribe
 * Starts a Razorpay subscription for the caller's tenant. The returned authorizationUrl is where
 * the customer pays; the tenant becomes billable once Razorpay's signed webhook reports it active.
 */
router.post('/billing/subscribe', async (req: any, res) => {
    const organizationId = req.organizationId;
    if (!organizationId) return res.status(401).json({ error: 'Unauthorized' });
    if (!isOrgAdmin(req)) return res.status(403).json({ error: 'Forbidden: Organization admin role required.' });
    const planId = process.env.RAZORPAY_PLAN_ID;
    if (!planId) return res.status(503).json({ error: 'Billing is not configured.' });

    try {
        const current = await query(
            'SELECT razorpay_subscription_status FROM tenants WHERE id = $1',
            [organizationId]
        );
        const status = current.rows[0]?.razorpay_subscription_status;
        if (status === 'active' || status === 'authenticated') {
            return res.status(409).json({ error: 'A subscription is already in place.', status });
        }

        let subscription: any;
        try {
            subscription = await RazorpayService.createSubscription(planId, { organizationId });
        } catch (billingError: any) {
            console.error(`[Billing] Subscription create failed for org=${organizationId}: ${billingError.message}`);
            return res.status(502).json({ error: 'Could not start the subscription.' });
        }
        await query(
            'UPDATE tenants SET razorpay_subscription_id = $1, razorpay_subscription_status = $2 WHERE id = $3',
            [subscription.id, subscription.status ?? 'created', organizationId]
        );
        res.json({
            subscriptionId: subscription.id,
            status: subscription.status ?? 'created',
            authorizationUrl: subscription.short_url,
        });
    } catch (e: any) {
        console.error(`[Billing] Subscribe failed for org=${organizationId}: ${e.message}`);
        res.status(500).json({ error: 'Failed to start subscription' });
    }
});

/**
 * GET /api/enterprise/billing
 */
router.get('/billing', async (req: any, res) => {
    const organizationId = req.organizationId;
    if (!organizationId) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const result = await query(
            'SELECT razorpay_subscription_id, razorpay_subscription_status FROM tenants WHERE id = $1',
            [organizationId]
        );
        const row = result.rows[0];
        res.json({ subscriptionId: row?.razorpay_subscription_id ?? null, status: row?.razorpay_subscription_status ?? null });
    } catch (e: any) {
        console.error(`[Billing] Status failed for org=${organizationId}: ${e.message}`);
        res.status(500).json({ error: 'Failed to load billing status' });
    }
});

export default router;
