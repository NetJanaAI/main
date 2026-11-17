import express from 'express';
import { z } from 'zod';
import { ShareService } from '../standalone/services/ShareService';
import { getSharedRedisClient } from '../lib/redis';

const router = express.Router();
const ShareParams = z.object({ id: z.string().min(1).max(128) });
const redis = getSharedRedisClient();

/**
 * Generates a signed share URL for a lead.
 * Requires Authentication.
 */
router.post('/:id', async (req, res) => {
    try {
        const organizationId = (req as any).organizationId || (req as any).user?.organizationId;
        if (!organizationId) return res.status(401).json({ error: "Unauthorized" });
        const parsedId = ShareParams.safeParse(req.params);
        if (!parsedId.success) return res.status(400).json({ error: "Invalid lead id" });
        const leadId = parsedId.data.id;

        const shareUrl = await ShareService.generateShareUrl(leadId, organizationId);
        res.json({ shareUrl });
    } catch (error) {
        res.status(500).json({ error: "InternalError" });
    }
});

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

export default router;
