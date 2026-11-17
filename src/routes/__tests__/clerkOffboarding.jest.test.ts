export {};
// Clerk delete events mark the tenant inactive. They never purge data on their own.
const query = jest.fn();
const purge = jest.fn();
const getMembers = jest.fn();
let event: any;

jest.mock('../../lib/database', () => ({ query }));
jest.mock('../../lib/secrets', () => ({ getHmacSecret: () => 's', getApiKeySecret: () => 's' }));
jest.mock('../../core/rag/VanishProtocol', () => ({ VanishProtocol: { purge } }));
jest.mock('../../standalone/services/RazorpayService', () => ({ RazorpayService: {} }));
jest.mock('svix', () => ({ Webhook: jest.fn(() => ({ verify: () => event })) }));
jest.mock('@clerk/backend', () => ({
    createClerkClient: jest.fn(() => ({ organizations: { getOrganizationMembershipList: getMembers } })),
}));

process.env.CLERK_WEBHOOK_SECRET = 'whsec_test';

function clerkHandler() {
    const router = require('../webhooks').default;
    const layer = router.stack.find((l: any) => l.route && l.route.path === '/clerk' && l.route.methods.post);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}
function mockRes() {
    const res: any = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
}
async function deliver(evt: any) {
    event = evt;
    const res = mockRes();
    await clerkHandler()(
        { headers: { 'svix-id': 'i', 'svix-timestamp': 't', 'svix-signature': 's' }, rawBody: '{}' },
        res,
    );
    return res;
}
const updates = () => query.mock.calls.filter(([sql]) => /UPDATE tenants/i.test(sql));

beforeEach(() => {
    query.mockReset().mockResolvedValue({ rows: [], rowCount: 1 });
    purge.mockReset();
    getMembers.mockReset();
});

describe('Clerk offboarding webhook', () => {
    it('user.deleted marks that user\'s tenant inactive', async () => {
        const res = await deliver({ type: 'user.deleted', data: { id: 'user_1', deleted: true } });
        expect(res.status).not.toHaveBeenCalled();
        expect(updates()).toHaveLength(1);
        const [sql, params] = updates()[0];
        expect(sql).toMatch(/deactivated_at\s*=\s*NOW\(\)/i);
        expect(sql).toMatch(/clerk_user_id\s*=\s*\$1/);
        expect(params).toEqual(['user_1']);
    });

    it('organization.deleted marks that organisation\'s tenant inactive', async () => {
        await deliver({ type: 'organization.deleted', data: { id: 'org_1', deleted: true } });
        const [sql, params] = updates()[0];
        expect(sql).toMatch(/clerk_org_id\s*=\s*\$1/);
        expect(params).toEqual(['org_1']);
    });

    it('never purges data or deletes the tenant itself', async () => {
        await deliver({ type: 'user.deleted', data: { id: 'user_1' } });
        await deliver({ type: 'organization.deleted', data: { id: 'org_1' } });
        expect(purge).not.toHaveBeenCalled();
        expect(query.mock.calls.some(([sql]) => /DELETE\s+FROM/i.test(sql))).toBe(false);
    });

    it('does not touch an already inactive tenant again, so retries keep the first timestamp', async () => {
        await deliver({ type: 'user.deleted', data: { id: 'user_1' } });
        expect(updates()[0][0]).toMatch(/deactivated_at IS NULL/i);
    });

    it('answers 200 for a user or organisation we never had (Clerk retries on errors)', async () => {
        query.mockResolvedValue({ rows: [], rowCount: 0 });
        const res = await deliver({ type: 'user.deleted', data: { id: 'user_unknown' } });
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    describe('organizationMembership.deleted', () => {
        const evt = { type: 'organizationMembership.deleted', data: { organization: { id: 'org_1' }, public_user_data: { user_id: 'user_9' } } };

        it('leaves the tenant active while other members remain', async () => {
            getMembers.mockResolvedValue({ totalCount: 2 });
            await deliver(evt);
            expect(getMembers).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org_1' }));
            expect(updates()).toHaveLength(0);
        });

        it('marks the tenant inactive when the last member leaves', async () => {
            getMembers.mockResolvedValue({ totalCount: 0 });
            await deliver(evt);
            expect(updates()).toHaveLength(1);
            expect(updates()[0][1]).toEqual(['org_1']);
        });

        it('does not deactivate when Clerk cannot be asked, and asks Clerk to retry', async () => {
            getMembers.mockRejectedValue(new Error('clerk down'));
            const res = await deliver(evt);
            expect(updates()).toHaveLength(0);
            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    it('still creates tenants for the existing created events', async () => {
        await deliver({ type: 'organization.created', data: { id: 'org_2', name: 'N', slug: 'n' } });
        expect(query.mock.calls.some(([sql]) => /INSERT INTO tenants/i.test(sql))).toBe(true);
    });
});
