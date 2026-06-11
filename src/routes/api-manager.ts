import express from 'express';
import { query, queryWithOrg } from '../lib/database';
import { encryptCredential, decryptCredential } from '../lib/credentialVault';
import { z } from 'zod';
import crypto from 'crypto';
import { sendSampleCraftMyFunnelSignal } from '../core/CraftMyFunnelPusher';

const router = express.Router();

const CredentialSchema = z.object({
    provider: z.string().min(1),
    name: z.string().min(1),
    value: z.string().min(1)
});

router.get('/integrations', async (req: any, res) => {
    const orgId = req.organizationId;
    if (!orgId) return res.status(401).json({ error: 'Auth required' });

    const results = await queryWithOrg(
        'SELECT id, provider, credential_name FROM data_source_credentials WHERE organization_id = $1',
        [orgId],
        orgId
    );
    res.json({ credentials: results.rows });
});

router.post('/integrations', async (req: any, res) => {
    const orgId = req.organizationId;
    if (!orgId) return res.status(401).json({ error: 'Auth required' });

    const validation = CredentialSchema.safeParse(req.body);
    if (!validation.success) return res.status(400).json({ error: 'Invalid payload' });

    const { provider, name, value } = validation.data;
    const encryptedValue = encryptCredential(value);

    await queryWithOrg(
        `INSERT INTO data_source_credentials (organization_id, provider, credential_name, credential_value)
         VALUES ($1, $2, $3, $4)`,
        [orgId, provider, name, encryptedValue],
        orgId
    );

    res.json({ success: true });
});

router.delete('/integrations/:id', async (req: any, res) => {
    const orgId = req.organizationId;
    if (!orgId) return res.status(401).json({ error: 'Auth required' });

    await queryWithOrg('DELETE FROM data_source_credentials WHERE id = $1 AND organization_id = $2', [req.params.id, orgId], orgId);
    res.json({ success: true });
});

router.get('/craftmyfunnel/telemetry', async (req: any, res) => {
    const orgId = req.organizationId;
    if (!orgId) return res.status(401).json({ error: 'Auth required' });

    const configured = Boolean(
        process.env.CRAFTMYFUNNEL_API_BASE_URL &&
        process.env.CRAFTMYFUNNEL_API_KEY &&
        process.env.CRAFTMYFUNNEL_NETJANA_HMAC_SECRET
    );

    const [summaryRes, recentRes, latestReceivedRes, latestDownRes] = await Promise.all([
        queryWithOrg(`
            SELECT
                COUNT(*) AS total_events,
                COUNT(*) FILTER (WHERE request_sent = TRUE) AS sent,
                COUNT(*) FILTER (WHERE status = 'RECEIVED') AS received,
                COUNT(*) FILTER (WHERE status = 'LOST') AS lost,
                COUNT(*) FILTER (WHERE status = 'DOWN') AS down,
                COUNT(*) FILTER (WHERE status = 'SKIPPED') AS skipped,
                MAX(pushed_at) FILTER (WHERE request_sent = TRUE) AS last_sent_at,
                MAX(pushed_at) FILTER (WHERE status = 'RECEIVED') AS last_received_at
            FROM craftmyfunnel_push_log
            WHERE org_id = $1
        `, [orgId], orgId),
        queryWithOrg(`
            SELECT
                id, lead_id, status, request_sent, ack_received, response_status, detail,
                triggered_by, attempts, campaign_id, connection_status, verification_mode,
                matched, safe_for_automation, pushed_at
            FROM craftmyfunnel_push_log
            WHERE org_id = $1
            ORDER BY pushed_at DESC
            LIMIT 15
        `, [orgId], orgId),
        queryWithOrg(`
            SELECT pushed_at
            FROM craftmyfunnel_push_log
            WHERE org_id = $1 AND status = 'RECEIVED'
            ORDER BY pushed_at DESC
            LIMIT 1
        `, [orgId], orgId),
        queryWithOrg(`
            SELECT pushed_at
            FROM craftmyfunnel_push_log
            WHERE org_id = $1 AND status = 'DOWN'
            ORDER BY pushed_at DESC
            LIMIT 1
        `, [orgId], orgId),
    ]);

    const summary = summaryRes.rows[0] || {};
    const lastReceivedAt = latestReceivedRes.rows[0]?.pushed_at ? new Date(latestReceivedRes.rows[0].pushed_at) : null;
    const lastDownAt = latestDownRes.rows[0]?.pushed_at ? new Date(latestDownRes.rows[0].pushed_at) : null;
    const nodeStatus = !configured
        ? 'DOWN'
        : (!lastReceivedAt && !lastDownAt)
            ? 'IDLE'
            : (lastReceivedAt && (!lastDownAt || lastReceivedAt >= lastDownAt))
                ? 'UP'
                : 'DOWN';

    res.json({
        configured,
        node_status: nodeStatus,
        summary,
        recent: recentRes.rows,
    });
});

router.post('/craftmyfunnel/test', async (req: any, res) => {
    const orgId = req.organizationId;
    if (!orgId) return res.status(401).json({ error: 'Auth required' });

    try {
        const result = await sendSampleCraftMyFunnelSignal({
            org_id: orgId,
            lead_id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
        });
        res.json(result);
    } catch (error: any) {
        res.status(502).json({ ok: false, error: error.message });
    }
});

export default router;
