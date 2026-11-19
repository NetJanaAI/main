/**
 * Reads TRUST_PROXY for Express. Behind a proxy or load balancer req.ip is the proxy's address
 * unless Express is told how many hops to trust, which breaks per-IP rate limits and the ingest
 * allowlist. Accepts a hop count ("1") or a comma list of addresses, CIDRs or Express keywords
 * ("loopback, 10.0.0.0/8"). "true" is refused: it trusts any X-Forwarded-For, so any client could
 * pick its own IP.
 */
export function parseTrustProxy(value: string | undefined): number | string | false {
    const raw = (value ?? '').trim();
    if (!raw || raw.toLowerCase() === 'false') return false;
    if (raw.toLowerCase() === 'true') {
        console.warn('[Config] TRUST_PROXY=true is ignored: it lets clients spoof their IP. Use a hop count or a list of proxy addresses.');
        return false;
    }
    if (/^\d+$/.test(raw)) return Number(raw);
    return raw;
}
