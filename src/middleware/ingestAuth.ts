import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { query } from '../lib/database';

/**
 * Secures /api/ingest/* webhooks against fake data injection.
 * Implements IP Allowlisting, HMAC Signature Validation, and API Keys.
 */

const LOCALHOST_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export const ingestAuthGuard = async (req: any, res: Response, next: NextFunction) => {
    const clientIp = ((req.ip as string) || (req.socket?.remoteAddress as string) || '').replace('::ffff:', '');
    const isLocalhost = LOCALHOST_IPS.has(clientIp);
    const isDev = process.env.NODE_ENV !== 'production';

    // 1. IP / CIDR Allowlist Protection
    const allowedIps = process.env.ALLOWED_INGEST_IPS
        ? process.env.ALLOWED_INGEST_IPS.split(',').map(s => s.trim())
        : [];

    if (!isLocalhost && allowedIps.length > 0 && !allowedIps.includes(clientIp)) {
        console.warn(`[IngestGuard] Blocked unauthorized IP: ${clientIp}`);
        return res.status(403).json({ error: 'Forbidden: IP not in allowlist' });
    }

    // 2. HMAC Signature Verification — REQUIRED when secret is configured
    const hmacSecret = process.env.HMAC_SECRET;
    const devFallback = 'dev-safety-fallback-do-not-use-in-prod';
    const isRealSecret = hmacSecret && hmacSecret !== devFallback;

    if (isRealSecret) {
        const incomingSignature = req.headers['x-source-signature'] as string | undefined;

        if (!incomingSignature) {
            console.warn(`[IngestGuard] Missing x-source-signature from IP: ${clientIp}`);
            return res.status(401).json({
                error: 'Unauthorized: x-source-signature header is required when HMAC_SECRET is configured'
            });
        }

        const rawBody = (req as any).rawBody;
        if (!rawBody) {
            console.error('[IngestGuard] CRITICAL: rawBody not available for HMAC verification.');
            return res.status(500).json({ error: 'Internal Server Error: rawBody missing' });
        }

        const computedHash = crypto.createHmac('sha256', hmacSecret).update(rawBody).digest('hex');

        try {
            if (!crypto.timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(incomingSignature, 'hex'))) {
                console.warn(`[IngestGuard] HMAC signature mismatch from IP: ${clientIp}`);
                return res.status(401).json({ error: 'Unauthorized: Invalid HMAC signature' });
            }
        } catch (e) {
            return res.status(401).json({ error: 'Unauthorized: Malformed signature' });
        }
    } else if (!isDev) {
        console.error('[IngestGuard] CRITICAL: HMAC_SECRET is not set in production. Blocking ingest.');
        return res.status(503).json({ error: 'Service misconfigured: HMAC_SECRET must be set in production.' });
    }

    // 3. API Key Enforcement & Tenant Resolution
    const apiKey = req.headers['x-api-key'] as string;
    
    // In dev on localhost, we can fallback to a default if no key is provided
    if (isDev && isLocalhost && !apiKey) {
        const defaultOrgRes = await query("SELECT id FROM tenants WHERE name = 'Default Organization' LIMIT 1");
        (req as any).organizationId = defaultOrgRes.rows[0]?.id;
        return next();
    }

    if (!apiKey) {
        console.warn(`[IngestGuard] Missing x-api-key from IP: ${clientIp}`);
        return res.status(401).json({ error: 'Unauthorized: x-api-key header required' });
    }

    // Validate apiKey against tenants.api_key_hash in Postgres
    // Note: We hash the incoming API key to compare with the stored hash
    const ADMIN_SECRET = process.env.HMAC_SECRET || devFallback;
    const apiKeyHash = crypto.createHmac('sha256', ADMIN_SECRET).update(apiKey).digest('hex');

    try {
        const result = await query('SELECT id FROM tenants WHERE api_key_hash = $1', [apiKeyHash]);
        if (result.rows.length === 0) {
            console.warn(`[IngestGuard] Invalid x-api-key from IP: ${clientIp}`);
            return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
        }
        
        (req as any).organizationId = result.rows[0].id;
        next();
    } catch (err) {
        console.error('[IngestGuard] DB Lookup Error:', err);
        res.status(500).json({ error: 'Internal Server Error during authentication' });
    }
};

