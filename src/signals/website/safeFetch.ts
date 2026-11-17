import http from 'http';
import https from 'https';
import { resolvePublicAddress, type Resolver } from '../../middleware/urlValidator';

/** Why a fetch was refused; the collector records this instead of failing the whole run. */
export class FetchRefusedError extends Error {}

export interface TransportRequest {
    url: URL;
    address: string;
    family: 4 | 6;
    timeoutMs: number;
    maxBytes: number;
    headers: Record<string, string>;
}
export interface TransportResponse {
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
}
export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

export interface FetchOptions {
    resolve?: Resolver;
    transport?: Transport;
    maxRedirects?: number;
    maxBytes?: number;
    timeoutMs?: number;
    minHostGapMs?: number;
}
export interface FetchedPage { status: number; url: string; contentType: string; body: string }

const TEXT_TYPES = /^(text\/|application\/(xhtml\+xml|xml|json|rss\+xml|atom\+xml))/i;
const ALLOWED_PORTS = new Set(['', '80', '443']);

export function userAgent(): string {
    const info = process.env.SIGNALS_BOT_INFO_URL;
    return info ? `NetJanaSignalsBot/1.0 (+${info})` : 'NetJanaSignalsBot/1.0';
}

/**
 * Connects to the address that was validated, not to whatever the name resolves to a moment
 * later, so a DNS answer that changes between the check and the connection cannot reach a private host.
 * It reads at most maxBytes and never executes anything it receives.
 */
export const pinnedTransport: Transport = ({ url, address, family, timeoutMs, maxBytes, headers }) =>
    new Promise((resolve, reject) => {
        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(
            url,
            {
                method: 'GET',
                headers,
                timeout: timeoutMs,
                lookup: ((_host: string, options: any, cb: any) =>
                    options?.all ? cb(null, [{ address, family }]) : cb(null, address, family)) as any,
            },
            (res) => {
                const type = String(res.headers['content-type'] || '');
                const redirect = (res.statusCode ?? 0) >= 300 && (res.statusCode ?? 0) < 400;
                if (!redirect && !TEXT_TYPES.test(type)) {
                    res.destroy();
                    return reject(new FetchRefusedError(`Content type not allowed: ${type || 'none'}`));
                }
                const chunks: Buffer[] = [];
                let size = 0;
                res.on('data', (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > maxBytes) {
                        res.destroy();
                        reject(new FetchRefusedError(`Response larger than ${maxBytes} bytes`));
                        return;
                    }
                    chunks.push(chunk);
                });
                res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
                res.on('error', reject);
            }
        );
        req.on('timeout', () => req.destroy(new FetchRefusedError('Request timed out')));
        req.on('error', reject);
        req.end();
    });

const nextSlot = new Map<string, number>();

/** Spaces out requests to one host so a slow or small site is never hammered. */
async function waitForHost(host: string, gapMs: number): Promise<void> {
    if (gapMs <= 0) return;
    const now = Date.now();
    const slot = Math.max(now, nextSlot.get(host) ?? 0);
    nextSlot.set(host, slot + gapMs);
    if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}

export async function fetchPublicText(startUrl: string, options: FetchOptions = {}): Promise<FetchedPage> {
    const {
        resolve, transport = pinnedTransport, maxRedirects = 3, maxBytes = 1_000_000, timeoutMs = 8000, minHostGapMs = 1000,
    } = options;

    let current = startUrl;
    for (let hop = 0; hop <= maxRedirects; hop++) {
        let url: URL;
        try {
            url = new URL(current);
        } catch {
            throw new FetchRefusedError(`Invalid URL: ${current}`);
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchRefusedError(`Scheme not allowed: ${url.protocol}`);
        if (url.username || url.password) throw new FetchRefusedError('Credentials in URL are not allowed.');
        if (!ALLOWED_PORTS.has(url.port)) throw new FetchRefusedError(`Port not allowed: ${url.port}`);

        let address: string;
        try {
            address = await resolvePublicAddress(url.hostname, resolve);
        } catch (e: any) {
            throw new FetchRefusedError(e.message);
        }

        await waitForHost(url.hostname, minHostGapMs);
        const res = await transport({
            url,
            address,
            family: address.includes(':') ? 6 : 4,
            timeoutMs,
            maxBytes,
            headers: { 'User-Agent': userAgent(), Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.1' },
        });

        const location = res.headers.location;
        if (res.status >= 300 && res.status < 400 && typeof location === 'string') {
            current = new URL(location, url).href;
            continue;
        }
        return { status: res.status, url: url.href, contentType: String(res.headers['content-type'] || ''), body: res.body };
    }
    throw new FetchRefusedError(`Too many redirects (more than ${maxRedirects}) from ${startUrl}`);
}
