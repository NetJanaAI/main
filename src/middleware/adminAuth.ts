import { Request, Response, NextFunction } from 'express';

/**
 * Admin Authentication Middleware
 *
 * Guards /api/admin/* routes against unauthenticated access.
 *
 * Strategy (in order):
 *  1. If CLERK_SECRET_KEY is configured: requires a valid Clerk session via req.auth
 *     populated by @clerk/express clerkMiddleware. The caller must also have
 *     publicMetadata.role === 'admin' on their Clerk user.
 *  2. If Clerk is NOT configured (local/standalone mode): falls back to checking
 *     the x-admin-secret header against the ADMIN_SECRET env var.
 *  3. If neither is configured in production: fails closed (503).
 *
 * In development (NODE_ENV !== 'production') the middleware warns but allows
 * through when NO admin credentials are configured at all, so local-dev is not
 * blocked during initial setup.
 */

const ADMIN_SECRET = process.env.ADMIN_SECRET;
const CLERK_CONFIGURED = Boolean(process.env.CLERK_SECRET_KEY);
const IS_PROD = process.env.NODE_ENV === 'production';

export async function adminAuth(req: Request, res: Response, next: NextFunction) {
    // ── Path 1: Clerk-based auth ─────────────────────────────────────────────
    if (CLERK_CONFIGURED) {
        const auth = (req as any).auth;
        if (!auth || !auth.userId) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'A valid Clerk session is required to access admin endpoints.'
            });
        }

        // Check admin/super_admin role from Clerk publicMetadata
        const metadata = auth.sessionClaims?.publicMetadata as Record<string, any> | undefined;
        const role = metadata?.role as string | undefined;
        if (role !== 'admin' && role !== 'super_admin') {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Admin or Super Admin role required. Contact your organization administrator.'
            });
        }

        (req as any).adminRole = role;
        return next();
    }

    // ── Path 2: x-admin-secret header (standalone / no-Clerk mode) ───────────
    if (ADMIN_SECRET) {
        const provided = req.headers['x-admin-secret'] as string | undefined;
        if (!provided || provided !== ADMIN_SECRET) {
            console.warn(`[AdminAuth] Invalid or missing x-admin-secret from ${req.ip}`);
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'x-admin-secret header is required for admin access in standalone mode.'
            });
        }
        (req as any).adminRole = 'super_admin'; // Default standalone mode to super_admin privilege
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
    next();
}
