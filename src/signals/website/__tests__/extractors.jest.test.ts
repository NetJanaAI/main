import fs from 'fs';
import path from 'path';
import {
    extractNoOnlineBooking, extractRunningAds, extractNoStructuredData, extractBlogStale, extractBlocksAiCrawlers,
    extractTechStack, findJobBoard, jobTitles, extractHiring, extractContactForm, extractSelfStatedFunding, findBlogUrl,
} from '../extractors';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, '..', '__fixtures__', name), 'utf8');
const bare = fixture('bare-clinic.html');
const rich = fixture('rich-studio.html');
const blog = fixture('blog-index.html');
const NOW = new Date('2026-06-01T00:00:00Z');

describe('a bare clinic site', () => {
    it('has no online booking', () => expect(extractNoOnlineBooking(bare).present).toBe(true));
    it('runs Google and Meta ads', () => {
        const v = extractRunningAds(bare);
        expect(v.present).toBe(true);
        expect(v.detail?.networks).toEqual(['google_ads', 'meta_ads']);
    });
    it('has no structured data', () => expect(extractNoStructuredData(bare).present).toBe(true));
    it('is on WordPress', () => expect(extractTechStack(bare).detail?.technologies).toEqual(['wordpress']));
    it('links a blog and a contact page', () => {
        expect(findBlogUrl(bare, 'https://sunrise.example/')).toBe('https://sunrise.example/blog');
        const c = extractContactForm(bare, 'https://sunrise.example/');
        expect(c.value.present).toBe(true);
        expect(c.evidenceUrl).toBe('https://sunrise.example/contact-us');
    });
    it('records a funding mention only as our own label, never the page text', () => {
        const v = extractSelfStatedFunding(bare);
        expect(v.detail?.mentions).toEqual(['Y Combinator']);
        expect(JSON.stringify(v)).not.toMatch(/ignore previous|system prompt/i);
    });
});

describe('a rich studio site', () => {
    it('has online booking', () => expect(extractNoOnlineBooking(rich).present).toBe(false));
    it('runs no ads', () => expect(extractRunningAds(rich).present).toBe(false));
    it('has structured data', () => expect(extractNoStructuredData(rich).present).toBe(false));
    it('detects Next.js', () => expect(extractTechStack(rich).detail?.technologies).toEqual(['nextjs']));
    it('has a contact form on the page', () => expect(extractContactForm(rich, 'https://nw.example/').value.detail).toEqual({ kind: 'form' }));
    it('links a Greenhouse board', () => {
        expect(findJobBoard(rich)).toEqual({
            platform: 'greenhouse', org: 'northwind',
            boardUrl: 'https://boards.greenhouse.io/northwind',
            feedUrl: 'https://boards-api.greenhouse.io/v1/boards/northwind/jobs',
        });
    });
    it('no funding mention', () => expect(extractSelfStatedFunding(rich).present).toBe(false));
});

describe('stale blog', () => {
    it('is stale when the newest post is older than 12 months', () => {
        const v = extractBlogStale(blog, NOW)!;
        expect(v.present).toBe(true);
        expect(v.number).toBeGreaterThanOrEqual(39);
        expect(v.detail?.last_post_at).toBe('2023-02-10T09:00:00.000Z');
    });
    it('is fresh when a post is recent', () => {
        expect(extractBlogStale('<time datetime="2026-05-20">x</time>', NOW)!.present).toBe(false);
    });
    it('is unknown, not stale, when no post is dated', () => {
        expect(extractBlogStale('<p>no dates here</p>', NOW)).toBeNull();
    });
    it('ignores a date in the future', () => {
        expect(extractBlogStale('<time datetime="2030-01-01">x</time>', NOW)).toBeNull();
    });
});

describe('AI crawler blocking', () => {
    it('finds crawlers disallowed from the whole site', () => {
        const v = extractBlocksAiCrawlers('User-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\n');
        expect(v.present).toBe(true);
        expect(v.detail?.crawlers).toEqual(['ccbot', 'gptbot']);
    });
    it('does not count a wildcard or a partial disallow', () => {
        expect(extractBlocksAiCrawlers('User-agent: *\nDisallow: /\n').present).toBe(false);
        expect(extractBlocksAiCrawlers('User-agent: GPTBot\nDisallow: /private\n').present).toBe(false);
    });
});

describe('hiring', () => {
    it('finds each supported board and builds only known feed URLs', () => {
        expect(findJobBoard('<a href="https://jobs.lever.co/acme-co">x</a>')?.feedUrl).toBe('https://api.lever.co/v0/postings/acme-co?mode=json');
        expect(findJobBoard('<a href="https://jobs.ashbyhq.com/acme">x</a>')?.platform).toBe('ashby');
        expect(findJobBoard('<a href="https://apply.workable.com/acme/">x</a>')?.platform).toBe('workable');
        expect(findJobBoard('<a href="https://evil.example/boards.greenhouse.io/xy">x</a>')?.feedUrl).toBe('https://boards-api.greenhouse.io/v1/boards/xy/jobs');
        expect(findJobBoard('<p>no board</p>')).toBeNull();
    });

    it('reads titles from each feed shape and matches target roles', () => {
        const gh = JSON.stringify({ jobs: [{ title: 'Senior Data Engineer' }, { title: 'Office Manager' }] });
        const lever = JSON.stringify([{ text: 'Data Analyst' }, { text: 'Designer' }]);
        expect(jobTitles('greenhouse', gh)).toEqual(['Senior Data Engineer', 'Office Manager']);
        expect(jobTitles('lever', lever)).toEqual(['Data Analyst', 'Designer']);
        expect(jobTitles('ashby', 'not json')).toEqual([]);

        const board = findJobBoard(rich)!;
        const v = extractHiring(board, jobTitles('greenhouse', gh), ['data']);
        expect(v).toEqual({ present: true, number: 1, detail: { platform: 'greenhouse', open_roles: 2, matching_roles: 1 } });
        expect(extractHiring(board, ['Office Manager'], ['data']).present).toBe(false);
    });
});
