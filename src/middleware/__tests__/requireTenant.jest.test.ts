import fs from 'fs';
import path from 'path';

jest.mock('@clerk/backend', () => ({ createClerkClient: () => ({}), verifyToken: jest.fn() }));
jest.mock('../../lib/database', () => ({ query: jest.fn() }));
jest.mock('../../lib/secrets', () => ({ getHmacSecret: jest.fn(), getApiKeySecret: jest.fn() }));
jest.mock('../../core/compliance/AuditTrail', () => ({ AuditTrail: {} }));

import { requireTenant } from '../tenant';

function run(req: any) {
    const res: any = { status: jest.fn(() => res), json: jest.fn(() => res) };
    const next = jest.fn();
    requireTenant(req, res, next);
    return { res, next };
}

describe('requireTenant', () => {
    it('lets a tenant request through', () => {
        const { next, res } = run({ organizationId: 'org-1' });
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });
    it('returns 401 when there is no tenant, whatever headers are sent', () => {
        const { next, res } = run({ headers: { 'x-organization-id': 'victim-org' } });
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });
});

describe("no 'default' tenant fallback in routes", () => {
    const dir = path.join(__dirname, '..', '..', 'routes');
    const offenders = fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).flatMap((f) =>
        fs.readFileSync(path.join(dir, f), 'utf8').split('\n').flatMap((line, i) =>
            /(rganizationId|orgId)\b.*\|\|\s*['"]default['"]|headers\[['"]x-organization-id['"]\]/.test(line)
                ? [`${f}:${i + 1}: ${line.trim()}`] : []));
    it('routes never invent or accept a tenant id', () => {
        expect(offenders).toEqual([]);
    });
});
