export {};
// The pull payload carries confirmed website signals for the lead's company; nothing else changes.
const ORG = '11111111-1111-1111-1111-111111111111';
const signalsForDomains = jest.fn();
const query = jest.fn();
const queryWithOrg = jest.fn();

jest.mock('../../lib/database', () => ({ query, queryWithOrg }));
jest.mock('../../lib/secrets', () => ({ getApiKeySecret: () => 'test-secret' }));
jest.mock('../../middleware/rateLimit', () => ({ pullApiRateLimiter: (_q: any, _s: any, n: any) => n() }));
jest.mock('../../signals/website/store', () => ({ signalsForDomains }));

const SIGNAL = { signal_key: 'running_ads', value: { present: true }, evidence_url: 'https://acme.example/', observed_at: '2026-06-01T00:00:00.000Z' };
const lead = (domain: string | null, n: number) => ({
    lead_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, company_name: `Co ${n}`, company_domain: domain,
    created_at: new Date('2026-06-01T00:00:00Z'), cursor_ts: '2026-06-01T00:00:00.000000Z',
});

function listHandler() {
    const router = require('../netjana-intel').default;
    const layer = router.stack.find((l: any) => l.route && l.route.path === '/leads' && l.route.methods.get);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}
const res = () => { const r: any = {}; r.status = jest.fn(() => r); r.json = jest.fn(() => r); return r; };

beforeEach(() => {
    query.mockReset().mockResolvedValue({ rows: [{ id: ORG }] });
    queryWithOrg.mockReset().mockResolvedValue({ rows: [lead('acme.example', 1), lead(null, 2)] });
    signalsForDomains.mockReset().mockResolvedValue(new Map([['acme.example', [SIGNAL]]]));
});

describe('GET /v1/intel/leads website_signals', () => {
    it('attaches the tenant\'s confirmed signals to leads with a known domain, an empty list otherwise', async () => {
        const r = res();
        await listHandler()({ headers: { 'x-api-key': 'k' }, query: {} }, r);
        const leads = r.json.mock.calls[0][0].leads;
        expect(leads[0].website_signals).toEqual([SIGNAL]);
        expect(leads[1].website_signals).toEqual([]);
        expect(signalsForDomains).toHaveBeenCalledWith(ORG, ['acme.example']);
    });

    it('still serves the pull when the signals lookup fails', async () => {
        signalsForDomains.mockRejectedValue(new Error('db down'));
        const r = res();
        await listHandler()({ headers: { 'x-api-key': 'k' }, query: {} }, r);
        expect(r.json.mock.calls[0][0].leads.map((l: any) => l.website_signals)).toEqual([[], []]);
    });
});
