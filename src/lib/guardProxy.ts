import http from 'http';
import net from 'net';
import { AddressInfo } from 'net';
import { isBlockedAddress, resolvePublicAddress, Resolver } from '../middleware/urlValidator';

export interface UpstreamProxy { host: string; port: number; username?: string; password?: string }

export interface GuardProxyOptions {
    resolve?: Resolver;
    isBlocked?: (address: string) => boolean;
    /** An outbound proxy (e.g. a regional exit node) to chain through. Pinning to the validated IP is then not possible. */
    upstream?: UpstreamProxy;
}

export interface GuardProxy { url: string; close(): Promise<void> }

const upstreamAuth = (u: UpstreamProxy) =>
    u.username ? { 'Proxy-Authorization': 'Basic ' + Buffer.from(`${u.username}:${u.password ?? ''}`).toString('base64') } : {};

function splitHostPort(target: string): { host: string; port: number } {
    const m = target.match(/^\[?([^\]]+?)\]?:(\d+)$/);
    if (!m) throw new Error('Bad CONNECT target');
    return { host: m[1], port: Number(m[2]) };
}

/**
 * A local forward proxy for the scraping browser. Chromium sends every request through it, including
 * redirect hops, sub-resources and WebSockets, which page.route() does not see on redirects. Each
 * destination host is resolved here, refused unless every address is public, and (without an upstream
 * proxy) connected to by the validated IP, so a second DNS answer cannot redirect it.
 */
export async function startGuardProxy(options: GuardProxyOptions = {}): Promise<GuardProxy> {
    const { resolve, isBlocked = isBlockedAddress, upstream } = options;
    const check = (host: string) => resolvePublicAddress(host, resolve, isBlocked);

    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url ?? '');
            if (url.protocol !== 'http:') throw new Error('Only absolute http URLs are proxied here');
            const ip = await check(url.hostname);
            const outbound = upstream
                ? http.request({ host: upstream.host, port: upstream.port, method: req.method, path: req.url, headers: { ...req.headers, ...upstreamAuth(upstream) } })
                : http.request({ host: ip, port: Number(url.port) || 80, method: req.method, path: url.pathname + url.search, headers: req.headers });
            outbound.on('response', (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
            outbound.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
            req.pipe(outbound);
        } catch (e: any) {
            console.warn(`[GuardProxy] Refused: ${e.message}`);
            res.writeHead(403, { 'content-type': 'text/plain' });
            res.end('Blocked by network guard');
        }
    });

    server.on('connect', async (req, client: net.Socket, head: Buffer) => {
        const refuse = () => { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); };
        client.on('error', () => client.destroy());
        try {
            const { host, port } = splitHostPort(req.url ?? '');
            const ip = await check(host);
            const remote = net.connect(upstream ? { host: upstream.host, port: upstream.port } : { host: ip, port });
            remote.on('error', () => { if (client.writable) client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); client.destroy(); });
            const tunnel = () => {
                client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                if (head.length) remote.write(head);
                remote.pipe(client);
                client.pipe(remote);
            };
            if (!upstream) {
                remote.once('connect', tunnel);
                return;
            }
            remote.once('connect', () => {
                const headers = Object.entries(upstreamAuth(upstream)).map(([k, v]) => `${k}: ${v}\r\n`).join('');
                remote.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n${headers}\r\n`);
                remote.once('data', (chunk) => {
                    if (/^HTTP\/1\.[01] 200/.test(chunk.toString('latin1'))) tunnel();
                    else refuse();
                });
            });
        } catch (e: any) {
            console.warn(`[GuardProxy] Refused CONNECT: ${e.message}`);
            refuse();
        }
    });

    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const { port } = server.address() as AddressInfo;
    return {
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => { server.closeAllConnections?.(); server.close(() => done()); }),
    };
}
