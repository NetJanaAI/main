import { tenantUser } from '../tenantUser';

function run(req: any) {
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    tenantUser(req, res, next);
    return { res, next };
}

describe('standalone tenantUser', () => {
    it('ignores tier and organization headers', () => {
        const req: any = {
            organizationId: 'org_real',
            tenantTier: 'free',
            originalUrl: '/api/results',
            headers: { 'x-tier': 'paid', 'x-organization-id': 'org_other' },
        };
        const { next } = run(req);
        expect(next).toHaveBeenCalled();
        expect(req.user).toEqual({ organizationId: 'org_real', tier: 'free' });
    });

    it('uses the tenant plan for the tier and defaults to free', () => {
        const paid: any = { organizationId: 'o', tenantTier: 'paid', originalUrl: '/api/results', headers: {} };
        run(paid);
        expect(paid.user.tier).toBe('paid');

        const bare: any = { organizationId: 'o', originalUrl: '/api/results', headers: {} };
        run(bare);
        expect(bare.user.tier).toBe('free');
    });

    it('rejects a request with no authenticated tenant', () => {
        const { res, next } = run({ originalUrl: '/api/results', headers: { 'x-tier': 'paid', 'x-organization-id': 'demo' } });
        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('leaves ingest to its own authentication', () => {
        const { res, next } = run({ originalUrl: '/api/ingest/gem', headers: {} });
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });
});
