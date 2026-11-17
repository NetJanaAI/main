import type { SignalValue } from './catalog';

// Page text is untrusted. Everything here reads it as data with fixed patterns, stores only values
// built from our own constants or parsed into numbers, dates and validated slugs, and never
// evaluates it or passes it to a model.

const strip = (html: string) =>
    html
        .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ');

const BOOKING_TOOLS = /calendly\.com|acuityscheduling\.com|squareup\.com\/appointments|booksy\.com|simplybook\.|setmore\.com|opentable\.com|resy\.com|mindbodyonline\.com|vagaro\.com|fresha\.com|zenoti\.com|youcanbook\.me|cal\.com\/|tidycal\.com|meetings\.hubspot\.com|practo\.com|bookingsplus|appointlet\.com/i;
const BOOKING_WORDS = /\b(book (online|now|an? (appointment|table|demo|slot))|schedule (online|an? (appointment|demo|call))|reserve (a|your) table)\b/i;

export function extractNoOnlineBooking(html: string): SignalValue {
    const hasBooking = BOOKING_TOOLS.test(html) || BOOKING_WORDS.test(strip(html));
    return { present: !hasBooking };
}

const AD_NETWORKS: [string, RegExp][] = [
    ['google_ads', /googletagmanager\.com\/gtag\/js\?id=AW-|googleadservices\.com|googlesyndication\.com|doubleclick\.net/i],
    ['meta_ads', /connect\.facebook\.net\/[^"']*fbevents|\bfbq\s*\(/i],
    ['linkedin_ads', /snap\.licdn\.com|px\.ads\.linkedin\.com/i],
    ['tiktok_ads', /analytics\.tiktok\.com/i],
    ['x_ads', /static\.ads-twitter\.com/i],
];

export function extractRunningAds(html: string): SignalValue {
    const networks = AD_NETWORKS.filter(([, re]) => re.test(html)).map(([name]) => name);
    return { present: networks.length > 0, number: networks.length, detail: { networks } };
}

export function extractNoStructuredData(html: string): SignalValue {
    const has = /application\/ld\+json/i.test(html) || /itemtype\s*=\s*["']https?:\/\/schema\.org/i.test(html);
    return { present: !has };
}

/** Newest date the page itself states for a post, or null when no dated post is found. */
export function latestPostDate(html: string, now: Date): Date | null {
    const found: Date[] = [];
    const add = (raw: string) => {
        const d = new Date(raw);
        if (!Number.isNaN(d.getTime()) && d.getTime() <= now.getTime() + 86_400_000 && d.getFullYear() >= 1995) found.push(d);
    };
    for (const m of html.matchAll(/<time\b[^>]*\bdatetime\s*=\s*["']([^"']{4,40})["']/gi)) add(m[1]);
    for (const m of html.matchAll(/article:published_time["'][^>]*content\s*=\s*["']([^"']{4,40})["']/gi)) add(m[1]);
    for (const m of html.matchAll(/"datePublished"\s*:\s*"([^"]{4,40})"/gi)) add(m[1]);
    return found.length ? new Date(Math.max(...found.map((d) => d.getTime()))) : null;
}

export function extractBlogStale(html: string, now: Date, staleMonths = 12): SignalValue | null {
    const last = latestPostDate(html, now);
    if (!last) return null;
    const months = Math.floor((now.getTime() - last.getTime()) / (30.44 * 86_400_000));
    return { present: months >= staleMonths, number: months, detail: { last_post_at: last.toISOString() } };
}

const AI_BOTS = ['gptbot', 'chatgpt-user', 'oai-searchbot', 'claudebot', 'anthropic-ai', 'claude-web', 'ccbot', 'google-extended', 'perplexitybot', 'bytespider', 'applebot-extended', 'cohere-ai'];

export function extractBlocksAiCrawlers(robotsTxt: string): SignalValue {
    const blocked = new Set<string>();
    let agents: string[] = [];
    let lastWasAgent = false;
    for (const raw of robotsTxt.split(/\r?\n/)) {
        const line = raw.replace(/#.*/, '').trim();
        const idx = line.indexOf(':');
        if (idx < 0) continue;
        const field = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim();
        if (field === 'user-agent') {
            if (!lastWasAgent) agents = [];
            agents.push(value.toLowerCase());
            lastWasAgent = true;
        } else {
            lastWasAgent = false;
            if (field === 'disallow' && value === '/') agents.filter((a) => AI_BOTS.includes(a)).forEach((a) => blocked.add(a));
        }
    }
    return { present: blocked.size > 0, number: blocked.size, detail: { crawlers: [...blocked].sort() } };
}

const TECH: [string, RegExp][] = [
    ['wordpress', /wp-content\/|wp-includes\//i],
    ['shopify', /cdn\.shopify\.com|myshopify\.com/i],
    ['wix', /wixstatic\.com|static\.parastorage\.com/i],
    ['squarespace', /squarespace\.com|static1\.squarespace/i],
    ['webflow', /webflow\.com|data-wf-(page|site)/i],
    ['hubspot', /js\.hs-scripts\.com|hs-sites\.com|hubspotusercontent/i],
    ['drupal', /\/sites\/default\/files\/|drupal-settings-json/i],
    ['magento', /\/static\/version\d+\/frontend\/|mage\/cookies/i],
    ['nextjs', /\/_next\/static\//i],
    ['gatsby', /___gatsby|\/page-data\//i],
    ['ghost', /content="Ghost\b|ghost\.io/i],
    ['framer', /framerusercontent\.com|framer\.com\/m\//i],
];

export function extractTechStack(html: string): SignalValue {
    const technologies = TECH.filter(([, re]) => re.test(html)).map(([name]) => name);
    return { present: technologies.length > 0, number: technologies.length, detail: { technologies } };
}

export type AtsPlatform = 'greenhouse' | 'lever' | 'ashby' | 'workable';
export interface JobBoard { platform: AtsPlatform; org: string; boardUrl: string; feedUrl: string }

const BOARDS: [AtsPlatform, RegExp, (org: string) => { board: string; feed: string }][] = [
    ['greenhouse', /(?:job-boards|boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]{2,60})/i, (o) => ({ board: `https://boards.greenhouse.io/${o}`, feed: `https://boards-api.greenhouse.io/v1/boards/${o}/jobs` })],
    ['lever', /jobs\.lever\.co\/([a-z0-9_-]{2,60})/i, (o) => ({ board: `https://jobs.lever.co/${o}`, feed: `https://api.lever.co/v0/postings/${o}?mode=json` })],
    ['ashby', /jobs\.ashbyhq\.com\/([a-z0-9_.-]{2,60})/i, (o) => ({ board: `https://jobs.ashbyhq.com/${o}`, feed: `https://api.ashbyhq.com/posting-api/job-board/${o}` })],
    ['workable', /apply\.workable\.com\/([a-z0-9_-]{2,60})/i, (o) => ({ board: `https://apply.workable.com/${o}`, feed: `https://apply.workable.com/api/v1/widget/accounts/${o}` })],
];

/** The public job board a site links, with the slug validated so it can only ever build a known feed URL. */
export function findJobBoard(html: string): JobBoard | null {
    for (const [platform, re, build] of BOARDS) {
        const m = html.match(re);
        if (m) {
            const org = m[1].toLowerCase();
            const { board, feed } = build(org);
            return { platform, org, boardUrl: board, feedUrl: feed };
        }
    }
    return null;
}

/** Titles of the open roles in a board's public JSON feed. */
export function jobTitles(platform: AtsPlatform, body: string): string[] {
    let data: any;
    try {
        data = JSON.parse(body);
    } catch {
        return [];
    }
    const list: any[] =
        platform === 'greenhouse' ? data?.jobs
        : platform === 'lever' ? (Array.isArray(data) ? data : [])
        : platform === 'ashby' ? data?.jobs
        : data?.jobs;
    if (!Array.isArray(list)) return [];
    return list.map((j) => (platform === 'lever' ? j?.text : j?.title)).filter((t): t is string => typeof t === 'string');
}

export function extractHiring(board: JobBoard, titles: string[], targetRoles: string[]): SignalValue {
    const wanted = targetRoles.map((r) => r.trim().toLowerCase()).filter(Boolean);
    const matched = wanted.length ? titles.filter((t) => wanted.some((r) => t.toLowerCase().includes(r))) : titles;
    return {
        present: matched.length > 0,
        number: matched.length,
        detail: { platform: board.platform, open_roles: titles.length, matching_roles: matched.length },
    };
}

export function extractContactForm(html: string, pageUrl: string): { value: SignalValue; evidenceUrl: string } {
    const forms = [...html.matchAll(/<form\b[\s\S]*?<\/form>/gi)].map((m) => m[0]);
    const hasForm = forms.some((f) => /<textarea\b/i.test(f) && /type\s*=\s*["']email["']|name\s*=\s*["'][^"']*email/i.test(f));
    if (hasForm) return { value: { present: true, detail: { kind: 'form' } }, evidenceUrl: pageUrl };

    const link = html.match(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]*contact[^"'#]*)["']/i);
    if (link) {
        try {
            const url = new URL(link[1], pageUrl);
            if (url.protocol === 'http:' || url.protocol === 'https:') return { value: { present: true, detail: { kind: 'page' } }, evidenceUrl: url.href };
        } catch {
            // not a usable link
        }
    }
    return { value: { present: false }, evidenceUrl: pageUrl };
}

const FUNDING: [string, RegExp][] = [
    ['Y Combinator', /\bY Combinator\b/],
    ['Techstars', /\bTechstars\b/i],
    ['500 Global', /\b500 (Global|Startups)\b/i],
    ['Startup India', /\bStartup India\b/i],
    ['Nasscom 10,000 Startups', /\bNasscom\s+(10,?000)\s+Startups\b/i],
    ['Funding round', /\braised (an? |our )?(seed|pre-seed|series [a-c])\b/i],
];

export function extractSelfStatedFunding(html: string): SignalValue {
    const text = strip(html);
    const labels = FUNDING.filter(([, re]) => re.test(text)).map(([label]) => label);
    return { present: labels.length > 0, number: labels.length, detail: { mentions: labels } };
}

/** Links to a /blog page from the homepage, as a same-origin absolute URL. */
export function findBlogUrl(html: string, pageUrl: string): string | null {
    const base = new URL(pageUrl);
    for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/gi)) {
        try {
            const url = new URL(m[1], base);
            if (url.origin === base.origin && /^\/(blog|news|insights|articles|resources)\/?$/i.test(url.pathname)) return url.href;
        } catch {
            // skip malformed href
        }
    }
    return null;
}
