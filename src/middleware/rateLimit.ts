import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

/**
 * Tenant-Aware Rate Limiter
 * 
 * Instead of limiting by IP (which is easily bypassed or affects shared office IPs),
 * this limits by Organization ID resolved from Clerk or API Keys.
 */
export const tenantRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: (req: any) => {
        // Dynamic limits based on tier
        if (req.tenantTier === 'enterprise') return 1000;
        return 100; // Default 100 requests per 15 mins
    },
    keyGenerator: (req: any) => {
        // Primary: Organization ID, Fallback: IP (if not auth'd yet)
        return req.organizationId || req.ip || 'unknown';
    },
    validate: false,
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
    max: 10, // Max 10 scrapes per hour for free/standard tier
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
