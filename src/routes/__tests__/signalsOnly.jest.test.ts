// NetJana is signals-only with one API key per tenant: the pull endpoint must resolve a key
// to exactly one tenant, read only that tenant's rows, and return nothing beyond the signal card.
import crypto from 'crypto';

const query = jest.fn();
const queryWithOrg = jest.fn();

jest.mock('../../lib/database', () => ({ query, queryWithOrg, queryAsSystem: jest.fn(), db: { query } }));
jest.mock('../../middleware/rateLimit', () => ({ pullApiRateLimiter: (_q: any, _s: any, n: any) => n() }));
jest.mock('@clerk/backend', () => ({ createClerkClient: jest.fn(() => ({})), verifyToken: jest.fn() }));
jest.mock('../../core/compliance/AuditTrail', () => ({ AuditTrail: { log: jest.fn() } }));
jest.mock('../../signals/website/store', () => ({ signalsForDomains: async () => new Map() }));

import { getApiKeySecret } from '../../lib/secrets';

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';
const LEAD = '33333333-3333-3333-3333-333333333333';
const KEY_A = 'sk_live_tenant_a';
const hashOf = (key: string) => crypto.createHmac('sha256', getApiKeySecret()).update(key).digest('hex');

function pullHandler() {
    const router = require('../netjana-intel').default;
    const layer = router.stack.find((l: any) => l.route && l.route.path === '/leads/:lead_id');
    return layer.route.stack[layer.route.stack.length - 1].handle;
}
function mockRes() {
    const res: any = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
}
/** Tenants table where only key A's hash resolves, to ORG_A. */
function tenantsKnowKeyA() {
    query.mockImplementation(async (sql: string, params: any[]) =>
        sql.includes('FROM tenants') && params[0] === hashOf(KEY_A) ? { rows: [{ id: ORG_A }] } : { rows: [] });
}

beforeEach(() => {
    query.mockReset().mockResolvedValue({ rows: [] });
    queryWithOrg.mockReset().mockResolvedValue({ rows: [] });
});

