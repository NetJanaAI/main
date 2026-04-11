import { Router, Request, Response } from 'express';
import { createHash } from 'crypto';
import { GeMCollectorPayloadSchema, IndiaMARTCollectorPayloadSchema, FundingCollectorPayloadSchema, NaukriCollectorPayloadSchema, ZaubaCollectorPayloadSchema, McaCollectorPayloadSchema, PariveshCollectorPayloadSchema, ReraCollectorPayloadSchema } from '../lib/schemas';
import { adaptGeM, adaptIndiaMART, adaptFunding, adaptNaukri, adaptZauba, adaptMca, adaptParivesh, adaptRera } from '../core/adapters';
import { rawSignalsQueue } from '../lib/queue';
import { ingestAuthGuard } from '../middleware/ingestAuth';
import { cache } from '../lib/cache';

const router = Router();

// Apply auth, IP whitelisting, and HMAC verification globally to all ingest webhooks
router.use(ingestAuthGuard);

/**
 * M-02: Deterministic dedup — hash the payload to detect duplicate webhook deliveries.
 * Returns true if this payload was already processed (duplicate).
 * Uses Redis SETNX with 1-hour TTL to prevent replay within the dedup window.
 */
async function isDuplicatePayload(source: string, payload: any): Promise<boolean> {
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24);
    const dedupKey = `ingest_dedup:${source}:${hash}`;
    try {
        const wasSet = await cache.set(dedupKey, '1', 'EX', 3600, 'NX');
        return wasSet === null; // null means key already existed = duplicate
    } catch (_) {
        return false; // Redis unavailable — allow through (fail-open for availability)
    }
}

router.post('/gem', async (req: Request, res: Response) => {
    try {
        const payload = GeMCollectorPayloadSchema.parse(req.body);
        if (await isDuplicatePayload('gem', payload)) {
            return res.status(409).json({ status: 'duplicate', message: 'Payload already processed' });
        }
        const signal = await adaptGeM(payload);

        if (!signal) {
            return res.status(200).json({ status: 'skipped', message: 'Signal skipped (e.g. deadline > 30 days)' });
        }

        await rawSignalsQueue.add('process_raw', signal, { jobId: signal.signal_id });
        res.status(201).json({ status: 'enqueued', signal_id: signal.signal_id });
    } catch (err: any) {
        res.status(400).json({ error: 'Validation Error', details: err.errors || err.message });
    }
});

router.post('/indiamart', async (req: Request, res: Response) => {
    try {
        const payload = IndiaMARTCollectorPayloadSchema.parse(req.body);
        if (await isDuplicatePayload('indiamart', payload)) {
            return res.status(409).json({ status: 'duplicate', message: 'Payload already processed' });
        }
        const signal = await adaptIndiaMART(payload);

        await rawSignalsQueue.add('process_raw', signal, { jobId: signal.signal_id });
        res.status(201).json({ status: 'enqueued', signal_id: signal.signal_id });
    } catch (err: any) {
        res.status(400).json({ error: 'Validation Error', details: err.errors || err.message });
    }
});

router.post('/funding', async (req: Request, res: Response) => {
    try {
        const payload = FundingCollectorPayloadSchema.parse(req.body);
        if (await isDuplicatePayload('funding', payload)) {
            return res.status(409).json({ status: 'duplicate', message: 'Payload already processed' });
        }
        const signal = await adaptFunding(payload);

        await rawSignalsQueue.add('process_raw', signal, { jobId: signal.signal_id });
        res.status(201).json({ status: 'enqueued', signal_id: signal.signal_id });
    } catch (err: any) {
        res.status(400).json({ error: 'Validation Error', details: err.errors || err.message });
    }
});

router.post('/naukri', async (req: Request, res: Response) => {
    try {
        const payload = NaukriCollectorPayloadSchema.parse(req.body);
        if (await isDuplicatePayload('naukri', payload)) {
            return res.status(409).json({ status: 'duplicate', message: 'Payload already processed' });
        }
        const signal = await adaptNaukri(payload);

        await rawSignalsQueue.add('process_raw', signal, { jobId: signal.signal_id });
        res.status(201).json({ status: 'enqueued', signal_id: signal.signal_id });
    } catch (err: any) {
        res.status(400).json({ error: 'Validation Error', details: err.errors || err.message });
    }
});

router.post('/zauba', async (req: Request, res: Response) => {
    try {
        const payload = ZaubaCollectorPayloadSchema.parse(req.body);
        if (await isDuplicatePayload('zauba', payload)) {
            return res.status(409).json({ status: 'duplicate', message: 'Payload already processed' });
        }
        const signal = await adaptZauba(payload);

        await rawSignalsQueue.add('process_raw', signal, { jobId: signal.signal_id });
        res.status(201).json({ status: 'enqueued', signal_id: signal.signal_id });
    } catch (err: any) {
        res.status(400).json({ error: 'Validation Error', details: err.errors || err.message });
    }
});

router.post('/mca', async (req: Request, res: Response) => {
    try {
        const payload = McaCollectorPayloadSchema.parse(req.body);
        if (await isDuplicatePayload('mca', payload)) {
            return res.status(409).json({ status: 'duplicate', message: 'Payload already processed' });
        }
        const signal = await adaptMca(payload);

        await rawSignalsQueue.add('process_raw', signal, { jobId: signal.signal_id });
        res.status(201).json({ status: 'enqueued', signal_id: signal.signal_id });
    } catch (err: any) {
        res.status(400).json({ error: 'Validation Error', details: err.errors || err.message });
    }
});

router.post('/parivesh', async (req: Request, res: Response) => {
    try {
        const payload = PariveshCollectorPayloadSchema.parse(req.body);
        if (await isDuplicatePayload('parivesh', payload)) {
            return res.status(409).json({ status: 'duplicate', message: 'Payload already processed' });
        }
        const signal = await adaptParivesh(payload);

        await rawSignalsQueue.add('process_raw', signal, { jobId: signal.signal_id });
        res.status(201).json({ status: 'enqueued', signal_id: signal.signal_id });
    } catch (err: any) {
        res.status(400).json({ error: 'Validation Error', details: err.errors || err.message });
    }
});

router.post('/rera', async (req: Request, res: Response) => {
    try {
        const payload = ReraCollectorPayloadSchema.parse(req.body);
        if (await isDuplicatePayload('rera', payload)) {
            return res.status(409).json({ status: 'duplicate', message: 'Payload already processed' });
        }
        const signal = await adaptRera(payload);

        await rawSignalsQueue.add('process_raw', signal, { jobId: signal.signal_id });
        res.status(201).json({ status: 'enqueued', signal_id: signal.signal_id });
    } catch (err: any) {
        res.status(400).json({ error: 'Validation Error', details: err.errors || err.message });
    }
});

export default router;
