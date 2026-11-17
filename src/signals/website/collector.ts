import type { Observation, SignalKey } from './catalog';
import { fetchPublicText, FetchRefusedError, type FetchOptions } from './safeFetch';
import { loadRobots } from './robots';
import {
    extractNoOnlineBooking, extractRunningAds, extractNoStructuredData, extractBlogStale, extractBlocksAiCrawlers,
    extractTechStack, findJobBoard, jobTitles, extractHiring, extractContactForm, extractSelfStatedFunding, findBlogUrl,
} from './extractors';

const HOSTNAME_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Accepts "example.com", "https://www.Example.com/path" and returns "www.example.com", or null. */
export function normalizeDomain(input: string): string | null {
    const trimmed = String(input || '').trim().toLowerCase();
    if (!trimmed) return null;
    let host = trimmed;
    try {
        host = new URL(/^[a-z]+:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`).hostname;
    } catch {
        return null;
    }
    return HOSTNAME_RE.test(host) ? host : null;
}

export interface CollectOptions {
    confirmed: ReadonlySet<SignalKey>;
    targetRoles?: string[];
    now?: Date;
    fetch?: FetchOptions;
}

export type CollectResult =
    | { domain: string; ok: true; observations: Observation[] }
    | { domain: string; ok: false; reason: string };

/**
 * Reads one company's own public pages (homepage, robots.txt, at most one blog page and one public
 * job feed) and returns observations for the confirmed signals only.
 */
export async function collectDomain(domain: string, options: CollectOptions): Promise<CollectResult> {
    const { confirmed, targetRoles = [], now = new Date(), fetch: fetchOptions = {} } = options;
    const origin = `https://${domain}`;
    const want = (key: SignalKey) => confirmed.has(key);

    try {
        const robots = await loadRobots(origin, fetchOptions);
        if (!robots.allows('/')) return { domain, ok: false, reason: 'Blocked by robots.txt' };

        const home = await fetchPublicText(`${origin}/`, fetchOptions);
        if (home.status !== 200) return { domain, ok: false, reason: `Homepage returned HTTP ${home.status}` };
        const html = home.body;
        const evidence = home.url;
        const out: Observation[] = [];
        const add = (key: SignalKey, value: Observation['value'], evidenceUrl = evidence) => out.push({ key, value, evidenceUrl });

        if (want('no_online_booking')) add('no_online_booking', extractNoOnlineBooking(html));
        if (want('running_ads')) add('running_ads', extractRunningAds(html));
        if (want('no_structured_data')) add('no_structured_data', extractNoStructuredData(html));
        if (want('tech_stack')) add('tech_stack', extractTechStack(html));
        if (want('self_stated_funding')) add('self_stated_funding', extractSelfStatedFunding(html));
        if (want('blocks_ai_crawlers')) add('blocks_ai_crawlers', extractBlocksAiCrawlers(robots.text), `${origin}/robots.txt`);
        if (want('has_contact_form')) {
            const contact = extractContactForm(html, evidence);
            add('has_contact_form', contact.value, contact.evidenceUrl);
        }

        if (want('blog_stale')) {
            const blogUrl = findBlogUrl(html, evidence);
            if (blogUrl && robots.allows(new URL(blogUrl).pathname)) {
                const blog = await fetchPublicText(blogUrl, fetchOptions).catch(() => null);
                const value = blog && blog.status === 200 ? extractBlogStale(blog.body, now) : null;
                if (value) add('blog_stale', value, blogUrl);
            } else {
                const value = extractBlogStale(html, now);
                if (value) add('blog_stale', value);
            }
        }

        if (want('hiring_open_roles')) {
            const board = findJobBoard(html);
            if (board) {
                const feed = await fetchPublicText(board.feedUrl, fetchOptions).catch(() => null);
                if (feed && feed.status === 200) add('hiring_open_roles', extractHiring(board, jobTitles(board.platform, feed.body), targetRoles), board.boardUrl);
            } else {
                add('hiring_open_roles', { present: false, number: 0, detail: { board: 'none found' } });
            }
        }

        return { domain, ok: true, observations: out };
    } catch (e: any) {
        return { domain, ok: false, reason: e instanceof FetchRefusedError || e?.message ? String(e.message).slice(0, 200) : 'Fetch failed' };
    }
}

/** Runs collectDomain over several domains, a few at a time. */
export async function collectMany(domains: string[], options: CollectOptions, concurrency = 4): Promise<CollectResult[]> {
    const results: CollectResult[] = new Array(domains.length);
    let next = 0;
    const worker = async () => {
        while (next < domains.length) {
            const i = next++;
            results[i] = await collectDomain(domains[i], options);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, domains.length) }, worker));
    return results;
}
