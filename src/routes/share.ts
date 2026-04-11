import express from 'express';
import { ShareService } from '../standalone/services/ShareService';

const router = express.Router();

/**
 * Generates a signed share URL for a lead.
 * Requires Authentication.
 */
router.post('/:id', async (req, res) => {
    try {
        const organizationId = (req as any).user?.organizationId;
        const leadId = req.params.id;

        if (!organizationId) return res.status(401).json({ error: "Unauthorized" });

        const shareUrl = await ShareService.generateShareUrl(leadId, organizationId);
        res.json({ shareUrl });
    } catch (error) {
        res.status(500).json({ error: "InternalError" });
    }
});

/**
 * Public Lead Share Route
 * No authentication required.
 */
router.get('/:token', async (req, res) => {
    try {
        const content = await ShareService.getSharedContent(req.params.token);
        
        if (!content) {
            return res.status(404).json({ error: "ShareLinkExpired", message: "This intelligence link has expired or never existed." });
        }

        // Render HTML or JSON? User requested "full signal output with NetJana Standalone branding"
        // For now, return JSON which the frontend public page will parse.
        res.json(content);
    } catch (error) {
        res.status(500).json({ error: "InternalError" });
    }
});

import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

/**
 * Public ROI Report Share Resolver
 */
router.get('/roi/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const base64Pdf = await redis.get(`share:roi:${token}`);

        if (!base64Pdf) {
            return res.status(404).send("<h1>404 - Report Expired or Not Found</h1><p>Share links are valid for 30 days.</p>");
        }

        const pdfBuffer = Buffer.from(base64Pdf, 'base64');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="netjana-summary.pdf"');
        res.send(pdfBuffer);

    } catch (error: any) {
        res.status(500).send("Internal Server Error");
    }
});

export default router;
