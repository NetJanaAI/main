export {};
// The webhook SQL run against real Postgres (PGlite): dedupe by event id, rollback of the event id when
// the update fails, out-of-order events, and the plan mapping.
import crypto from 'crypto';
import { PGlite } from '@electric-sql/pglite';

jest.setTimeout(60000);

const SECRET = 'whsec_test';
const ORG = '11111111-1111-1111-1111-111111111111';
let pg: PGlite;

jest.mock('../../lib/database', () => ({
    query: jest.fn(),
    withSystemTransaction: async (fn: (c: any) => Promise<void>) => {
        await pg.query('BEGIN');
        try {
            await fn({ query: (sql: string, params?: any[]) => pg.query(sql, params) });
            await pg.query('COMMIT');
        } catch (e) {
            await pg.query('ROLLBACK');
            throw e;
        }
    },
}));
jest.mock('../../lib/secrets', () => ({ getHmacSecret: () => 's', getApiKeySecret: () => 's' }));
jest.mock('svix', () => ({ Webhook: jest.fn() }));
jest.mock('@clerk/backend', () => ({ createClerkClient: jest.fn(() => ({})) }));

function hook() {
    const router = require('../webhooks').default;
    const layer = router.stack.find((l: any) => l.route && l.route.path === '/razorpay' && l.route.methods.post);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}
async function deliver(id: string, name: string, status: string, createdAt: number) {
    const raw = Buffer.from(JSON.stringify({ event: name, created_at: createdAt, payload: { subscription: { entity: { id: 'sub_1', status } } } }));
    const sig = crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
    const res: any = { status: jest.fn(() => res), json: jest.fn(() => res) };
    await hook()({ headers: { 'x-razorpay-signature': sig, 'x-razorpay-event-id': id }, rawBody: raw }, res);
    return res;
}
async function tenant() {
    return (await pg.query<any>('SELECT plan, razorpay_subscription_status AS status FROM tenants WHERE id = $1', [ORG])).rows[0];
}
const eventCount = async () => (await pg.query<any>('SELECT COUNT(*)::int AS n FROM razorpay_events')).rows[0].n;

beforeAll(async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    pg = new PGlite();
    await pg.exec(`
        CREATE TABLE tenants (id UUID PRIMARY KEY, plan TEXT DEFAULT 'free', razorpay_subscription_id TEXT,
            razorpay_subscription_status TEXT, razorpay_status_at TIMESTAMPTZ);
        CREATE TABLE razorpay_events (event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    `);
});
afterAll(async () => { await pg.close(); });
beforeEach(async () => {
    await pg.exec('DELETE FROM razorpay_events; DELETE FROM tenants;');
    await pg.query("INSERT INTO tenants (id, razorpay_subscription_id, razorpay_subscription_status) VALUES ($1, 'sub_1', 'created')", [ORG]);
});

describe('razorpay webhook against Postgres', () => {
    it('activates the tenant and marks the plan paid', async () => {
        await deliver('evt_1', 'subscription.activated', 'active', 1000);
        expect(await tenant()).toEqual({ plan: 'paid', status: 'active' });
    });

    it('applies a redelivered event id once', async () => {
        await deliver('evt_1', 'subscription.activated', 'active', 1000);
        const again = await deliver('evt_1', 'subscription.activated', 'active', 1000);
        expect(again.json).toHaveBeenCalledWith({ success: true, duplicate: true });
        expect(await eventCount()).toBe(1);
    });

    it('ignores a cancelled event that arrives after a newer activation', async () => {
        await deliver('evt_new', 'subscription.activated', 'active', 2000);
        await deliver('evt_old', 'subscription.cancelled', 'cancelled', 1000);
        expect(await tenant()).toEqual({ plan: 'paid', status: 'active' });
    });

    it('drops the plan back to free on cancellation', async () => {
        await deliver('evt_1', 'subscription.activated', 'active', 1000);
        await deliver('evt_2', 'subscription.cancelled', 'cancelled', 2000);
        expect(await tenant()).toEqual({ plan: 'free', status: 'cancelled' });
    });

    it('leaves a manually set plan alone', async () => {
        await pg.query("UPDATE tenants SET plan = 'enterprise' WHERE id = $1", [ORG]);
        await deliver('evt_1', 'subscription.activated', 'active', 1000);
        expect(await tenant()).toEqual({ plan: 'enterprise', status: 'active' });
    });

    it('leaves the plan unchanged for transitional statuses', async () => {
        await deliver('evt_1', 'subscription.activated', 'active', 1000);
        await deliver('evt_2', 'subscription.paused', 'paused', 2000);
        expect(await tenant()).toEqual({ plan: 'paid', status: 'paused' });
    });

    it('does not burn the event id when the update fails, so the retry applies it', async () => {
        const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        await pg.exec('ALTER TABLE tenants RENAME COLUMN razorpay_status_at TO razorpay_status_at_x');
        const failed = await deliver('evt_1', 'subscription.activated', 'active', 1000);
        logged.mockRestore();
        expect(failed.status).toHaveBeenCalledWith(500);
        expect(await eventCount()).toBe(0);
        await pg.exec('ALTER TABLE tenants RENAME COLUMN razorpay_status_at_x TO razorpay_status_at');
        await deliver('evt_1', 'subscription.activated', 'active', 1000);
        expect(await tenant()).toEqual({ plan: 'paid', status: 'active' });
    });
});
