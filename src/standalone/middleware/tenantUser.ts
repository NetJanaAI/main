import { Request, Response, NextFunction } from 'express';

/**
 * Builds the user that featureGate reads from the tenant the auth middleware resolved.
 * Nothing here comes from request headers, so a caller cannot pick its own tier or organization.
 */
export const tenantUser = (req: Request, res: Response, next: NextFunction) => {
    // Ingest authenticates itself (ingestAuth), so no session tenant exists on that path.
    if (req.originalUrl.startsWith('/api/ingest')) return next();
    const organizationId = (req as any).organizationId as string | undefined;
    if (!organizationId) {
        return res.status(401).json({ error: 'Unauthorized: Valid Session or API Key Required' });
    }
    (req as any).user = { organizationId, tier: (req as any).tenantTier || 'free' };
    next();
};