describe('per-tenant API key (pull endpoint)', () => {
    it('looks the key up by its HMAC, never by the raw key', async () => {
        tenantsKnowKeyA();
        await pullHandler()({ params: { lead_id: LEAD }, headers: { 'x-api-key': KEY_A } }, mockRes());
        const lookup = query.mock.calls[0];
        expect(lookup[1]).toEqual([hashOf(KEY_A)]);
        expect(JSON.stringify(query.mock.calls)).not.toContain(KEY_A);
    });

    it('ignores a key passed in the query string', async () => {
        tenantsKnowKeyA();
        const res = mockRes();
        await pullHandler()({ params: { lead_id: LEAD }, headers: {}, query: { 'x-api-key': KEY_A, api_key: KEY_A } }, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(queryWithOrg).not.toHaveBeenCalled();
    });

    it('a key that matches no tenant gets 403 before any lead query', async () => {
        tenantsKnowKeyA();
        const res = mockRes();
        await pullHandler()({ params: { lead_id: LEAD }, headers: { 'x-api-key': 'sk_live_tenant_b_guess' } }, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(queryWithOrg).not.toHaveBeenCalled();
    });
});

describe('pull endpoint tenant scoping', () => {
    it("scopes both the lead and the influence graph to the key owner's tenant", async () => {
        tenantsKnowKeyA();
        queryWithOrg.mockResolvedValueOnce({ rows: [{ lead_id: LEAD }] }).mockResolvedValueOnce({ rows: [] });
        await pullHandler()({ params: { lead_id: LEAD }, headers: { 'x-api-key': KEY_A } }, mockRes());
        expect(queryWithOrg).toHaveBeenCalledTimes(2);
        const [lead, graph] = queryWithOrg.mock.calls;
        expect(lead[0]).toMatch(/lead_id = \$1 AND org_id = \$2/);
        expect(lead[1]).toEqual([LEAD, ORG_A]);
        expect(graph[0]).toMatch(/lead_id = \$1 AND organization_id = \$2/);
        expect(graph[1]).toEqual([LEAD, ORG_A]);
        expect(lead[2]).toBe(ORG_A);
        expect(graph[2]).toBe(ORG_A);
    });

    it("another tenant's lead is a plain 404 that reveals nothing", async () => {
        tenantsKnowKeyA(); // the lead belongs to ORG_B, so the ORG_A-scoped query finds nothing
        const res = mockRes();
        await pullHandler()({ params: { lead_id: LEAD }, headers: { 'x-api-key': KEY_A } }, res);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(JSON.stringify(res.json.mock.calls)).not.toContain(ORG_B);
        expect(JSON.stringify(res.json.mock.calls)).toContain('Lead not found');
    });

    it('rejects a non-UUID lead id before querying', async () => {
        tenantsKnowKeyA();
        const res = mockRes();
        await pullHandler()({ params: { lead_id: "x' OR '1'='1" }, headers: { 'x-api-key': KEY_A } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(queryWithOrg).not.toHaveBeenCalled();
    });
});

describe('signals-only payload', () => {
    const SIGNAL_FIELDS = [
        'lead_id', 'company_name', 'geo_state', 'sector', 'source_id', 'buying_stage', 'procurement_category',
        'intent_score', 'verity_tier', 'is_triangulated', 'card_why_now', 'card_what_they_need', 'card_do_this',
        'created_at', 'website_signals',
    ].sort();

    it('returns exactly the signal card fields, even if the row carries more', async () => {
        tenantsKnowKeyA();
        queryWithOrg
            .mockResolvedValueOnce({
                rows: [{
                    lead_id: LEAD, company_name: 'Acme', intent_score: 80, created_at: 'now',
                    org_id: ORG_A, contact_email: 'buyer@acme.example', locked_until: 'x', push_status: 'PENDING',
                    triangulated_sources: ['a'], decay_score: 1,
                }],
            })
            .mockResolvedValueOnce({ rows: [] });
        const res = mockRes();
        await pullHandler()({ params: { lead_id: LEAD }, headers: { 'x-api-key': KEY_A } }, res);
        const body = res.json.mock.calls[0][0];
        expect(Object.keys(body).sort()).toEqual(['graph', 'lead', 'request_id']);
        expect(Object.keys(body.lead).sort()).toEqual(SIGNAL_FIELDS);
        expect(JSON.stringify(body)).not.toContain('buyer@acme.example');
        expect(JSON.stringify(body)).not.toContain(ORG_A);
    });

    it('selects only signal columns from lead_cards', async () => {
        tenantsKnowKeyA();
        await pullHandler()({ params: { lead_id: LEAD }, headers: { 'x-api-key': KEY_A } }, mockRes());
        const sql: string = queryWithOrg.mock.calls[0][0];
        expect(sql).not.toMatch(/SELECT\s+\*/i);
        expect(sql).not.toMatch(/contact_email|org_id,|push_status|locked_until/);
    });

    it('exposes only nodes and edges of the influence graph', async () => {
        tenantsKnowKeyA();
        queryWithOrg
            .mockResolvedValueOnce({ rows: [{ lead_id: LEAD, company_name: 'Acme', intent_score: 1, created_at: 'now' }] })
            .mockResolvedValueOnce({ rows: [{ influence_map: { nodes: [{ id: 1 }], edges: [], internal_notes: 'secret' } }] });
        const res = mockRes();
        await pullHandler()({ params: { lead_id: LEAD }, headers: { 'x-api-key': KEY_A } }, res);
        const { graph } = res.json.mock.calls[0][0];
        expect(Object.keys(graph).sort()).toEqual(['edges', 'nodes']);
    });
});

describe('tenant middleware API key path (one key, one tenant)', () => {
    const { tenantContext } = require('../../middleware/tenant');

    it('resolves a key to its own tenant by hash', async () => {
        tenantsKnowKeyA();
        const req: any = { headers: { 'x-api-key': KEY_A }, path: '/api/leads' };
        const next = jest.fn();
        await tenantContext(req, mockRes(), next);
        expect(req.organizationId).toBe(ORG_A);
        expect(next).toHaveBeenCalled();
    });

    it('rejects an unknown key with 401 and no tenant', async () => {
        tenantsKnowKeyA();
        const req: any = { headers: { 'x-api-key': 'unknown' }, path: '/api/leads' };
        const res = mockRes();
        const next = jest.fn();
        await tenantContext(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(req.organizationId).toBeUndefined();
        expect(next).not.toHaveBeenCalled();
    });

    it('does not accept a spoofed x-organization-id header', async () => {
        tenantsKnowKeyA();
        const req: any = { headers: { 'x-organization-id': ORG_B }, path: '/api/leads' };
        const res = mockRes();
        await tenantContext(req, res, jest.fn());
        expect(req.organizationId).toBeUndefined();
        expect(res.status).toHaveBeenCalledWith(401);
    });
});
