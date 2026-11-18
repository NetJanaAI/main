export {};
const store = {
    getConfirmed: jest.fn(), setConfirmed: jest.fn(), observedCounts: jest.fn(), saveObservations: jest.fn(), cohort: jest.fn(),
};
const collectMany = jest.fn();
const queryWithOrg = jest.fn();
const trackedDomains = jest.fn();

jest.mock('../../signals/website/store', () => store);
jest.mock('../../signals/website/collector', () => ({ ...jest.requireActual('../../signals/website/collector'), collectMany }));
jest.mock('../../lib/database', () => ({ queryWithOrg }));
jest.mock('../../signals/website/refresh', () => ({ ...jest.requireActual('../../signals/website/refresh'), trackedDomains }));

const ORG = '11111111-1111-1111-1111-111111111111';
const LEAD = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const admin = { organizationId: ORG, auth: { org_role: 'org:admin' } };
const member = { organizationId: ORG, auth: { org_role: 'org:member' } };

function handler(method: string, p: string) {
    const router = require('../websiteSignals').default;
    const layer = router.stack.find((l: any) => l.route && l.route.path === p && l.route.methods[method]);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}
const res = () => { const r: any = {}; r.status = jest.fn(() => r); r.json = jest.fn(() => r); return r; };

beforeEach(() => {
    Object.values(store).forEach((m) => m.mockReset());
    store.getConfirmed.mockResolvedValue(['running_ads', 'no_online_booking']);
    store.observedCounts.mockResolvedValue({ running_ads: 4 });
    store.cohort.mockResolvedValue({ count: 2, domains: ['a.example', 'b.example'] });
    collectMany.mockReset().mockResolvedValue([]);
    queryWithOrg.mockReset().mockResolvedValue({ rows: [] });
    trackedDomains.mockReset().mockResolvedValue([]);
});

describe('every route needs a tenant', () => {
    it.each([['get', '/catalog'], ['put', '/confirmed'], ['post', '/collect'], ['post', '/cohort']])('%s %s', async (m, p) => {
        const r = res();
        await handler(m, p)({ body: {} }, r);
        expect(r.status).toHaveBeenCalledWith(401);
    });
});

describe('GET /catalog', () => {
    it('lists each signal with cost, confirmation and observed counts', async () => {
        const r = res();
        await handler('get', '/catalog')(admin, r);
        const { signals } = r.json.mock.calls[0][0];
        const ads = signals.find((s: any) => s.key === 'running_ads');
        expect(ads).toEqual(expect.objectContaining({ cost: 'free', confirmed: true, companies_observed: 4 }));
        expect(signals.find((s: any) => s.key === 'tech_stack')).toEqual(expect.objectContaining({ confirmed: false, companies_observed: 0 }));
        expect(store.getConfirmed).toHaveBeenCalledWith(ORG);
    });
});

describe('PUT /confirmed', () => {
    it('is for org admins only', async () => {
        const r = res();
        await handler('put', '/confirmed')({ ...member, body: { signals: ['running_ads'] } }, r);
        expect(r.status).toHaveBeenCalledWith(403);
        expect(store.setConfirmed).not.toHaveBeenCalled();
    });
    it('stores a de-duplicated set for the tenant', async () => {
        await handler('put', '/confirmed')({ ...admin, body: { signals: ['running_ads', 'running_ads'] } }, res());
        expect(store.setConfirmed).toHaveBeenCalledWith(ORG, ['running_ads']);
    });
    it('rejects an unknown signal', async () => {
        const r = res();
        await handler('put', '/confirmed')({ ...admin, body: { signals: ['linkedin_scrape'] } }, r);
        expect(r.status).toHaveBeenCalledWith(400);
    });
});

