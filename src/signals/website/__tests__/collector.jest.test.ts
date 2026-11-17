import fs from 'fs';
import path from 'path';
import { collectDomain, collectMany, normalizeDomain } from '../collector';
import type { SignalKey } from '../catalog';
import type { Transport } from '../safeFetch';

const fixture = (n: string) => fs.readFileSync(path.join(__dirname, '..', '__fixtures__', n), 'utf8');
const PUBLIC = '93.184.216.34';
const NOW = new Date('2026-06-01T00:00:00Z');

function site(pages: Record<string, { status?: number; body?: string; type?: string }>) {
    const requested: string[] = [];
    const transport: Transport = async ({ url }) => {
        requested.push(url.href);
        const p = pages[url.href];
        if (!p) return { status: 404, headers: { 'content-type': 'text/html' }, body: '' };
        return { status: p.status ?? 200, headers: { 'content-type': p.type ?? 'text/html' }, body: p.body ?? '' };
    };
    return { requested, fetch: { resolve: async () => [PUBLIC], transport, minHostGapMs: 0 } };
}
const confirmed = (...keys: SignalKey[]) => new Set<SignalKey>(keys);

describe('normalizeDomain', () => {
    it.each([
        ['Example.com', 'example.com'],
        ['https://www.Example.com/about?x=1', 'www.example.com'],
        ['  acme.co.in ', 'acme.co.in'],
    ])('%s', (input, out) => expect(normalizeDomain(input)).toBe(out));

    it.each(['', 'localhost', '127.0.0.1', '10.0.0.1', 'not a domain', 'a..b.com', 'http://[::1]/'])('rejects %j', (input) => {
        expect(normalizeDomain(input)).toBeNull();
    });
});

describe('collectDomain', () => {
    it('collects only the confirmed signals', async () => {
        const s = site({ 'https://sunrise.example/robots.txt': { body: 'User-agent: *\nDisallow:\n', type: 'text/plain' }, 'https://sunrise.example/': { body: fixture('bare-clinic.html') } });
        const r = await collectDomain('sunrise.example', { confirmed: confirmed('no_online_booking', 'running_ads'), now: NOW, fetch: s.fetch });
        expect(r.ok && r.observations.map((o) => o.key)).toEqual(['no_online_booking', 'running_ads']);
    });

    it('reads the blog page for staleness and cites it as evidence', async () => {
        const s = site({
            'https://sunrise.example/robots.txt': { status: 404 },
            'https://sunrise.example/': { body: fixture('bare-clinic.html') },
            'https://sunrise.example/blog': { body: fixture('blog-index.html') },
        });
        const r = await collectDomain('sunrise.example', { confirmed: confirmed('blog_stale'), now: NOW, fetch: s.fetch });
        expect(r.ok && r.observations).toEqual([
            { key: 'blog_stale', value: expect.objectContaining({ present: true }), evidenceUrl: 'https://sunrise.example/blog' },
        ]);
    });

    it('skips a site whose robots.txt disallows us, without fetching the page', async () => {
        const s = site({ 'https://nope.example/robots.txt': { body: 'User-agent: *\nDisallow: /\n', type: 'text/plain' }, 'https://nope.example/': { body: 'x' } });
        const r = await collectDomain('nope.example', { confirmed: confirmed('running_ads'), now: NOW, fetch: s.fetch });
        expect(r).toEqual({ domain: 'nope.example', ok: false, reason: 'Blocked by robots.txt' });
        expect(s.requested).toEqual(['https://nope.example/robots.txt']);
    });

    it('does not crawl a site whose robots.txt is unavailable', async () => {
        const s = site({ 'https://down.example/robots.txt': { status: 503 } });
        const r = await collectDomain('down.example', { confirmed: confirmed('running_ads'), now: NOW, fetch: s.fetch });
        expect(r.ok).toBe(false);
        expect(s.requested).toEqual(['https://down.example/robots.txt']);
    });

    it('reads the public job feed for matching roles', async () => {
        const feed = JSON.stringify({ jobs: [{ title: 'Data Engineer' }, { title: 'Chef' }] });
        const s = site({
            'https://nw.example/robots.txt': { status: 404 },
            'https://nw.example/': { body: fixture('rich-studio.html') },
            'https://boards-api.greenhouse.io/v1/boards/northwind/jobs': { body: feed, type: 'application/json' },
        });
        const r = await collectDomain('nw.example', { confirmed: confirmed('hiring_open_roles'), targetRoles: ['data'], now: NOW, fetch: s.fetch });
        expect(r.ok && r.observations[0].value).toEqual(expect.objectContaining({ present: true, number: 1 }));
    });

    it('reports a private-address redirect as a failure for that domain only', async () => {
        const transport: Transport = async ({ url }) =>
            url.pathname === '/robots.txt'
                ? { status: 404, headers: {}, body: '' }
                : { status: 302, headers: { location: 'http://169.254.169.254/' }, body: '' };
        const r = await collectDomain('evil.example', { confirmed: confirmed('running_ads'), now: NOW, fetch: { resolve: async () => [PUBLIC], transport, minHostGapMs: 0 } });
        expect(r.ok).toBe(false);
    });
});

describe('collectMany', () => {
    it('keeps one slow or failing site from stopping the rest', async () => {
        const transport: Transport = async ({ url }) => {
            if (url.hostname === 'bad.example') throw new Error('connection reset');
            return url.pathname === '/robots.txt'
                ? { status: 404, headers: {}, body: '' }
                : { status: 200, headers: { 'content-type': 'text/html' }, body: fixture('bare-clinic.html') };
        };
        const results = await collectMany(['a.example', 'bad.example', 'c.example'], { confirmed: confirmed('running_ads'), now: NOW, fetch: { resolve: async () => [PUBLIC], transport, minHostGapMs: 0 } }, 2);
        expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    });
});
