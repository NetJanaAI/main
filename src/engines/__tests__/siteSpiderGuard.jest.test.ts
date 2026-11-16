export {};

const pages: Record<string, { status: number; data: string }> = {};
const safeGet = jest.fn(async (url: string) => {
    if (url.includes('internal')) throw new Error('Blocked URL: private');
    return { status: pages[url]?.status ?? 404, headers: {}, data: pages[url]?.data ?? '' };
});
const validateTargetUrl = jest.fn(async (url: string) => ({ isValid: !url.includes('blocked') }));
jest.mock('../../middleware/urlValidator', () => ({ safeGet: (u: string) => safeGet(u), validateTargetUrl: (u: string) => validateTargetUrl(u) }));

import { discoverUrls } from '../siteSpider';

beforeEach(() => { safeGet.mockClear(); for (const k of Object.keys(pages)) delete pages[k]; });

describe('discoverUrls', () => {
    it('only accepts same-origin https links from the sitemap, not look-alike hosts', async () => {
        pages['https://a.com/sitemap.xml'] = {
            status: 200,
            data: '<loc>https://a.com/about</loc><loc>https://a.com.evil.test/x</loc><loc>http://a.com/plain</loc><loc>https://internal.a.com/y</loc>',
        };
        const urls = await discoverUrls('https://a.com', 10);
        expect(urls).toContain('https://a.com/about');
        expect(urls).not.toContain('https://a.com.evil.test/x');
        expect(urls).not.toContain('http://a.com/plain');
        expect(urls).not.toContain('https://internal.a.com/y');
    });

    it('fetches only through safeGet and drops URLs that fail validation', async () => {
        pages['https://a.com/sitemap.xml'] = { status: 200, data: '<loc>https://a.com/blocked-page</loc><loc>https://a.com/team</loc>' };
        const urls = await discoverUrls('https://a.com', 10);
        expect(safeGet).toHaveBeenCalled();
        expect(urls).toContain('https://a.com/team');
        expect(urls).not.toContain('https://a.com/blocked-page');
    });
});
