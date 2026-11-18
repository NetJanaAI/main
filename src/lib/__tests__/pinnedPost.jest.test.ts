import { EventEmitter } from 'events';

const request = jest.fn();
jest.mock('https', () => ({ __esModule: true, default: { request: (...a: any[]) => request(...a) } }));

import { pinnedPost } from '../pinnedPost';

function fakeRequest(status: number, body: string) {
    request.mockImplementation((_url: URL, _opts: any, onResponse: (res: any) => void) => {
        const req: any = new EventEmitter();
        req.end = () => {
            const res: any = new EventEmitter();
            res.statusCode = status;
            res.destroy = jest.fn();
            onResponse(res);
            res.emit('data', Buffer.from(body));
            res.emit('end');
        };
        return req;
    });
}

describe('pinnedPost', () => {
    beforeEach(() => request.mockReset());

    it('connects to the given address whatever the hostname would resolve to', async () => {
        fakeRequest(200, '{"ok":true}');
        const res = await pinnedPost('https://tenant.example.com/hook', { address: '203.0.113.7', headers: {}, body: '{}', timeoutMs: 1000 });

        const options = request.mock.calls[0][1];
        const single = jest.fn();
        options.lookup('tenant.example.com', {}, single);
        expect(single).toHaveBeenCalledWith(null, '203.0.113.7', 4);
        const all = jest.fn();
        options.lookup('tenant.example.com', { all: true }, all);
        expect(all).toHaveBeenCalledWith(null, [{ address: '203.0.113.7', family: 4 }]);

        expect(res.ok).toBe(true);
        expect(await res.json()).toEqual({ ok: true });
    });

    it('reports a non-2xx status without following it', async () => {
        fakeRequest(302, 'moved');
        const res = await pinnedPost('https://tenant.example.com/hook', { address: '2001:db8::1', headers: {}, body: '{}', timeoutMs: 1000 });
        expect(res.ok).toBe(false);
        expect(res.status).toBe(302);
        expect(request.mock.calls[0][1].method).toBe('POST');
        const single = jest.fn();
        request.mock.calls[0][1].lookup('x', {}, single);
        expect(single).toHaveBeenCalledWith(null, '2001:db8::1', 6);
    });
});
