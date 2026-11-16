import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

/**
 * Admin Authentication Middleware
 *
 * Guards /api/admin/*, which is platform-wide (list every tenant, rotate any key, purge any tenant).
 * A tenant's own admin must never pass, so nothing a tenant controls (org role, publicMetadata) is trusted.
 *
 * Strategy:
 *  1. CLERK_SECRET_KEY configured: tenantContext has verified the JWT and stored its payload in req.auth.
 *     The caller must be a platform admin: their Clerk user id (`sub`) is listed in PLATFORM_ADMIN_USER_IDS
 *     (comma separated). An empty or unset list admits nobody.
 *  2. Clerk NOT configured (local/standalone): x-admin-secret must equal ADMIN_SECRET (constant-time compare).
 *  3. Neither configured in production: fail closed (503). In development it warns and allows through.
 */

function platformAdminIds(): Set<string> {
    return new Set((process.env.PLATFORM_ADMIN_USER_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean));
}

export function isPlatformAdmin(userId: unknown): boolean {
    return typeof userId === 'string' && platformAdminIds().has(userId);
}

// Hashing first makes the buffers equal length, so neither length nor content leaks through timing.
function secretsMatch(provided: string, expected: string): boolean {
    const digest = (value: string) => crypto.createHash('sha256').update(value).digest();
    return crypto.timingSafeEqual(digest(provided), digest(expected));
}

export async function adminAuth(req: Request, res: Response, next: NextFunction) {
    const ADMIN_SECRET = process.env.ADMIN_SECRET;
    const CLERK_CONFIGURED = Boolean(process.env.CLERK_SECRET_KEY);
    const IS_PROD = process.env.NODE_ENV === 'production';

    // ── Path 1: Clerk-based auth ─────────────────────────────────────────────
    if (CLERK_CONFIGURED) {
        const userId = (req as any).auth?.sub;
        if (typeof userId !== 'string' || !userId) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'A valid Clerk session is required to access admin endpoints.'
            });
        }

        if (platformAdminIds().size === 0) {
            console.error('[AdminAuth] PLATFORM_ADMIN_USER_IDS is empty; no one can use admin endpoints.');
        }
        if (!isPlatformAdmin(userId)) {
            console.warn(`[AdminAuth] Denied non-platform-admin user ${userId} on ${req.path}`);
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Platform administrator access required.'
            });
        }

        (req as any).adminRole = 'super_admin';
        (req as any).adminActorId = userId;
        return next();
    }

    // ── Path 2: x-admin-secret header (standalone / no-Clerk mode) ───────────
    if (ADMIN_SECRET) {
        const provided = req.headers['x-admin-secret'];
        if (typeof provided !== 'string' || !secretsMatch(provided, ADMIN_SECRET)) {
            console.warn(`[AdminAuth] Invalid or missing x-admin-secret from ${req.ip}`);
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'x-admin-secret header is required for admin access in standalone mode.'
            });
        }
        (req as any).adminRole = 'super_admin'; // Default standalone mode to super_admin privilege
        (req as any).adminActorId = 'admin-secret';
        return next();
    }

    // ── Path 3: No credentials configured ────────────────────────────────────
    if (IS_PROD) {
        // Fail closed in production — misconfigured deployment must not expose admin endpoints
        console.error('[AdminAuth] FATAL: Neither CLERK_SECRET_KEY nor ADMIN_SECRET is set in production. Admin endpoint blocked.');
        return res.status(503).json({
            error: 'ServiceMisconfigured',
            message: 'Admin authentication is not configured. Set CLERK_SECRET_KEY or ADMIN_SECRET.'
        });
    }

    // Dev-only degraded mode: warn loudly but allow through for local setup convenience
    console.warn('[AdminAuth] ⚠️  No admin auth configured (dev mode). Set ADMIN_SECRET to secure admin endpoints.');
    (req as any).adminRole = 'super_admin';
    (req as any).adminActorId = 'dev-open';
    next();
}
