import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import Redis from 'ioredis';
import { connection } from '../lib/queue';

// ---------------------------------------------------------------------------
// Replay Guard Middleware
//
// Purpose: Protects NetJana ingest endpoints against replay attacks by:
//   1. Validating x-netjana-timestamp is within ±300 s of server time.
//   2. Checking x-netjana-nonce has not been seen before (Redis TTL 600 s).
//   3. Re-verifying x-netjana-signature using the full signing input:
//        signing_input = `${timestamp}.${nonce}.${rawBody}`
//
// Must be applied AFTER express.json() so req.rawBody is populated.
// Apply to routes that receive NetJana-originated webhooks (ingest/push).
// ---------------------------------------------------------------------------

const TIMESTAMP_TOLERANCE_SEC = 300; // ±5 minutes
const NONCE_TTL_SEC = 600;           // 2× tolerance window — safe dedup window
const NONCE_KEY_PREFIX = 'nonce:push:';

// Lazily initialised so the module doesn't crash on import if Redis is absent.
let _redis: Redis | null = null;
function getRedis(): Redis {
    if (!_redis) {
        _redis = new Redis(connection as any);
        _redis.on('error', (e) => console.warn('[ReplayGuard] Redis error:', e.message));
    }
    return _redis;
}

export const replayGuard = async (req: Request, res: Response, next: NextFunction) => {
    const hmacSecret = process.env.NETJANA_HMAC_SECRET;
    const isDev = process.env.NODE_ENV !== 'production';

    // If no HMAC secret is configured:
    //   - Production: fail closed.
    //   - Dev: warn and pass through (degraded mode).
    if (!hmacSecret) {
        if (!isDev) {
            console.error('[ReplayGuard] NETJANA_HMAC_SECRET not set in production — blocking request.');
            return res.status(503).json({ error: 'Service misconfigured: NETJANA_HMAC_SECRET must be set in production.' });
        }
        console.warn('[ReplayGuard] NETJANA_HMAC_SECRET not set — skipping HMAC verification in dev mode.');
        return next();
    }

    const timestamp = req.headers['x-netjana-timestamp'] as string | undefined;
    const nonce     = req.headers['x-netjana-nonce']     as string | undefined;
    const signature = req.headers['x-netjana-signature'] as string | undefined;

    // --- 1. Presence check ---
    if (!timestamp || !nonce || !signature) {
        console.warn('[ReplayGuard] Missing required security headers.');
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'x-netjana-timestamp, x-netjana-nonce, and x-netjana-signature are required.',
        });
    }

    // --- 2. Timestamp window validation ---
    const ts = parseInt(timestamp, 10);
    const nowSec = Math.floor(Date.now() / 1000);
    if (isNaN(ts) || Math.abs(nowSec - ts) > TIMESTAMP_TOLERANCE_SEC) {
        console.warn(`[ReplayGuard] Timestamp out of window. ts=${ts} now=${nowSec} delta=${nowSec - ts}s`);
        return res.status(401).json({
            error: 'Unauthorized',
            message: `Request timestamp is outside the allowed ±${TIMESTAMP_TOLERANCE_SEC}s window.`,
        });
    }

    // --- 3. Nonce deduplication (replay prevention) ---
    const nonceKey = `${NONCE_KEY_PREFIX}${nonce}`;
    try {
        const redis = getRedis();
        // SET NX with TTL — atomically sets only if key does not exist
        const set = await redis.set(nonceKey, '1', 'EX', NONCE_TTL_SEC, 'NX');
        if (set === null) {
            // Key already exists — this nonce was used before
            console.warn(`[ReplayGuard] Replay detected — nonce already seen: ${nonce}`);
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Request nonce has already been used (replay detected).',
            });
        }
    } catch (redisErr: any) {
        // Redis unavailable: fail closed in prod, warn and continue in dev
        console.error('[ReplayGuard] Redis nonce check failed:', redisErr.message);
        if (!isDev) {
            return res.status(503).json({ error: 'Service temporarily unavailable — replay guard offline.' });
        }
        console.warn('[ReplayGuard] Continuing without nonce dedup (dev mode, Redis unavailable).');
    }

    // --- 4. HMAC signature verification ---
    // Signing input: "${timestamp}.${nonce}.${rawBody}"
    const rawBody = (req as any).rawBody;
    if (!rawBody) {
        console.error('[ReplayGuard] rawBody not available — ensure express.json() verify callback is active.');
        return res.status(500).json({ error: 'Internal Server Error: rawBody missing.' });
    }

    const signingInput = `${timestamp}.${nonce}.${rawBody}`;
    const computedSig = crypto.createHmac('sha256', hmacSecret).update(signingInput, 'utf8').digest('hex');

    try {
        const expectedBuf = Buffer.from(computedSig, 'hex');
        const receivedBuf = Buffer.from(signature, 'hex');
        if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
            console.warn('[ReplayGuard] HMAC signature mismatch.');
            return res.status(401).json({ error: 'Unauthorized', message: 'Invalid HMAC signature.' });
        }
    } catch {
        return res.status(401).json({ error: 'Unauthorized', message: 'Malformed signature value.' });
    }

    next();
};
