const queryWithOrg = jest.fn();
const queryAsSystem = jest.fn();
const collectMany = jest.fn();
const getConfirmed = jest.fn();
const saveObservations = jest.fn();
const redisSet = jest.fn();

jest.mock('../../../lib/database', () => ({
    queryWithOrg: (...a: any[]) => queryWithOrg(...a),
    queryAsSystem: (...a: any[]) => queryAsSystem(...a),
}));
jest.mock('../../../lib/redis', () => ({ getSharedRedisClient: () => ({ set: (...a: any[]) => redisSet(...a) }) }));
jest.mock('../collector', () => ({ collectMany: (...a: any[]) => collectMany(...a) }));
jest.mock('../store', () => ({
    getConfirmed: (...a: any[]) => getConfirmed(...a),
    saveObservations: (...a: any[]) => saveObservations(...a),
}));

import { domainLimitFor, refreshAllTenants, refreshTenant } from '../refresh';

const ORG = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
    jest.resetAllMocks();
    redisSet.mockResolvedValue('OK');
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('domainLimitFor', () => {
    it('gives each plan its own cap and treats an unknown plan as free', () => {
        expect(domainLimitFor('free', {})).toBe(25);
        expect(domainLimitFor('paid', {})).toBe(500);
        expect(domainLimitFor(undefined, {})).toBe(25);
        expect(domainLimitFor('mystery', {})).toBe(25);
    });

    it('takes overrides from the environment and ignores bad ones', () => {
        expect(domainLimitFor('paid', { WEBSITE_SIGNALS_DOMAIN_LIMITS: '{"paid":1000}' })).toBe(1000);
        expect(domainLimitFor('free', { WEBSITE_SIGNALS_DOMAIN_LIMITS: '{"paid":1000}' })).toBe(25);
        expect(domainLimitFor('paid', { WEBSITE_SIGNALS_DOMAIN_LIMITS: 'not json' })).toBe(500);
        expect(domainLimitFor('paid', { WEBSITE_SIGNALS_DOMAIN_LIMITS: '{"paid":-3}' })).toBe(500);
    });
});

describe('refreshTenant', () => {
    it('does nothing when the tenant has confirmed no signals', async () => {
        getConfirmed.mockResolvedValue([]);
        expect(await refreshTenant(ORG, 'paid')).toEqual({ refreshed: 0, failed: 0 });
        expect(collectMany).not.toHaveBeenCalled();
    });

    it('refreshes only up to the plan limit, oldest first, and saves the successes', async () => {
        getConfirmed.mockResolvedValue(['running_ads']);
        const domains = Array.from({ length: 30 }, (_, i) => `site${i}.com`);
        queryWithOrg.mockResolvedValue({ rows: domains.map((company_domain) => ({ company_domain })) });
        collectMany.mockImplementation(async (list: string[]) =>
            list.map((domain, i) => (i === 0 ? { domain, ok: false, reason: 'down' } : { domain, ok: true, observations: [{ key: 'running_ads' }] }))
        );

        const out = await refreshTenant(ORG, 'free');

        expect(collectMany.mock.calls[0][0]).toEqual(domains.slice(0, 25));
        expect(collectMany.mock.calls[0][1].confirmed).toEqual(new Set(['running_ads']));
        expect(out).toEqual({ refreshed: 24, failed: 1 });
        expect(saveObservations).toHaveBeenCalledTimes(24);
        expect(saveObservations).not.toHaveBeenCalledWith(ORG, 'site0.com', expect.anything());
    });
});

describe('refreshAllTenants', () => {
    it('does nothing when another instance already holds the daily lock', async () => {
        redisSet.mockResolvedValue(null);
        await refreshAllTenants();
        expect(redisSet).toHaveBeenCalledWith('lock:website-signals-refresh', '1', 'EX', 82800, 'NX');
        expect(queryAsSystem).not.toHaveBeenCalled();
    });

    it('selects only active tenants with confirmations and keeps going when one fails', async () => {
        queryAsSystem.mockResolvedValue({ rows: [{ id: 'a', plan: 'free' }, { id: 'b', plan: 'paid' }] });
        getConfirmed.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce([]);

        await refreshAllTenants();

        expect(queryAsSystem.mock.calls[0][0]).toMatch(/deactivated_at IS NULL/);
        expect(queryAsSystem.mock.calls[0][0]).toMatch(/signal_confirmations/);
        expect(getConfirmed).toHaveBeenCalledTimes(2);
    });
});
