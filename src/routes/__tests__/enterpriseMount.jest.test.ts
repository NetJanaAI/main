export {};
// Billing and seats were only mounted in standalone mode, so production returned 404 for them.
import fs from 'fs';
import http from 'http';
import path from 'path';
import { AddressInfo } from 'net';

jest.mock('../../lib/database', () => ({
    query: jest.fn().mockResolvedValue({ rows: [{ razorpay_subscription_id: 'sub_1', razorpay_subscription_status: 'active' }] }),
    queryWithOrg: jest.fn().mockResolvedValue({ rows: [] }),
    withOrgTransaction: jest.fn(),
    db: { query: jest.fn() },
}));
jest.mock('../../standalone/services/RazorpayService', () => ({ RazorpayService: {} }));

const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.ts'), 'utf8');

describe('server.ts', () => {
    it('mounts /api/enterprise, and does so after tenantContext so req.organizationId is set', () => {
        const mount = server.search(/app\.use\(\s*'\/api\/enterprise'/);
        const tenant = server.search(/app\.use\(\s*tenantContext\s*\)/);
        expect(mount).toBeGreaterThan(-1);
        expect(tenant).toBeGreaterThan(-1);
        expect(mount).toBeGreaterThan(tenant);
        expect(server).toMatch(/import enterpriseRoutes from '\.\/routes\/enterprise'/);
    });
});

describe('the mounted enterprise router behind a tenant gate', () => {
    // A stand-in for tenantContext: authenticated callers get an organizationId, others get 401.
    function listen() {
        const express = require('express');
        const app = express();
        app.use(express.json());
        app.use((req: any, res: any, next: any) => {
            if (req.headers['x-test-org']) { req.organizationId = req.headers['x-test-org']; return next(); }
            res.status(401).json({ error: 'Unauthorized' });
        });
        app.use('/api/enterprise', require('../enterprise').default);
        return new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
    }
    const get = async (s: http.Server, url: string, headers: Record<string, string> = {}) =>
        fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}${url}`, { headers });

    it.each(['/api/enterprise/billing', '/api/enterprise/seats'])('%s is reachable for a tenant and closed to anonymous callers', async (url) => {
        const s = await listen();
        try {
            expect((await get(s, url)).status).toBe(401);
            expect((await get(s, url, { 'x-test-org': '11111111-1111-1111-1111-111111111111' })).status).toBe(200);
        } finally {
            s.close();
        }
    });
});
