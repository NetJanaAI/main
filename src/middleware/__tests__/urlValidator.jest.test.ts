import http from 'http';
import { AddressInfo } from 'net';
import { chromium } from 'playwright';
import net from 'net';
import { isBlockedAddress, validateTargetUrl, safeGet } from '../urlValidator';
import { startGuardProxy, GuardProxy } from '../../lib/guardProxy';

jest.setTimeout(60000);

const dnsTable = (map: Record<string, string[]>) => async (host: string) => {
    if (!map[host]) throw new Error(`ENOTFOUND ${host}`);
    return map[host];
};

describe('isBlockedAddress', () => {
    const blocked = [
        '0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255', '100.64.0.1', '100.127.255.254',
        '127.0.0.1', '127.255.255.254', '169.254.169.254', '172.16.0.1', '172.31.255.255',
        '192.0.0.1', '192.168.1.1', '198.18.0.1', '224.0.0.1', '240.0.0.1', '255.255.255.255',
        '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1',
        '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a9fe:a9fe',
        '64:ff9b::7f00:1', '2002:7f00:1::', '2001:db8::1',
    ];
    const allowed = ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.255.255', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'];
    it.each(blocked)('blocks %s', (addr) => expect(isBlockedAddress(addr)).toBe(true));
    it.each(allowed)('allows %s', (addr) => expect(isBlockedAddress(addr)).toBe(false));
    it('blocks anything that is not an IP address', () => expect(isBlockedAddress('not-an-ip')).toBe(true));
});

describe('validateTargetUrl', () => {
    const resolve = dnsTable({
        'example.com': ['93.184.216.34'],
        'v6only.example': ['2606:4700:4700::1111'],
        'internal.example': ['10.0.0.5'],
        'mixed.example': ['93.184.216.34', '10.0.0.5'],
        'mixed6.example': ['93.184.216.34', 'fe80::1'],
        'metadata.example': ['169.254.169.254'],
        'loop6.example': ['::1'],
        'mapped.example': ['::ffff:127.0.0.1'],
    });
    const cases: [string, string, boolean][] = [
        ['public host', 'https://example.com/path', true],
        ['public IPv6-only host', 'https://v6only.example/', true],
        ['IPv4 loopback literal', 'https://127.0.0.1/', false],
        ['10.x literal', 'https://10.1.2.3/', false],
        ['cloud metadata literal', 'https://169.254.169.254/latest/meta-data/', false],
        ['IPv6 loopback literal', 'https://[::1]/', false],
        ['IPv4-mapped IPv6 literal', 'https://[::ffff:127.0.0.1]/', false],
        ['decimal-encoded loopback', 'https://2130706433/', false],
        ['shorthand loopback', 'https://127.1/', false],
        ['0.0.0.0', 'https://0.0.0.0/', false],
        ['CGNAT literal', 'https://100.64.0.1/', false],
        ['host resolving to a private IP', 'https://internal.example/', false],
        ['host resolving to metadata IP', 'https://metadata.example/', false],
        ['host resolving to ::1', 'https://loop6.example/', false],
        ['host resolving to a mapped loopback', 'https://mapped.example/', false],
        ['multi-record DNS with one private IPv4', 'https://mixed.example/', false],
        ['multi-record DNS with one link-local IPv6', 'https://mixed6.example/', false],
        ['http scheme', 'http://example.com/', false],
        ['file scheme', 'file:///etc/passwd', false],
        ['embedded credentials', 'https://user:pw@example.com/', false],
        ['unresolvable host', 'https://nope.example/', false],
        ['garbage', 'not a url', false],
    ];
    it.each(cases)('%s', async (_name, url, ok) => {
        expect((await validateTargetUrl(url, resolve)).isValid).toBe(ok);
    });
});

describe('safeGet', () => {
    const resolve = dnsTable({ 'example.com': ['93.184.216.34'], 'internal.example': ['10.0.0.5'], 'other.example': ['93.184.216.35'] });
    const respond = (routes: Record<string, any>) => jest.fn(async (url: string) => {
        if (!routes[url]) throw new Error(`unexpected request to ${url}`);
        return routes[url];
    });

    it('returns the body for a public URL', async () => {
        const request = respond({ 'https://example.com/': { status: 200, headers: {}, data: 'ok' } });
        expect((await safeGet('https://example.com/', { resolve, request })).data).toBe('ok');
    });
    it('refuses a redirect to a private IP and never requests it', async () => {
        const request = respond({
            'https://example.com/': { status: 302, headers: { location: 'https://internal.example/admin' }, data: '' },
            'https://internal.example/admin': { status: 200, headers: {}, data: 'secret' },
        });
        await expect(safeGet('https://example.com/', { resolve, request })).rejects.toThrow(/Blocked/);
        expect(request).toHaveBeenCalledTimes(1);
    });
    it('refuses a redirect to a metadata literal on a later hop', async () => {
        const request = respond({
            'https://example.com/': { status: 301, headers: { location: 'https://other.example/x' }, data: '' },
            'https://other.example/x': { status: 307, headers: { location: 'https://169.254.169.254/' }, data: '' },
        });
        await expect(safeGet('https://example.com/', { resolve, request })).rejects.toThrow(/Blocked/);
    });
    it('follows safe redirects and caps the hop count', async () => {
        const loop = respond({ 'https://example.com/': { status: 302, headers: { location: 'https://example.com/' }, data: '' } });
        await expect(safeGet('https://example.com/', { resolve, request: loop })).rejects.toThrow(/redirect/i);
        const ok = respond({
            'https://example.com/': { status: 302, headers: { location: '/next' }, data: '' },
            'https://example.com/next': { status: 200, headers: {}, data: 'done' },
        });
        expect((await safeGet('https://example.com/', { resolve, request: ok })).data).toBe('done');
    });
});

