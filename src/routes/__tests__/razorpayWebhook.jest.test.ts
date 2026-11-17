export {};
// Razorpay delivers at least once and not always in order. The webhook must verify the raw body,
// apply each event id once, ignore a stale event that arrives late, and keep tenants.plan in step.
import crypto from 'crypto';

const txQuery = jest.fn();
const withSystemTransaction = jest.fn(async (fn: (c: any) => Promise<void>) => fn({ query: txQuery }));
const SECRET = 'whsec_test';

jest.mock('../../lib/database', () => ({ query: jest.fn(), withSystemTransaction }));
jest.mock('../../lib/secrets', () => ({ getHmacSecret: () => 's', getApiKeySecret: () => 's' }));
jest.mock('svix', () => ({ Webhook: jest.fn() }));
jest.mock('@clerk/backend', () => ({ createClerkClient: jest.fn(() => ({})) }));

function hook() {
    const router = require('../webhooks').default;
    const layer = router.stack.find((l: any) => l.route && l.route.path === '/razorpay' && l.route.methods.post);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}
function mockRes() {
    const res: any = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
}
const sign = (raw: Buffer, secret = SECRET) => crypto.createHmac('sha256', secret).update(raw).digest('hex');
function event(name: string, subId: string, status: string, createdAt = 1_700_000_000) {
    return Buffer.from(JSON.stringify({
        event: name,
        created_at: createdAt,
        payload: { subscription: { entity: { id: subId, status, notes: { organizationId: 'org-attacker' } } } },
    }));
}
async function deliver(raw: Buffer, headers: Record<string, string> = {}) {
    const res = mockRes();
    await hook()({ headers: { 'x-razorpay-signature': sign(raw), 'x-razorpay-event-id': 'evt_1', ...headers }, rawBody: raw }, res);
    return res;
}

/** Scripts the two statements the handler runs inside its transaction. */
function script(opts: { duplicate?: boolean; tenantRows?: number } = {}) {
    txQuery.mockImplementation(async (sql: string) => {
        if (/razorpay_events/.test(sql)) return { rows: opts.duplicate ? [] : [{ event_id: 'evt_1' }] };
        if (/UPDATE tenants/.test(sql)) return { rows: Array.from({ length: opts.tenantRows ?? 1 }, () => ({ id: 'org-a' })) };
        return { rows: [] };
    });
}
const sqls = () => txQuery.mock.calls.map((c) => String(c[0]));
const updateCall = () => txQuery.mock.calls.find((c) => /UPDATE tenants/.test(String(c[0])))!;

beforeEach(() => {
    txQuery.mockReset();
    withSystemTransaction.mockClear();
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    script();
});

