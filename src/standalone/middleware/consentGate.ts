import { Request, Response, NextFunction } from 'express';
// Assuming a shared redis utility or mock
// For this standalone implementation, we'll use a local map to simulate Redis
const consentStore = new Map<string, any>();

export const consentGate = (req: Request, res: Response, next: NextFunction) => {
    const organizationId = (req as any).organizationId;
    if (!organizationId) return next();

    const consent = consentStore.get(`consent:${organizationId}:tos_v1`);

    if (!consent || !consent.accepted) {
        return res.status(403).json({
            requiresConsent: true,
            consentUrl: "/consent",
            message: "Legal Action Required: Your scraped data belongs to your organization. NetJana AI does not use your lead intelligence to train shared models, feed other customers, or supply CovoSpan Edge. Your data is isolated to your account. Please accept terms to proceed."
        });
    }

    next();
};

/**
 * Endpoint for accepting consent
 */
export const acceptConsent = (req: Request, res: Response) => {
    const organizationId = (req as any).organizationId;
    if (!organizationId) return res.status(400).json({ error: "Missing organizationId" });

    consentStore.set(`consent:${organizationId}:tos_v1`, {
        accepted: true,
        timestamp: new Date().toISOString(),
        ip: req.ip
    });

    res.json({ success: true, message: "Consent recorded. Access granted." });
};
