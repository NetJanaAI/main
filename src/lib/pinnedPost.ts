import https from 'https';

export interface PinnedPostInit {
    address: string;
    headers: Record<string, string>;
    body: string;
    timeoutMs: number;
    maxBytes?: number;
}

export interface PinnedPostResponse {
    ok: boolean;
    status: number;
    text(): Promise<string>;
    json(): Promise<unknown>;
}

/**
 * POSTs to an https URL over an address the caller already checked, so a DNS record that changes
 * between the check and the connection cannot redirect the request. Redirects are never followed.
 */
export function pinnedPost(url: string, init: PinnedPostInit): Promise<PinnedPostResponse> {
    const { address, headers, body, timeoutMs, maxBytes = 1_000_000 } = init;
    const family = address.includes(':') ? 6 : 4;
    return new Promise((resolve, reject) => {
        const req = https.request(
            new URL(url),
            {
                method: 'POST',
                headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
                timeout: timeoutMs,
                lookup: ((_host: string, options: any, cb: any) =>
                    options?.all ? cb(null, [{ address, family }]) : cb(null, address, family)) as any,
            },
            (res) => {
                const chunks: Buffer[] = [];
                let size = 0;
                res.on('data', (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > maxBytes) {
                        res.destroy(new Error(`Response larger than ${maxBytes} bytes`));
                        return;
                    }
                    chunks.push(chunk);
                });
                res.on('error', reject);
                res.on('end', () => {
                    const status = res.statusCode ?? 0;
                    const text = Buffer.concat(chunks).toString('utf8');
                    resolve({
                        ok: status >= 200 && status < 300,
                        status,
                        text: async () => text,
                        json: async () => JSON.parse(text),
                    });
                });
            }
        );
        req.on('timeout', () => req.destroy(new Error('Request timed out')));
        req.on('error', reject);
        req.end(body);
    });
}
