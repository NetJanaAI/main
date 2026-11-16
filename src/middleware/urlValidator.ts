import { promises as dns } from 'dns';
import net, { BlockList } from 'net';
import axios from 'axios';

export type Resolver = (hostname: string) => Promise<string[]>;

const defaultResolve: Resolver = async (hostname) => {
    // lookup (not resolve4/6) so that every A and AAAA record, and the OS hosts file, are covered
    // exactly as the network stack will see them.
    const records = await dns.lookup(hostname, { all: true });
    return records.map((r) => r.address);
};

const blockedV4 = new BlockList();
for (const [network, prefix] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
    ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) {
    blockedV4.addSubnet(network, prefix, 'ipv4');
}

const blockedV6 = new BlockList();
for (const [network, prefix] of [
    ['::', 96], ['100::', 64], ['2001::', 32], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) {
    blockedV6.addSubnet(network, prefix, 'ipv6');
}

/** Expands an IPv6 address (including an embedded dotted IPv4 tail) into eight 16-bit groups. */
function expandV6(address: string): number[] | null {
    let text = address;
    const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) {
        const o = dotted[1].split('.').map(Number);
        text = text.slice(0, -dotted[1].length) + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
    }
    const halves = text.split('::');
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
    if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
    const groups = [...head, ...Array(fill).fill('0'), ...tail].map((g) => parseInt(g, 16));
    return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

const v4From = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/**
 * True for any address a scraper must never connect to: private, loopback, link-local, CGNAT,
 * unspecified, multicast/reserved, IPv6 ULA, and IPv6 forms that embed an IPv4 address
 * (mapped, NAT64, 6to4). Anything that is not an IP address is treated as blocked.
 */
export function isBlockedAddress(raw: string): boolean {
    const address = raw.replace(/^\[|\]$/g, '').split('%')[0];
    if (net.isIPv4(address)) return blockedV4.check(address, 'ipv4');
    if (!net.isIPv6(address)) return true;

    const g = expandV6(address);
    if (!g) return true;
    const embedsV4 =
        (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) || // ::ffff:0:0/96 mapped
        (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)); // 64:ff9b::/96 NAT64
    if (embedsV4) return blockedV4.check(v4From(g[6], g[7]), 'ipv4');
    if (g[0] === 0x2002) return blockedV4.check(v4From(g[1], g[2]), 'ipv4'); // 6to4
    return blockedV6.check(address, 'ipv6');
}

/**
 * Resolves a host and returns an address that is safe to connect to. Every record (A and AAAA) must
 * be public: a single private one is enough for a connection to land there.
 */
export async function resolvePublicAddress(
    hostname: string,
    resolve: Resolver = defaultResolve,
    isBlocked: (address: string) => boolean = isBlockedAddress
): Promise<string> {
    const host = hostname.replace(/^\[|\]$/g, '');
    let addresses: string[];
    if (net.isIP(host)) {
        addresses = [host];
    } else {
        try {
            addresses = await resolve(host);
        } catch (e: any) {
            throw new Error(`Could not resolve hostname: ${e.message}`);
        }
    }
    if (addresses.length === 0) throw new Error('Could not resolve hostname.');
    const bad = addresses.find(isBlocked);
    if (bad) throw new Error(`Blocked non-public address: ${bad}`);
    return addresses[0];
}

/**
 * Validates a target URL: HTTPS only, no embedded credentials, and every address the host
 * resolves to (A and AAAA) must be public.
 */
export async function validateTargetUrl(
    targetUrl: string,
    resolve: Resolver = defaultResolve
): Promise<{ isValid: boolean; error?: string; resolvedIp?: string }> {
    let url: URL;
    try {
        url = new URL(targetUrl);
    } catch {
        return { isValid: false, error: 'URL Validation Error: invalid URL' };
    }
    if (url.protocol !== 'https:') return { isValid: false, error: 'Only HTTPS scheme is allowed.' };
    if (url.username || url.password) return { isValid: false, error: 'Credentials in URL are not allowed.' };
    try {
        return { isValid: true, resolvedIp: await resolvePublicAddress(url.hostname, resolve) };
    } catch (e: any) {
        return { isValid: false, error: e.message };
    }
}

export interface RawResponse { status: number; headers: Record<string, any>; data: any }

const defaultRequest = async (url: string): Promise<RawResponse> => {
    const res = await axios.get(url, { timeout: 5000, maxRedirects: 0, validateStatus: () => true, responseType: 'text' });
    return { status: res.status, headers: res.headers as Record<string, any>, data: res.data };
};

/**
 * GET that validates the URL and every redirect hop before connecting to it, instead of letting
 * the HTTP client follow redirects into the private network.
 */
export async function safeGet(
    url: string,
    options: { resolve?: Resolver; request?: (url: string) => Promise<RawResponse>; maxRedirects?: number } = {}
): Promise<RawResponse> {
    const { resolve = defaultResolve, request = defaultRequest, maxRedirects = 5 } = options;
    let current = url;
    for (let hop = 0; hop <= maxRedirects; hop++) {
        const verdict = await validateTargetUrl(current, resolve);
        if (!verdict.isValid) throw new Error(`Blocked URL ${current}: ${verdict.error}`);
        const res = await request(current);
        const location = res.headers?.location;
        if (res.status >= 300 && res.status < 400 && location) {
            current = new URL(location, current).href;
            continue;
        }
        return res;
    }
    throw new Error(`Too many redirects (more than ${maxRedirects}) from ${url}`);
}
