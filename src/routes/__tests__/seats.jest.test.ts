// Seat billing: seats beyond the free quota must be billed to the tenant's own
// subscription, atomically with the seat insert, and never double-count under races.
export {};
const txQuery = jest.fn();
const withOrgTransaction = jest.fn(async (_org: string, fn: (c: any) => Promise<void>) => fn({ query: txQuery }));
const queryWithOrg = jest.fn();
const billExtraUsage = jest.fn();

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

/** Scripts the tenant row, the insert and the post-insert seat count. */
function scriptDb(opts: { subscription: string | null; count: number; duplicate?: boolean; status?: string | null }) {
    txQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM tenants')) return { rows: [{ razorpay_subscription_id: opts.subscription, razorpay_subscription_status: opts.status === undefined ? (opts.subscription ? 'active' : null) : opts.status }] };
        if (sql.includes('INSERT INTO organization_seats')) return { rows: opts.duplicate ? [] : [{ id: 'seat_x' }] };
        if (sql.includes('COUNT(*)')) return { rows: [{ count: String(opts.count) }] };
        return { rows: [] };
    });
}

beforeEach(() => {
    txQuery.mockReset();
    billExtraUsage.mockReset().mockResolvedValue({});
    withOrgTransaction.mockClear();
    queryWithOrg.mockReset().mockResolvedValue({ rows: [] });
});

describe('POST /seats/add billing', () => {
    const add = () => handler('post', '/seats/add');

    it('does not bill within the 3 free seats', async () => {
        scriptDb({ subscription: 'sub_a', count: 3 });
        const res = mockRes();
        await add()({ organizationId: ORG_A, body }, res);
        expect(billExtraUsage).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Seat added successfully' }));
    });

    it('bills the 4th seat to the subscription stored for the tenant (not req.user)', async () => {
        scriptDb({ subscription: 'sub_a', count: 4 });
        await add()({ organizationId: ORG_A, body, user: { subscriptionId: 'sub_attacker' } }, mockRes());
        expect(billExtraUsage).toHaveBeenCalledTimes(1);
        expect(billExtraUsage).toHaveBeenCalledWith('sub_a', 500, expect.stringContaining('new@a.example'));
    });

    it('looks up the subscription for the caller tenant only, under a row lock', async () => {
        scriptDb({ subscription: 'sub_a', count: 4 });
        await add()({ organizationId: ORG_A, body }, mockRes());
        const tenantQ = txQuery.mock.calls.find((c) => String(c[0]).includes('FROM tenants'))!;
        expect(String(tenantQ[0])).toMatch(/WHERE id = \$1 FOR UPDATE/);
        expect(tenantQ[1]).toEqual([ORG_A]);
        expect(withOrgTransaction.mock.calls[0][0]).toBe(ORG_A);
    });

    it('rolls the seat back (402) when a paid seat has no subscription to bill', async () => {
        scriptDb({ subscription: null, count: 4 });
        const res = mockRes();
        await add()({ organizationId: ORG_A, body }, res);
        expect(res.status).toHaveBeenCalledWith(402);
        expect(billExtraUsage).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'Seat added successfully' }));
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

    it('rolls the seat back (502) when Razorpay fails', async () => {
        scriptDb({ subscription: 'sub_a', count: 4 });
        billExtraUsage.mockRejectedValue(new Error('razorpay down'));
        const res = mockRes();
        await add()({ organizationId: ORG_A, body }, res);
        expect(res.status).toHaveBeenCalledWith(502);
        expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'Seat added successfully' }));
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
