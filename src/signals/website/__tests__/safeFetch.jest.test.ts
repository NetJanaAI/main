import { fetchPublicText, FetchRefusedError, type Transport } from '../safeFetch';
import { parseRobots, loadRobots } from '../robots';

const PUBLIC = '93.184.216.34';
const ok = (body = '<html></html>', headers: Record<string, string> = {}) => ({ status: 200, headers: { 'content-type': 'text/html', ...headers }, body });

function setup(dns: Record<string, string[]>, pages: Record<string, ReturnType<typeof ok> | any>) {
    const calls: { url: string; address: string }[] = [];
    const transport: Transport = jest.fn(async ({ url, address }) => {
        calls.push({ url: url.href, address });
        const page = pages[url.href];
        if (!page) throw new Error(`unexpected request ${url.href}`);
        return page;
    });
    const resolve = async (h: string) => {
        if (!dns[h]) throw new Error('ENOTFOUND');
        return dns[h];
    };
    return { calls, transport, resolve, opts: { resolve, transport, minHostGapMs: 0 } };
}

describe('fetchPublicText blocks', () => {
    const cases: [string, string, Record<string, string[]>][] = [
        ['loopback literal', 'http://127.0.0.1/', {}],
        ['10.x literal', 'http://10.0.0.5/', {}],
        ['cloud metadata', 'http://169.254.169.254/latest/meta-data/', {}],
        ['IPv6 loopback', 'http://[::1]/', {}],
        ['IPv4-mapped IPv6 private', 'http://[::ffff:10.0.0.1]/', {}],
        ['name that resolves to loopback (rebinding style)', 'http://127.0.0.1.nip.io/', { '127.0.0.1.nip.io': ['127.0.0.1'] }],
        ['name with one public and one private record', 'http://mixed.example/', { 'mixed.example': [PUBLIC, '10.1.1.1'] }],
        ['file scheme', 'file:///etc/passwd', {}],
        ['ftp scheme', 'ftp://example.com/', {}],
        ['credentials in the URL', 'http://user:pw@example.com/', { 'example.com': [PUBLIC] }],
        ['non-web port', 'http://example.com:6379/', { 'example.com': [PUBLIC] }],
    ];
    it.each(cases)('%s', async (_name, url, dns) => {
        const { opts, transport } = setup(dns, {});
        await expect(fetchPublicText(url, opts)).rejects.toThrow(FetchRefusedError);
        expect(transport).not.toHaveBeenCalled();
    });

    it('re-checks every redirect hop: a redirect to a private IP is refused', async () => {
        const { opts, calls } = setup(
            { 'example.com': [PUBLIC] },
            { 'http://example.com/': { status: 302, headers: { location: 'http://169.254.169.254/latest/' }, body: '' } }
        );
        await expect(fetchPublicText('http://example.com/', opts)).rejects.toThrow(/non-public/i);
        expect(calls).toHaveLength(1);
    });

    it('caps redirects', async () => {
        const loop = { status: 302, headers: { location: '/again' }, body: '' };
        const { opts } = setup({ 'example.com': [PUBLIC] }, { 'http://example.com/': loop, 'http://example.com/again': loop });
        await expect(fetchPublicText('http://example.com/', { ...opts, maxRedirects: 3 })).rejects.toThrow(/Too many redirects/);
    });

    it('connects to the address it validated, not a later DNS answer', async () => {
        const answers = [[PUBLIC], ['10.0.0.9']];
        const calls: string[] = [];
        const transport: Transport = async ({ address }) => { calls.push(address); return ok(); };
        await fetchPublicText('http://flip.example/', { resolve: async () => answers.shift()!, transport, minHostGapMs: 0 });
        expect(calls).toEqual([PUBLIC]);
    });
});

describe('fetchPublicText allows', () => {
    it('fetches a public page and follows a safe redirect', async () => {
        const { opts, calls } = setup(
            { 'example.com': [PUBLIC], 'www.example.com': [PUBLIC] },
            {
                'http://example.com/': { status: 301, headers: { location: 'https://www.example.com/' }, body: '' },
                'https://www.example.com/': ok('<html>hi</html>'),
            }
        );
        const page = await fetchPublicText('http://example.com/', opts);
        expect(page.body).toBe('<html>hi</html>');
        expect(page.url).toBe('https://www.example.com/');
        expect(calls.every((c) => c.address === PUBLIC)).toBe(true);
    });
});

describe('pinned transport limits', () => {
    // These run the real transport against a local server through a resolver that is allowed to hit loopback.
    const http = require('http');
    let server: any;
    let port: number;
    beforeAll(async () => {
        server = http.createServer((req: any, res: any) => {
            if (req.url === '/big') { res.setHeader('content-type', 'text/html'); res.end('x'.repeat(5000)); }
            else if (req.url === '/bin') { res.setHeader('content-type', 'application/octet-stream'); res.end('abc'); }
            else { res.setHeader('content-type', 'text/html'); res.end('ok'); }
        }).listen(0);
        await new Promise((r) => server.once('listening', r));
        port = server.address().port;
    });
    afterAll(() => new Promise((r) => server.close(r)));

    const { pinnedTransport } = require('../safeFetch');
    const call = (path: string, maxBytes: number) =>
        pinnedTransport({ url: new URL(`http://localhost:${port}${path}`), address: '127.0.0.1', family: 4, timeoutMs: 2000, maxBytes, headers: {} });

    it('refuses an oversized body', async () => {
        await expect(call('/big', 1000)).rejects.toThrow(/larger than/);
    });
    it('refuses a non-text content type', async () => {
        await expect(call('/bin', 1000)).rejects.toThrow(/Content type/);
    });
    it('reads a small text page', async () => {
        expect((await call('/', 1000)).body).toBe('ok');
    });
});

describe('robots.txt', () => {
    it('a disallow for everyone blocks the path; longer allow wins', () => {
        const r = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/public\n');
        expect(r.allows('/')).toBe(true);
        expect(r.allows('/private/x')).toBe(false);
        expect(r.allows('/private/public/page')).toBe(true);
    });

    it('our own group overrides the wildcard group', () => {
        const r = parseRobots('User-agent: *\nDisallow:\n\nUser-agent: NetJanaSignalsBot\nDisallow: /\n');
        expect(r.allows('/')).toBe(false);
    });

    it('supports * and $ in patterns', () => {
        const r = parseRobots('User-agent: *\nDisallow: /*.pdf$\n');
        expect(r.allows('/a/b.pdf')).toBe(false);
        expect(r.allows('/a/b.pdf?x=1')).toBe(true);
    });

    it('loadRobots: 404 allows all, 5xx or network error means do not crawl', async () => {
        const make = (res: any) => setup({ 'example.com': [PUBLIC] }, { 'http://example.com/robots.txt': res }).opts;
        expect((await loadRobots('http://example.com', make({ status: 404, headers: { 'content-type': 'text/plain' }, body: '' }))).allows('/x')).toBe(true);
        await expect(loadRobots('http://example.com', make({ status: 503, headers: { 'content-type': 'text/plain' }, body: '' }))).rejects.toThrow(/unavailable/);
        await expect(loadRobots('http://nope.example', { resolve: async () => { throw new Error('ENOTFOUND'); }, minHostGapMs: 0 })).rejects.toThrow(/unavailable/);
    });
});
