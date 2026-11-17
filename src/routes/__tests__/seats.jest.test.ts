// Seats beyond the free quota are billed to the tenant's own subscription. The seat is reserved in a
// short row-locked transaction, the charge happens outside it, and the seat is then confirmed.
// Razorpay has no idempotency key for add-ons, so the durable 'billing' seat row is what stops a
// retry from charging twice.
export {};
const txQuery = jest.fn();
const queryWithOrg = jest.fn();
const billExtraUsage = jest.fn();
let inTransaction = false;
const withOrgTransaction = jest.fn(async (_org: string, fn: (c: any) => Promise<void>) => {
    inTransaction = true;
    try {
        await fn({ query: txQuery });
    } finally {
        inTransaction = false;
    }
});

jest.mock('../../lib/database', () => ({ withOrgTransaction, queryWithOrg, query: jest.fn(), db: { query: jest.fn() } }));
jest.mock('../../standalone/services/RazorpayService', () => ({ RazorpayService: { billExtraUsage } }));

const ORG_A = '11111111-1111-1111-1111-111111111111';
const body = { userEmail: 'new@a.example', userName: 'New' };

function handler(method: string, path: string) {
    const router = require('../enterprise').default;
    const layer = router.stack.find((l: any) => l.route && l.route.path === path && l.route.methods[method]);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}
function mockRes() {
    const res: any = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
}

/** Scripts the tenant row, the insert, the post-insert seat count and (for a duplicate) the existing seat. */
function scriptDb(opts: { subscription: string | null; count: number; duplicate?: boolean; status?: string | null; existingSeat?: string }) {
    txQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM tenants')) return { rows: [{ razorpay_subscription_id: opts.subscription, razorpay_subscription_status: opts.status === undefined ? (opts.subscription ? 'active' : null) : opts.status }] };
        if (sql.includes('INSERT INTO organization_seats')) return { rows: opts.duplicate ? [] : [{ id: 'seat_x' }] };
        if (sql.includes('COUNT(*)')) return { rows: [{ count: String(opts.count) }] };
        if (sql.includes('SELECT status FROM organization_seats')) return { rows: [{ status: opts.existingSeat ?? 'active' }] };
        return { rows: [] };
    });
}
const outsideSqls = () => queryWithOrg.mock.calls.map((c) => String(c[0]));
const txSqls = () => txQuery.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
    txQuery.mockReset();
    billExtraUsage.mockReset().mockResolvedValue({ id: 'ao_1' });
    withOrgTransaction.mockClear();
    queryWithOrg.mockReset().mockResolvedValue({ rows: [{ id: 'seat_x' }] });
    inTransaction = false;
});