describe('signature and configuration', () => {
    it('rejects a missing or wrong signature and writes nothing', async () => {
        const raw = event('subscription.activated', 'sub_1', 'active');
        for (const sig of [undefined, sign(raw, 'other'), 'zz']) {
            const res = mockRes();
            await hook()({ headers: { ...(sig ? { 'x-razorpay-signature': sig } : {}), 'x-razorpay-event-id': 'e' }, rawBody: raw }, res);
            expect(res.status).toHaveBeenCalledWith(400);
        }
        expect(withSystemTransaction).not.toHaveBeenCalled();
    });

    it('refuses everything when no webhook secret is configured', async () => {
        process.env.RAZORPAY_WEBHOOK_SECRET = '';
        const raw = event('subscription.activated', 'sub_1', 'active');
        const res = mockRes();
        await hook()({ headers: { 'x-razorpay-signature': sign(raw, ''), 'x-razorpay-event-id': 'e' }, rawBody: raw }, res);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(withSystemTransaction).not.toHaveBeenCalled();
    });

    it('rejects a validly signed event that has no event id, since it cannot be deduplicated', async () => {
        const raw = event('subscription.activated', 'sub_1', 'active');
        const res = mockRes();
        await hook()({ headers: { 'x-razorpay-signature': sign(raw) }, rawBody: raw }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(withSystemTransaction).not.toHaveBeenCalled();
    });
});

describe('idempotency by event id', () => {
    it('records the event id and updates the tenant in one transaction', async () => {
        const res = await deliver(event('subscription.activated', 'sub_1', 'active'));
        expect(withSystemTransaction).toHaveBeenCalledTimes(1);
        const s = sqls();
        expect(s[0]).toMatch(/INSERT INTO razorpay_events/);
        expect(s[0]).toMatch(/ON CONFLICT \(event_id\) DO NOTHING/);
        expect(txQuery.mock.calls[0][1]).toContain('evt_1');
        expect(s[1]).toMatch(/UPDATE tenants/);
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('applies nothing for an event id it has already processed, and still answers 200', async () => {
        script({ duplicate: true });
        const res = await deliver(event('subscription.activated', 'sub_1', 'active'));
        expect(sqls().some((q) => /UPDATE tenants/.test(q))).toBe(false);
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith({ success: true, duplicate: true });
    });

    it('asks Razorpay to retry (500) when the update fails, so the event id is not left recorded', async () => {
        withSystemTransaction.mockImplementationOnce(async (fn: any) => {
            txQuery.mockImplementation(async (sql: string) => {
                if (/razorpay_events/.test(sql)) return { rows: [{ event_id: 'evt_1' }] };
                throw new Error('db down');
            });
            return fn({ query: txQuery });
        });
        const res = await deliver(event('subscription.activated', 'sub_1', 'active'));
        expect(res.status).toHaveBeenCalledWith(500);
    });
});

describe('state updates', () => {
    it('updates the tenant that owns the stored subscription id and ignores notes', async () => {
        await deliver(event('subscription.activated', 'sub_1', 'active'));
        const [sql, params] = updateCall();
        expect(sql).toMatch(/WHERE razorpay_subscription_id = \$4/);
        expect(params[0]).toBe('active');
        expect(params[3]).toBe('sub_1');
        expect(JSON.stringify(txQuery.mock.calls)).not.toContain('org-attacker');
    });

    it('ignores an older event that arrives after a newer one', async () => {
        await deliver(event('subscription.activated', 'sub_1', 'active', 1_700_000_500));
        const [sql, params] = updateCall();
        expect(sql).toMatch(/razorpay_status_at IS NULL OR razorpay_status_at <= to_timestamp\(\$3/);
        expect(sql).toMatch(/razorpay_status_at = to_timestamp\(\$3/);
        expect(params[2]).toBe(1_700_000_500);
    });

    it.each([
        ['subscription.activated', 'active', 'paid'],
        ['subscription.charged', 'active', 'paid'],
        ['subscription.cancelled', 'cancelled', 'free'],
        ['subscription.completed', 'completed', 'free'],
        ['subscription.halted', 'halted', 'free'],
        ['subscription.authenticated', 'authenticated', null],
        ['subscription.paused', 'paused', null],
        ['subscription.pending', 'pending', null],
    ])('%s (%s) sets plan to %s without overriding a manually set plan', async (name, status, plan) => {
        await deliver(event(name, 'sub_1', status));
        const [sql, params] = updateCall();
        expect(params[0]).toBe(status);
        expect(params[1]).toBe(plan);
        expect(sql).toMatch(/plan IN \('free', 'paid'\)/);
    });

    it('acknowledges unknown subscriptions and unrelated events', async () => {
        script({ tenantRows: 0 });
        for (const raw of [event('subscription.activated', 'sub_unknown', 'active'), event('payment.captured', 'sub_1', 'x')]) {
            const res = await deliver(raw);
            expect(res.status).not.toHaveBeenCalled();
        }
    });

    it('does not store an unexpected status value', async () => {
        await deliver(event('subscription.activated', 'sub_1', 'DROP'));
        expect(withSystemTransaction).not.toHaveBeenCalled();
    });
});
