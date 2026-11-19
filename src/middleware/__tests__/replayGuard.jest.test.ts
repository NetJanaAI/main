import crypto from 'crypto';

const set = jest.fn();
jest.mock('../../lib/redis', () => ({ getSharedRedisClient: () => ({ set: (...a: any[]) => set(...a) }) }));

import { replayGuard } from '../replayGuard';

const SECRET = 'test-secret';

function sign(ts: string, nonce: string, body: string) {
    return crypto.createHmac('sha256', SECRET).update(`${ts}.${nonce}.${body}`, 'utf8').digest('hex');
}

function run(signature: string, body = '{"a":1}') {
    const ts = String(Math.floor(Date.now() / 1000));
    const req: any = {
        headers: { 'x-netjana-timestamp': ts, 'x-netjana-nonce': 'n1', 'x-netjana-signature': signature },
        rawBody: Buffer.from(body),
    };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    return { req, res, next, ts };
}

describe('replayGuard', () => {
    beforeEach(() => {
        process.env.NETJANA_HMAC_SECRET = SECRET;
        set.mockReset().mockResolvedValue('OK');
    });
    afterAll(() => { delete process.env.NETJANA_HMAC_SECRET; });

    it('does not store a nonce for an invalidly signed request', async () => {
        const { req, res, next } = run('00'.repeat(32));
        await replayGuard(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(set).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    it('stores the nonce and continues for a valid signature', async () => {
        const probe = run('');
        const sig = sign(probe.ts, 'n1', '{"a":1}');
        probe.req.headers['x-netjana-signature'] = sig;
        await replayGuard(probe.req, probe.res, probe.next);
        expect(set).toHaveBeenCalledWith('nonce:push:n1', '1', 'EX', 600, 'NX');
        expect(probe.next).toHaveBeenCalled();
    });

    it('rejects a replayed nonce', async () => {
        set.mockResolvedValue(null);
        const probe = run('');
        probe.req.headers['x-netjana-signature'] = sign(probe.ts, 'n1', '{"a":1}');
        await replayGuard(probe.req, probe.res, probe.next);
        expect(probe.res.status).toHaveBeenCalledWith(401);
        expect(probe.next).not.toHaveBeenCalled();
    });
});
