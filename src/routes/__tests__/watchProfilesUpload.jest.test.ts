import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const queryWithOrg = jest.fn().mockResolvedValue({ rows: [] });
jest.mock('../../lib/database', () => ({ queryWithOrg: (...a: any[]) => queryWithOrg(...a) }));

import router from '../watch-profiles';

let server: Server;
let base: string;

beforeAll(async () => {
    const app = express();
    app.use((req, _res, next) => { (req as any).organizationId = '11111111-1111-1111-1111-111111111111'; next(); });
    app.use('/', router);
    await new Promise<void>((r) => { server = app.listen(0, '127.0.0.1', () => r()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => queryWithOrg.mockClear());

function upload(csv: string) {
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'p.csv');
    return fetch(`${base}/upload`, { method: 'POST', body: form });
}

const header = 'keywords,regions,min_amount\n';

describe('watch profile CSV upload is bounded', () => {
    it('accepts a small file', async () => {
        const res = await upload(header + 'steel|copper,MH,1000\n');
        expect(res.status).toBe(200);
        expect((await res.json()).count).toBe(1);
    });

    it('rejects a file with more rows than the cap and inserts nothing', async () => {
        const rows = Array.from({ length: 501 }, (_, i) => `kw${i},MH,0`).join('\n');
        const res = await upload(header + rows + '\n');
        expect(res.status).toBe(400);
        expect(queryWithOrg).not.toHaveBeenCalled();
    });

    it('rejects a file over the size limit', async () => {
        const res = await upload(header + 'x'.repeat(2 * 1024 * 1024));
        expect(res.status).toBe(413);
        expect(queryWithOrg).not.toHaveBeenCalled();
    });

    it('skips a row whose keywords exceed the per-profile limits', async () => {
        const tooMany = Array.from({ length: 101 }, (_, i) => `k${i}`).join('|');
        const res = await upload(header + `${tooMany},MH,0\nsteel,MH,0\n`);
        expect(res.status).toBe(200);
        expect((await res.json()).count).toBe(1);
    });
});
