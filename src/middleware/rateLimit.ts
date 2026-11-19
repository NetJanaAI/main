import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { RedisRateLimitStore } from './rateLimitStore';

// Counters live in Redis so all instances share them. Tests use the in-memory default.
const sharedStore = (prefix: string) => (process.env.NODE_ENV === 'test' ? undefined : new RedisRateLimitStore(prefix));

/** Requests per 15 minutes for a tenant on this tier. */
export function tierLimit(req: any): number {
    if (req.tenantTier === 'enterprise') return 1000;
    if (req.tenantTier === 'paid') return 500;
    return 100;
}

/**
 * Coarse per-IP limiter for requests that have not been tied to a tenant yet. It runs before
 * tenantContext so unauthenticated floods are cut off before any auth lookup.
 */
export const ipRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV !== 'production' ? 5000 : 1000,
    keyGenerator: (req: any) => req.ip || 'unknown',
    validate: false,
    passOnStoreError: true,
    store: sharedStore('rl:ip:'),
    handler: (_req: Request, res: Response) => {
        res.status(429).json({ error: 'Too many requests', retryAfter: '15m' });
    },
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * Per-IP limit for the external pull API. It runs before the API key is looked up, so a caller
 * cannot get a fresh bucket (and a fresh key lookup) by inventing key values.
 */
export const intelIpRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    keyGenerator: (req: any) => req.ip || 'unknown',
    validate: false,
    passOnStoreError: true,
    store: sharedStore('rl:intel-ip:'),
    handler: (_req: Request, res: Response) => {
        res.status(429).json({ error: 'TooManyRequests', retryAfter: '60s' });
    },
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * Tenant-Aware Rate Limiter
 * 
 * Instead of limiting by IP (which is easily bypassed or affects shared office IPs),
 * this limits by Organization ID resolved from Clerk or API Keys.
 */
export const tenantRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: (req: any) => {
        if (process.env.NODE_ENV !== 'production') return 5000;
        return tierLimit(req);
    },
    keyGenerator: (req: any) => {
        // Primary: Organization ID, Fallback: IP (if not auth'd yet)
        return req.organizationId || req.ip || 'unknown';
    },
    validate: false,
    passOnStoreError: true,
    store: sharedStore('rl:tenant:'),
    handler: (req: Request, res: Response) => {
        res.status(429).json({
            error: 'Too many requests',
            message: 'Your organization has exceeded the 15-minute quota. Please upgrade or try again later.',
            retryAfter: '15m'
        });
    },
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * Specific limiter for the scraping endpoint to prevent heavy resource drain.
 */
export const scrapeLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: process.env.NODE_ENV !== 'production' ? 100 : 10, // Max 10 scrapes per hour for free/standard tier
    keyGenerator: (req: any) => req.organizationId || req.ip || 'unknown',
    validate: false,
    message: {
        error: 'Scrape quota exceeded',
        message: 'You have reached your hourly limit of 10 scrapes. Enterprise users have higher limits.'
    }
});

/**
 * Pull API Rate Limiter
 *
 * Applied to GET /v1/intel/leads/:lead_id.
 * Keyed by x-api-key header value (falls back to IP) to prevent per-consumer abuse.
 * Allows up to 60 requests per minute (1 req/s burst tolerance).
 */
export const pullApiRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute window
    max: 60,             // 60 requests per minute per API key
    keyGenerator: (req: any) => {
        // Key by the pull API key header — each caller gets their own bucket.
        const apiKey = req.headers['x-api-key'] as string | undefined;
        return apiKey ? `pull:${apiKey.slice(-8)}` : `pull:ip:${req.ip || 'unknown'}`;
    },
    validate: false,
    handler: (_req: Request, res: Response) => {
        res.status(429).json({
            error: 'TooManyRequests',
            message: 'Pull API rate limit exceeded. Max 60 requests/min per API key.',
            retryAfter: '60s',
        });
    },
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * Entity Search Limiter
 * Limits company resolution & organogram lookups to protect InstaFinancials API budget.
 */
export const entitySearchLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute window
    max: process.env.NODE_ENV !== 'production' ? 200 : (parseInt(process.env.ENTITY_SEARCH_RPM || '20', 10)),
    keyGenerator: (req: any) => req.organizationId || req.ip || 'unknown',
    validate: false,
    handler: (_req: Request, res: Response) => res.status(429).json({
        error: 'EntitySearchQuotaExceeded',
        message: 'Entity search is limited to 20 requests/min to protect InstaFinancials API budget.',
        retryAfter: '60s',
    }),
    standardHeaders: true,
    legacyHeaders: false,
});
