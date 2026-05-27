import express from 'express';
import { query } from '../lib/database';
import { rawSignalsQueue, scrapeQueue, outreachQueue } from '../lib/queue';

const router = express.Router();

/**
 * GET /api/dlq
 * Returns the latest 50 dead letter queue items.
 */
router.get('/', async (req: any, res: any) => {
    try {
        const orgId = req.organizationId || (req as any).user?.organizationId || 'default';
        const page = parseInt(req.query.page as string || '1');
        const limit = 50;
        const offset = (page - 1) * limit;

        const results = await query(`
            SELECT id, url, error, raw_text, source_queue, created_at
            FROM dead_letter_queue
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);

        const countRes = await query(`SELECT COUNT(*) FROM dead_letter_queue`);
        const total = parseInt(countRes.rows[0]?.count || '0', 10);

        res.json({
            items: results.rows,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    } catch (e: any) {
        console.error('[DLQ] List error:', e);
        res.status(500).json({ error: 'Internal error' });
    }
});

/**
 * POST /api/dlq/:id/retry
 * Re-queues the message into its original source queue
 */
router.post('/:id/retry', async (req: any, res: any) => {
    try {
        const dlqId = req.params.id;

        const result = await query(`SELECT * FROM dead_letter_queue WHERE id = $1`, [dlqId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'DLQ item not found' });
        }

        const item = result.rows[0];
        const payloadStr = item.raw_text;
        
        let payload;
        try {
            payload = JSON.parse(payloadStr);
        } catch(e) {
            payload = { data: payloadStr };
        }

        // Route back to appropriate queue based on source_queue
        switch (item.source_queue) {
            case 'rawSignalsQueue':
                await rawSignalsQueue.add('process_raw', payload);
                break;
            case 'scrapeQueue':
                await scrapeQueue.add('scrape', payload);
                break;
            case 'outreachQueue':
                await outreachQueue.add('outreach', payload);
                break;
            default:
                // Fallback to rawSignals
                await rawSignalsQueue.add('process_raw', payload);
        }

        // Delete from DLQ after successful re-queue
        await query(`DELETE FROM dead_letter_queue WHERE id = $1`, [dlqId]);

        res.json({ success: true, message: 'Re-queued successfully' });
    } catch (e: any) {
        console.error('[DLQ] Retry error:', e);
        res.status(500).json({ error: 'Internal error' });
    }
});

export default router;