describe('guard proxy (real Chromium and raw CONNECT)', () => {
    let secretHits = 0;
    let publicHits = 0;
    let server: http.Server;
    let port: number;
    let proxy: GuardProxy;

    // a.test is public but physically served from the loopback test server; b.test resolves to a private address.
    const resolve = dnsTable({ 'a.test': ['127.0.0.1'], 'b.test': ['10.0.0.5'], 'c.test': ['93.184.216.34', '10.0.0.5'] });
    const isBlocked = (addr: string) => (addr === '127.0.0.1' ? false : isBlockedAddress(addr));

    beforeAll(async () => {
        server = http.createServer((req, res) => {
            if (req.headers.host?.startsWith('b.test')) { secretHits++; res.end('secret'); return; }
            publicHits++;
            if (req.url === '/redirect') { res.writeHead(302, { location: `http://b.test:${port}/secret` }); res.end(); return; }
            if (req.url === '/subresource') { res.setHeader('content-type', 'text/html'); res.end(`<img src="http://b.test:${port}/pixel">`); return; }
            res.end('public');
        });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        port = (server.address() as AddressInfo).port;
        proxy = await startGuardProxy({ resolve, isBlocked });
    });
    afterAll(async () => { await proxy.close(); await new Promise<void>((r) => server.close(() => r())); });
    beforeEach(() => { secretHits = 0; publicHits = 0; });

    async function withPage(fn: (page: import('playwright').Page) => Promise<void>) {
        const browser = await chromium.launch({ proxy: { server: proxy.url, bypass: '<-loopback>' } });
        try { await fn(await (await browser.newContext()).newPage()); } finally { await browser.close(); }
    }

    it('lets a public page load', async () => {
        await withPage(async (page) => { await page.goto(`http://a.test:${port}/`); expect(await page.content()).toContain('public'); });
        expect(publicHits).toBe(1);
    });
    it('blocks a redirect to a private address', async () => {
        await withPage(async (page) => {
            const response = await page.goto(`http://a.test:${port}/redirect`);
            expect(response?.status()).toBe(403);
        });
        expect(secretHits).toBe(0);
    });
    it('blocks a sub-resource on a private address', async () => {
        await withPage(async (page) => { await page.goto(`http://a.test:${port}/subresource`, { waitUntil: 'networkidle' }); });
        expect(secretHits).toBe(0);
    });
    it('blocks loopback itself when it is not explicitly allowed', async () => {
        const strict = await startGuardProxy({ resolve });
        try {
            const status = await connectStatus(strict.url, `127.0.0.1:${port}`);
            expect(status).toBe(403);
        } finally { await strict.close(); }
    });

    function connectStatus(proxyUrl: string, target: string, then?: string): Promise<number | string> {
        return new Promise((resolveStatus, reject) => {
            const { port: proxyPort } = new URL(proxyUrl);
            const socket = net.connect(Number(proxyPort), '127.0.0.1', () => socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
            let buffer = '';
            let sent = false;
            socket.on('data', (d) => {
                buffer += d.toString();
                const status = Number(buffer.match(/^HTTP\/1\.1 (\d+)/)?.[1]);
                if (status === 200 && then && !sent) { sent = true; socket.write(then); buffer = ''; return; }
                if (status !== 200 || !then) { socket.destroy(); resolveStatus(status); }
                else if (buffer.includes('public')) { socket.destroy(); resolveStatus(buffer); }
            });
            socket.on('error', reject);
        });
    }

    it('refuses CONNECT to a private address and to a multi-record host with one private IP', async () => {
        expect(await connectStatus(proxy.url, 'b.test:443')).toBe(403);
        expect(await connectStatus(proxy.url, 'c.test:443')).toBe(403);
        expect(await connectStatus(proxy.url, '[::1]:443')).toBe(403);
    });
    it('tunnels CONNECT to a public host', async () => {
        const body = await connectStatus(proxy.url, `a.test:${port}`, 'GET / HTTP/1.1\r\nHost: a.test\r\nConnection: close\r\n\r\n');
        expect(String(body)).toContain('public');
    });
});