describe('POST /seats/add billing', () => {
    const add = () => handler('post', '/seats/add');

    it('does not bill within the 3 free seats and leaves the seat active', async () => {
        scriptDb({ subscription: 'sub_a', count: 3 });
        const res = mockRes();
        await add()({ organizationId: ORG_A, body }, res);
        expect(billExtraUsage).not.toHaveBeenCalled();
        expect(queryWithOrg).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Seat added successfully' }));
    });

    it('bills the 4th seat to the subscription stored for the tenant (not req.user), naming the seat', async () => {
        scriptDb({ subscription: 'sub_a', count: 4 });
        const res = mockRes();
        await add()({ organizationId: ORG_A, body, user: { subscriptionId: 'sub_attacker' } }, res);
        expect(billExtraUsage).toHaveBeenCalledTimes(1);
        expect(billExtraUsage).toHaveBeenCalledWith('sub_a', 500, expect.stringContaining('new@a.example'));
        const seatId = res.json.mock.calls[0][0].seatId;
        expect(billExtraUsage.mock.calls[0][2]).toContain(seatId);
    });

    it('charges outside the transaction, so no tenant row lock is held during the Razorpay call', async () => {
        scriptDb({ subscription: 'sub_a', count: 4 });
        let heldLockDuringCharge: boolean | undefined;
        billExtraUsage.mockImplementation(async () => { heldLockDuringCharge = inTransaction; return { id: 'ao_1' }; });
        await add()({ organizationId: ORG_A, body }, mockRes());
        expect(heldLockDuringCharge).toBe(false);
        const tenantQ = txQuery.mock.calls.find((c) => String(c[0]).includes('FROM tenants'))!;
        expect(String(tenantQ[0])).toMatch(/WHERE id = \$1 FOR UPDATE/);
        expect(tenantQ[1]).toEqual([ORG_A]);
    });

    it('reserves a paid seat as billing inside the lock, then confirms it active with the add-on id', async () => {
        scriptDb({ subscription: 'sub_a', count: 4 });
        await add()({ organizationId: ORG_A, body }, mockRes());
        expect(txSqls().some((q) => /UPDATE organization_seats SET status = 'billing'/.test(q))).toBe(true);
        const confirm = queryWithOrg.mock.calls.find((c) => /SET status = 'active'/.test(String(c[0])))!;
        expect(confirm[1]).toEqual(expect.arrayContaining(['ao_1']));
        expect(confirm[2]).toBe(ORG_A);
    });

    it('rolls the seat back (402) when a paid seat has no subscription to bill', async () => {
        scriptDb({ subscription: null, count: 4 });
        const res = mockRes();
        await add()({ organizationId: ORG_A, body }, res);
        expect(res.status).toHaveBeenCalledWith(402);
        expect(billExtraUsage).not.toHaveBeenCalled();
    });

    it('rolls the seat back (402) when the subscription is not active', async () => {
        for (const status of ['created', 'halted', 'cancelled']) {
            scriptDb({ subscription: 'sub_a', count: 4, status });
            const res = mockRes();
            await add()({ organizationId: ORG_A, body }, res);
            expect(res.status).toHaveBeenCalledWith(402);
        }
        expect(billExtraUsage).not.toHaveBeenCalled();
    });

    it('removes the reserved seat (502) when Razorpay fails, since nothing was charged', async () => {
        scriptDb({ subscription: 'sub_a', count: 4 });
        billExtraUsage.mockRejectedValue(new Error('razorpay down'));
        const res = mockRes();
        await add()({ organizationId: ORG_A, body }, res);
        expect(res.status).toHaveBeenCalledWith(502);
        expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'Seat added successfully' }));
        const del = queryWithOrg.mock.calls.find((c) => /DELETE FROM organization_seats/.test(String(c[0])))!;
        expect(del[1]).toContain(ORG_A);
    });

    describe('charge succeeded but confirming the seat fails', () => {
        const failConfirm = (times: number) => {
            let n = 0;
            queryWithOrg.mockImplementation(async (sql: string) => {
                if (/SET status = 'active'/.test(sql) && n++ < times) throw new Error('commit failed');
                return { rows: [{ id: 'seat_x' }] };
            });
        };

        it('keeps the seat as billing, never deletes it, never charges twice, and logs the add-on id', async () => {
            scriptDb({ subscription: 'sub_a', count: 4 });
            failConfirm(99);
            const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
            const res = mockRes();
            await add()({ organizationId: ORG_A, body }, res);
            expect(billExtraUsage).toHaveBeenCalledTimes(1);
            expect(outsideSqls().some((q) => /DELETE FROM organization_seats/.test(q))).toBe(false);
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'Seat added successfully' }));
            expect(logged.mock.calls.flat().join(' ')).toContain('ao_1');
            logged.mockRestore();
        });

        it('a retry for the same email does not charge again and says the seat is awaiting confirmation', async () => {
            scriptDb({ subscription: 'sub_a', count: 4, duplicate: true, existingSeat: 'billing' });
            const res = mockRes();
            await add()({ organizationId: ORG_A, body }, res);
            expect(billExtraUsage).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(409);
            expect(JSON.stringify(res.json.mock.calls)).toMatch(/awaiting billing confirmation/);
        });

        it('retries the confirmation a few times before giving up, charging only once', async () => {
            scriptDb({ subscription: 'sub_a', count: 4 });
            failConfirm(2);
            const res = mockRes();
            await add()({ organizationId: ORG_A, body }, res);
            expect(billExtraUsage).toHaveBeenCalledTimes(1);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Seat added successfully' }));
        });
    });

    it('returns 409 for a duplicate email and bills nothing', async () => {
        scriptDb({ subscription: 'sub_a', count: 9, duplicate: true });
        const res = mockRes();
        await add()({ organizationId: ORG_A, body }, res);
        expect(res.status).toHaveBeenCalledWith(409);
        expect(billExtraUsage).not.toHaveBeenCalled();
    });

    it('rejects an invalid body before touching the database', async () => {
        const res = mockRes();
        await add()({ organizationId: ORG_A, body: { userEmail: 'not-an-email' } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(withOrgTransaction).not.toHaveBeenCalled();
    });
});

