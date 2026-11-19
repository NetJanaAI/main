import { isOrgAdmin } from '../orgRole';

describe('isOrgAdmin', () => {
    it('lets an API-key caller, which has no Clerk identity, act for the organization', () => {
        expect(isOrgAdmin({})).toBe(true);
    });

    it('lets the owner of a personal workspace (token without an organization) in', () => {
        expect(isOrgAdmin({ auth: { sub: 'user_1' } })).toBe(true);
    });

    it('admits org admins in either claim shape', () => {
        expect(isOrgAdmin({ auth: { org_id: 'org_1', org_role: 'org:admin' } })).toBe(true);
        expect(isOrgAdmin({ auth: { org_id: 'org_1', org_role: 'admin' } })).toBe(true);
        expect(isOrgAdmin({ auth: { o: { id: 'org_1', rol: 'admin' } } })).toBe(true);
    });

    it('refuses members in either claim shape', () => {
        expect(isOrgAdmin({ auth: { org_id: 'org_1', org_role: 'org:member' } })).toBe(false);
        expect(isOrgAdmin({ auth: { o: { id: 'org_1', rol: 'member' } } })).toBe(false);
    });

    it('refuses a token that carries an organization but no role', () => {
        expect(isOrgAdmin({ auth: { sub: 'user_1', org_id: 'org_1' } })).toBe(false);
        expect(isOrgAdmin({ auth: { sub: 'user_1', o: { id: 'org_1' } } })).toBe(false);
    });
});
