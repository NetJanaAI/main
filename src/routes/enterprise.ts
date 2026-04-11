import { Router } from 'express';
import { db } from '../lib/database';
import { RazorpayService } from '../standalone/services/RazorpayService';

const router = Router();

/**
 * Enterprise Seat Management API
 * POST /api/enterprise/seats/add
 */
router.post('/seats/add', async (req: any, res) => {
    const { organizationId, userEmail, userName } = req.body;
    const callerOrgId = req.user?.organizationId;

    // Security: Only org admins or internal netjana can add seats
    if (callerOrgId !== organizationId && req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized: Cannot manage seats for other organizations.' });
    }

    try {
        // 1. Create sub-account record in DB
        const seatId = `seat_${Date.now()}`;
        await db.query(
            'INSERT INTO organization_seats (id, organization_id, email, name, status) VALUES ($1, $2, $3, $4, $5)',
            [seatId, organizationId, userEmail, userName, 'active']
        );

        // 2. Trigger metered billing if beyond free quota
        const countRes = await db.query('SELECT COUNT(*) FROM organization_seats WHERE organization_id = $1', [organizationId]);
        const seatCount = parseInt(countRes.rows[0].count);

        if (seatCount > 3) { // 3 free seats per org
             const subscriptionId = req.user?.subscriptionId;
             if (subscriptionId) {
                 await RazorpayService.billExtraUsage(subscriptionId, 500, `Extra Seat: ${userEmail}`); // 500 INR/seat
             }
        }

        res.json({ message: 'Seat added successfully', seatId });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/enterprise/seats
 */
router.get('/seats', async (req: any, res) => {
    const orgId = req.organizationId || req.user?.organizationId;
    try {
        const result = await db.query('SELECT * FROM organization_seats WHERE organization_id = $1', [orgId]);
        res.json(result.rows);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