describe('DELETE /seats/:id', () => {
    const remove = () => handler('delete', '/seats/:id');

    it('removes a seat of the caller tenant only', async () => {
        queryWithOrg.mockResolvedValue({ rows: [{ id: 'seat_1' }] });
        const res = mockRes();
        await remove()({ organizationId: ORG_A, params: { id: 'seat_1' } }, res);
        const [sql, params, org] = queryWithOrg.mock.calls[0];
        expect(sql).toMatch(/DELETE FROM organization_seats WHERE id = \$1 AND organization_id = \$2/);
        expect(params).toEqual(['seat_1', ORG_A]);
        expect(org).toBe(ORG_A);
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Seat removed' }));
    });

    it('answers 404 for a seat that does not exist or belongs to another tenant', async () => {
        queryWithOrg.mockResolvedValue({ rows: [] });
        const res = mockRes();
        await remove()({ organizationId: ORG_A, params: { id: 'seat_of_b' } }, res);
        expect(res.status).toHaveBeenCalledWith(404);
    });

    it('is admin-only inside a Clerk organization and needs a tenant', async () => {
        const member = mockRes();
        await remove()({ organizationId: ORG_A, auth: { org_role: 'org:member' }, params: { id: 's' } }, member);
        expect(member.status).toHaveBeenCalledWith(403);
        const anon = mockRes();
        await remove()({ params: { id: 's' } }, anon);
        expect(anon.status).toHaveBeenCalledWith(401);
        expect(queryWithOrg).not.toHaveBeenCalled();
    });
});

describe('seat route access control', () => {
    const add = () => handler('post', '/seats/add');

    it('inserts only for the caller tenant', async () => {
        scriptDb({ subscription: 'sub_a', count: 1 });
        await add()({ organizationId: ORG_A, body }, mockRes());
        const insert = txQuery.mock.calls.find((c) => String(c[0]).includes('INSERT INTO organization_seats'))!;
        expect(insert[1]).toContain(ORG_A);
    });

    it('refuses a seat aimed at another tenant', async () => {
        const res = mockRes();
        await add()({ organizationId: ORG_A, body: { ...body, organizationId: 'org-b' } }, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(withOrgTransaction).not.toHaveBeenCalled();
    });

    it('refuses a non-admin member of a Clerk organization', async () => {
        const res = mockRes();
        await add()({ organizationId: ORG_A, auth: { org_role: 'org:member' }, body }, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(withOrgTransaction).not.toHaveBeenCalled();
    });

    it('refuses a caller with no tenant', async () => {
        const res = mockRes();
        await add()({ body }, res);
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it('lists seats through the tenant-scoped helper', async () => {
        await handler('get', '/seats')({ organizationId: ORG_A }, mockRes());
        expect(queryWithOrg.mock.calls[0][1]).toEqual([ORG_A]);
        expect(queryWithOrg.mock.calls[0][2]).toBe(ORG_A);
    });
});
