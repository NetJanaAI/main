export {};
// Subscription signup. The webhook that confirms it is covered in razorpayWebhook.jest.test.ts.

const query = jest.fn();
const createSubscription = jest.fn();

jest.mock('../../lib/database', () => ({ query, queryWithOrg: jest.fn(), withOrgTransaction: jest.fn(), db: { query } }));
jest.mock('svix', () => ({ Webhook: jest.fn() }));
jest.mock('../../standalone/services/RazorpayService', () => {
    const real = jest.requireActual('../../standalone/services/RazorpayService');
    return { RazorpayService: Object.assign(real.RazorpayService, { createSubscription }) };
});

const ORG_A = '11111111-1111-1111-1111-111111111111';

function route(file: string, method: string, path: string) {
    const router = require(file).default;
    const layer = router.stack.find((l: any) => l.route && l.route.path === path && l.route.methods[method]);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}
function mockRes() {
    const res: any = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
}
beforeEach(() => {
    query.mockReset().mockResolvedValue({ rows: [] });
    createSubscription.mockReset();
    process.env.RAZORPAY_PLAN_ID = 'plan_x';
});

describe('POST /api/enterprise/billing/subscribe', () => {
    const subscribe = () => route('../enterprise', 'post', '/billing/subscribe');

    it('creates a subscription for the caller tenant and stores its id as created', async () => {
        query.mockResolvedValueOnce({ rows: [{ razorpay_subscription_status: null }] }).mockResolvedValue({ rows: [] });
        createSubscription.mockResolvedValue({ id: 'sub_9', status: 'created', short_url: 'https://rzp.io/i/abc' });
        const res = mockRes();
        await subscribe()({ organizationId: ORG_A, body: {} }, res);
        expect(createSubscription).toHaveBeenCalledWith('plan_x', { organizationId: ORG_A });
        const update = query.mock.calls.find((c) => String(c[0]).includes('UPDATE tenants'))!;
        expect(update[1]).toEqual(['sub_9', 'created', ORG_A]);
        expect(res.json).toHaveBeenCalledWith({ subscriptionId: 'sub_9', status: 'created', authorizationUrl: 'https://rzp.io/i/abc' });
    });

    it('does not create a second subscription while one is active or authenticating', async () => {
        for (const status of ['active', 'authenticated']) {
            query.mockResolvedValueOnce({ rows: [{ razorpay_subscription_status: status }] });
            const res = mockRes();
            await subscribe()({ organizationId: ORG_A, body: {} }, res);
            expect(res.status).toHaveBeenCalledWith(409);
        }
        expect(createSubscription).not.toHaveBeenCalled();
    });

    it('is admin-only inside a Clerk organization', async () => {
        const res = mockRes();
        await subscribe()({ organizationId: ORG_A, auth: { org_role: 'org:member' }, body: {} }, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(createSubscription).not.toHaveBeenCalled();
    });

    it('requires a tenant and a configured plan', async () => {
        const noTenant = mockRes();
        await subscribe()({ body: {} }, noTenant);
        expect(noTenant.status).toHaveBeenCalledWith(401);
        delete process.env.RAZORPAY_PLAN_ID;
        const noPlan = mockRes();
        await subscribe()({ organizationId: ORG_A, body: {} }, noPlan);
        expect(noPlan.status).toHaveBeenCalledWith(503);
    });

    it('reports a Razorpay failure as 502 and stores nothing', async () => {
        query.mockResolvedValueOnce({ rows: [{ razorpay_subscription_status: null }] });
        createSubscription.mockRejectedValue(new Error('down'));
        const res = mockRes();
        await subscribe()({ organizationId: ORG_A, body: {} }, res);
        expect(res.status).toHaveBeenCalledWith(502);
        expect(query.mock.calls.some((c) => String(c[0]).includes('UPDATE tenants'))).toBe(false);
    });
});

describe('GET /api/enterprise/billing', () => {
    it('returns only the caller tenant subscription status', async () => {
        query.mockResolvedValue({ rows: [{ razorpay_subscription_id: 'sub_1', razorpay_subscription_status: 'active' }] });
        const res = mockRes();
        await route('../enterprise', 'get', '/billing')({ organizationId: ORG_A }, res);
        expect(query.mock.calls[0][1]).toEqual([ORG_A]);
        expect(res.json).toHaveBeenCalledWith({ subscriptionId: 'sub_1', status: 'active' });
    });
});
