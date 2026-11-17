import { fetchPublicText, type FetchOptions } from './safeFetch';

export interface RobotsRules {
    /** The raw robots.txt text ('' when there is none). */
    text: string;
    allows(path: string): boolean;
}

const BOT_TOKEN = 'netjanasignalsbot';

interface Rule { allow: boolean; pattern: RegExp; length: number }

function toPattern(path: string): RegExp {
    const anchored = path.endsWith('$');
    const body = (anchored ? path.slice(0, -1) : path).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

export function parseRobots(text: string): RobotsRules {
    const groups: { agents: string[]; rules: Rule[] }[] = [];
    let current: { agents: string[]; rules: Rule[] } | null = null;
    let lastWasAgent = false;

    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/#.*/, '').trim();
        const idx = line.indexOf(':');
        if (idx < 0) continue;
        const field = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim();
        if (field === 'user-agent') {
            if (!current || !lastWasAgent) {
                current = { agents: [], rules: [] };
                groups.push(current);
            }
            current.agents.push(value.toLowerCase());
            lastWasAgent = true;
        } else if ((field === 'allow' || field === 'disallow') && current) {
            lastWasAgent = false;
            if (value) current.rules.push({ allow: field === 'allow', pattern: toPattern(value), length: value.length });
        } else {
            lastWasAgent = false;
        }
    }

    const own = groups.filter((g) => g.agents.some((a) => a !== '*' && BOT_TOKEN.includes(a)));
    const chosen = own.length ? own : groups.filter((g) => g.agents.includes('*'));
    const rules = chosen.flatMap((g) => g.rules);

    return {
        text,
        allows(path: string) {
            let best: Rule | null = null;
            for (const rule of rules) {
                if (!rule.pattern.test(path)) continue;
                if (!best || rule.length > best.length || (rule.length === best.length && rule.allow)) best = rule;
            }
            return best ? best.allow : true;
        },
    };
}

/**
 * robots.txt for an origin. Missing (4xx) means everything is allowed; a server error or an
 * unreachable file means we do not crawl that site this time.
 */
export async function loadRobots(origin: string, options: FetchOptions = {}): Promise<RobotsRules> {
    let res;
    try {
        res = await fetchPublicText(`${origin}/robots.txt`, options);
    } catch (e: any) {
        throw new Error(`robots.txt unavailable: ${e.message}`);
    }
    if (res.status >= 500) throw new Error(`robots.txt unavailable: HTTP ${res.status}`);
    if (res.status >= 400) return parseRobots('');
    return parseRobots(res.body);
}
