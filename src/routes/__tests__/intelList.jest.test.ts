export {};
// GET /v1/intel/leads: tenant-scoped, signals-only, cursor paginated.
const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const KEYS: Record<string, string> = { 'key-a': ORG_A, 'key-b': ORG_B };

const PII = { contact_email: 'buyer@example.com', contact_name: 'Pat', phone: '+91 99999 99999' };
const row = (org: string, n: number, ts: string) => ({
    org_id: org, lead_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, company_name: `Co ${n}`,
    geo_state: 'KA', sector: 'IT', source_id: 'gem', buying_stage: 'DECISION', procurement_category: 'AI',
    intent_score: 80, verity_tier: 'TIER_1', is_triangulated: false, card_why_now: 'w', card_what_they_need: 'n',
    card_do_this: 'd', created_at: new Date(ts), cursor_ts: ts, ...PII,
});
const ROWS = [
    row(ORG_A, 1, '2026-06-01T00:00:00.000001Z'), row(ORG_A, 2, '2026-06-01T00:00:00.000002Z'),
    row(ORG_A, 3, '2026-06-02T00:00:00.000000Z'), row(ORG_B, 4, '2026-06-01T12:00:00.000000Z'),
];
const COLUMNS = ['lead_id', 'company_name', 'geo_state', 'sector', 'source_id', 'buying_stage', 'procurement_category',
    'intent_score', 'verity_tier', 'is_triangulated', 'card_why_now', 'card_what_they_need', 'card_do_this', 'created_at'];

const query = jest.fn();
const queryWithOrg = jest.fn();

jest.mock('../../lib/database', () => ({ query, queryWithOrg }));
jest.mock('../../lib/secrets', () => ({ getApiKeySecret: () => 'test-secret' }));
jest.mock('../../middleware/rateLimit', () => ({ pullApiRateLimiter: (_q: any, _s: any, n: any) => n() }));

/** Fake lead_cards: honours the org, the (since, cursor) filter and the limit, like the SQL would. */
function fakeLeadQuery(sql: string, params: any[], org: string) {
    expect(sql).toMatch(/org_id = \$1/);
    const [orgParam, since, afterTs, afterId, limit] = params;
    expect(orgParam).toBe(org);
    let rows = ROWS.filter(r => r.org_id === org);
    if (since) rows = rows.filter(r => new Date(r.cursor_ts) >= new Date(since));
    rows = [...rows].sort((a, b) => (a.cursor_ts + a.lead_id).localeCompare(b.cursor_ts + b.lead_id));
    if (afterTs) rows = rows.filter(r => r.cursor_ts > afterTs || (r.cursor_ts === afterTs && r.lead_id > afterId));
    return { rows: rows.slice(0, limit) };
}

function list() {
    const router = require('../netjana-intel').default;
    const layer = router.stack.find((l: any) => l.route && l.route.path === '/leads' && l.route.methods.get);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}
const res = () => { const r: any = {}; r.status = jest.fn(() => r); r.json = jest.fn(() => r); return r; };
const req = (key: string | undefined, q: any = {}) => ({ headers: key ? { 'x-api-key': key } : {}, query: q });
const crypto = require('crypto');
const hashOf = (k: string) => crypto.createHmac('sha256', 'test-secret').update(k).digest('hex');

beforeEach(() => {
    query.mockReset().mockImplementation(async (_sql: string, params: any[]) => {
        const key = Object.keys(KEYS).find(k => hashOf(k) === params[0]);
        return { rows: key ? [{ id: KEYS[key] }] : [] };
    });
    queryWithOrg.mockReset().mockImplementation(async (sql: string, params: any[], org: string) => fakeLeadQuery(sql, params, org));
});

describe('GET /v1/intel/leads', () => {
    it('rejects a missing or unknown key', async () => {
        for (const k of [undefined, 'nope']) {
            const r = res();
            await list()(req(k), r);
            expect(r.status).toHaveBeenCalledWith(403);
        }
        expect(queryWithOrg).not.toHaveBeenCalled();
    });

    it('returns only the key owner leads', async () => {
        const r = res();
        await list()(req('key-b'), r);
        const out = r.json.mock.calls[0][0];
        expect(out.leads.map((l: any) => l.company_name)).toEqual(['Co 4']);
        expect(queryWithOrg.mock.calls[0][2]).toBe(ORG_B);
    });

    it('returns exactly the single-lead field list and no contact PII', async () => {
        const r = res();
        await list()(req('key-a'), r);
        const { leads } = r.json.mock.calls[0][0];
        expect(leads.length).toBe(3);
        for (const l of leads) expect(Object.keys(l).sort()).toEqual([...COLUMNS].sort());
        const text = JSON.stringify(r.json.mock.calls[0][0]);
        expect(text).not.toMatch(/buyer@example\.com|Pat|99999|contact_|phone|email/);
        const sql = String(queryWithOrg.mock.calls[0][0]);
        expect(sql).not.toMatch(/contact_|phone|SELECT\s+\*/i);
    });

    it('pages with an opaque cursor and never repeats or skips a lead', async () => {
        const seen: string[] = [];
        let cursor: string | undefined;
        let pages = 0;
        do {
            const r = res();
            await list()(req('key-a', { limit: '2', ...(cursor ? { cursor } : {}) }), r);
            const out = r.json.mock.calls[0][0];
            seen.push(...out.leads.map((l: any) => l.company_name));
            cursor = out.next_cursor ?? undefined;
            pages++;
        } while (cursor && pages < 5);
        expect(seen).toEqual(['Co 1', 'Co 2', 'Co 3']);
        expect(pages).toBe(2);
    });

    it('has no next_cursor on the last page', async () => {
        const r = res();
        await list()(req('key-a', { limit: '3' }), r);
        expect(r.json.mock.calls[0][0].next_cursor).toBeNull();
    });

    it('honours since', async () => {
        const r = res();
        await list()(req('key-a', { since: '2026-06-02T00:00:00Z' }), r);
        expect(r.json.mock.calls[0][0].leads.map((l: any) => l.company_name)).toEqual(['Co 3']);
    });

    it('rejects a bad since, limit or cursor with 400', async () => {
        for (const q of [{ since: 'yesterday' }, { limit: '0' }, { limit: 'abc' }, { cursor: '!!!' }]) {
            const r = res();
            await list()(req('key-a', q), r);
            expect(r.status).toHaveBeenCalledWith(400);
        }
    });

    it('caps limit at 200 and defaults to 50', async () => {
        await list()(req('key-a', { limit: '5000' }), res());
        expect(queryWithOrg.mock.calls[0][1].at(-1)).toBe(201);
        queryWithOrg.mockClear();
        await list()(req('key-a'), res());
        expect(queryWithOrg.mock.calls[0][1].at(-1)).toBe(51);
    });

    it('cannot use a cursor to reach another tenant: the org filter is always the key owner', async () => {
        const r1 = res();
        await list()(req('key-a', { limit: '1' }), r1);
        const cursor = r1.json.mock.calls[0][0].next_cursor;
        const r2 = res();
        await list()(req('key-b', { cursor }), r2);
        expect(r2.json.mock.calls[0][0].leads.every((l: any) => l.company_name === 'Co 4')).toBe(true);
    });
});

describe('route is rate limited', () => {
    it('runs behind the pull API limiter', () => {
        const router = require('../netjana-intel').default;
        const layer = router.stack.find((l: any) => l.route && l.route.path === '/leads' && l.route.methods.get);
        expect(layer.route.stack.length).toBeGreaterThan(1);
    });
});