describe('POST /collect', () => {
    it('refuses until at least one signal is confirmed', async () => {
        store.getConfirmed.mockResolvedValue([]);
        const r = res();
        await handler('post', '/collect')({ ...admin, body: { targets: [{ domain: 'a.example' }] } }, r);
        expect(r.status).toHaveBeenCalledWith(409);
        expect(collectMany).not.toHaveBeenCalled();
    });

    it('collects only the confirmed signals, for normalized domains, and saves under the tenant', async () => {
        collectMany.mockResolvedValue([{ domain: 'a.example', ok: true, observations: [{ key: 'running_ads', value: { present: true }, evidenceUrl: 'https://a.example/' }] }]);
        const r = res();
        await handler('post', '/collect')({ ...admin, body: { targets: [{ domain: 'https://A.example/x', lead_id: LEAD }, { domain: '127.0.0.1' }] } }, r);

        expect(collectMany.mock.calls[0][0]).toEqual(['a.example']);
        expect([...collectMany.mock.calls[0][1].confirmed].sort()).toEqual(['no_online_booking', 'running_ads']);
        expect(store.saveObservations).toHaveBeenCalledWith(ORG, 'a.example', expect.any(Array));
        const link = queryWithOrg.mock.calls[0];
        expect(link[0]).toMatch(/UPDATE lead_cards SET company_domain = \$1 WHERE lead_id = \$2 AND org_id = \$3/);
        expect(link[1]).toEqual(['a.example', LEAD, ORG]);
        expect(r.json).toHaveBeenCalledWith({
            results: [{ domain: 'a.example', ok: true, signals: 1 }],
            rejected: [{ input: '127.0.0.1', reason: 'Not a valid domain name' }],
        });
    });

    it('reports a failed domain without saving anything for it', async () => {
        collectMany.mockResolvedValue([{ domain: 'a.example', ok: false, reason: 'Blocked by robots.txt' }]);
        const r = res();
        await handler('post', '/collect')({ ...admin, body: { targets: [{ domain: 'a.example' }] } }, r);
        expect(store.saveObservations).not.toHaveBeenCalled();
        expect(r.json.mock.calls[0][0].results[0]).toEqual({ domain: 'a.example', ok: false, reason: 'Blocked by robots.txt' });
    });

    it('refuses new companies beyond the plan limit but lets tracked ones refresh', async () => {
        trackedDomains.mockResolvedValue(Array.from({ length: 25 }, (_, i) => `t${i}.example`));
        const over = res();
        await handler('post', '/collect')({ ...admin, tenantTier: 'free', body: { targets: [{ domain: 'new.example' }] } }, over);
        expect(over.status).toHaveBeenCalledWith(409);
        expect(collectMany).not.toHaveBeenCalled();

        const again = res();
        await handler('post', '/collect')({ ...admin, tenantTier: 'free', body: { targets: [{ domain: 't3.example' }] } }, again);
        expect(again.status).not.toHaveBeenCalled();
        expect(collectMany).toHaveBeenCalled();
    });

    it('allows more companies on a paid plan', async () => {
        trackedDomains.mockResolvedValue(Array.from({ length: 25 }, (_, i) => `t${i}.example`));
        const r = res();
        await handler('post', '/collect')({ ...admin, tenantTier: 'paid', body: { targets: [{ domain: 'new.example' }] } }, r);
        expect(r.status).not.toHaveBeenCalled();
    });

    it('limits a request to 10 domains', async () => {
        const r = res();
        const targets = Array.from({ length: 11 }, (_, i) => ({ domain: `s${i}.example` }));
        await handler('post', '/collect')({ ...admin, body: { targets } }, r);
        expect(r.status).toHaveBeenCalledWith(400);
    });
});

describe('POST /cohort', () => {
    it('returns the live count for the tenant', async () => {
        const r = res();
        await handler('post', '/cohort')({ ...admin, body: { must_have: ['running_ads'], must_not_have: ['no_online_booking'] } }, r);
        expect(store.cohort).toHaveBeenCalledWith(ORG, { mustHave: ['running_ads'], mustNotHave: ['no_online_booking'], ranges: [] });
        expect(r.json).toHaveBeenCalledWith({ count: 2, domains: ['a.example', 'b.example'] });
    });
    it('refuses a signal the tenant has not confirmed', async () => {
        const r = res();
        await handler('post', '/cohort')({ ...admin, body: { must_have: ['tech_stack'] } }, r);
        expect(r.status).toHaveBeenCalledWith(409);
        expect(store.cohort).not.toHaveBeenCalled();
    });
});
