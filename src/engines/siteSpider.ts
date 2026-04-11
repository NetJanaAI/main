import axios from 'axios';

/**
 * Discover internal URLs for Spider Mode scraping.
 * Strategies: 1. sitemap.xml 2. BFS crawler over anchor tags.
 */
export async function discoverUrls(baseUrl: string, maxPages: number, intent: string = ''): Promise<string[]> {
    const urls = new Map<string, number>();
    urls.set(baseUrl, 100); // Base URL always 100 score
    
    if (maxPages <= 1) return Array.from(urls.keys());

    const keywords = intent.toLowerCase().split(/[,\s]+/).filter(k => k.length > 2);
    const parsedBase = new URL(baseUrl);
    const origin = parsedBase.origin;

    console.log(`[SiteSpider] Discovering URLs for ${origin} (max: ${maxPages}, intent: ${intent})`);

    const scoreUrl = (urlStr: string) => {
        let score = 0;
        const lowUrl = urlStr.toLowerCase();
        keywords.forEach(k => {
            if (lowUrl.includes(k)) score += 20;
        });
        // Prioritize "about", "contact", "pricing", "team", "services"
        if (lowUrl.includes('about') || lowUrl.includes('contact') || lowUrl.includes('pricing') || lowUrl.includes('team') || lowUrl.includes('services')) {
            score += 10;
        }
        // Penalize legal, privacy, terms unless in intent
        if ((lowUrl.includes('privacy') || lowUrl.includes('terms') || lowUrl.includes('legal')) && !intent.includes('legal')) {
            score -= 30;
        }
        return score;
    };

    // 1. Try sitemap fast path
    try {
        const sitemapUrl = `${origin}/sitemap.xml`;
        const res = await axios.get(sitemapUrl, { timeout: 5000 });
        if (res.status === 200 && typeof res.data === 'string') {
            const matches = res.data.match(/<loc>(.*?)<\/loc>/g);
            if (matches) {
                for (const match of matches) {
                    const loc = match.replace(/<\/?loc>/g, '').trim();
                    if (loc.startsWith(origin) && urls.size < maxPages * 2) {
                        urls.set(loc, scoreUrl(loc));
                    }
                }
            }
        }
    } catch(e: any) {
        console.log(`[SiteSpider] Sitemap not found or inaccessible (${e.message}), falling back to BFS crawl.`);
    }

    // 2. Fallback / supplementary BFS
    const queue = [baseUrl];
    const visited = new Set<string>();

    while (queue.length > 0 && urls.size < maxPages) {
        const currentUrl = queue.shift()!;
        if (visited.has(currentUrl)) continue;
        visited.add(currentUrl);

        try {
            const res = await axios.get(currentUrl, { timeout: 5000 });
            if (typeof res.data === 'string') {
                const linkMap = res.data.match(/href=["'](.*?)["']/gi);
                if (linkMap) {
                    for (const linkMatch of linkMap) {
                        if (urls.size >= maxPages) break;
                        const hr = linkMatch.replace(/href=["']/i, '').replace(/["']$/, '');
                        if (hr.startsWith('#') || hr.startsWith('mailto:') || hr.startsWith('tel:')) continue;
                        
                        try {
                            const resolved = new URL(hr, currentUrl);
                            // Only add same-origin HTTP/S links
                            if (resolved.origin === origin && ['http:', 'https:'].includes(resolved.protocol)) {
                                const cleanUrl = resolved.origin + resolved.pathname; // ignore search params for stability
                                if (!urls.has(cleanUrl) && !visited.has(cleanUrl)) {
                                    urls.set(cleanUrl, scoreUrl(cleanUrl));
                                    queue.push(cleanUrl);
                                }
                            }
                        } catch (e) {
                            // Invalid URL, ignore
                        }
                    }
                }
            }
        } catch (e) {
            // Ignore crawl errors for single pages
        }
    }

    const resultList = Array.from(urls.entries())
        .sort((a, b) => b[1] - a[1]) // highest score first
        .slice(0, maxPages)
        .map(e => e[0]);

    console.log(`[SiteSpider] Discovered ${resultList.length} weighted URLs for scraping.`);
    return resultList;
}
