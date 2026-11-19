import { isIndiaMArtDuplicate, safeQueueIndiaMARTLead, getDedupStats } from '../indiamart-dedup';
import { cache } from '../../../lib/cache';
import { scrapeQueue } from '../../../lib/queue';

jest.mock('../../../lib/cache', () => ({
    cache: {
        set: jest.fn(),
        get: jest.fn(),
        incr: jest.fn().mockResolvedValue(1)
    }
}));

jest.mock('../../../lib/queue', () => ({
    scrapeQueue: {
        add: jest.fn().mockResolvedValue({ id: 'job-123' })
    }
}));

describe('IndiaMART Ingestion Deduplication Collector', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('isIndiaMArtDuplicate', () => {
        it('should use query_id layer 1 deduplication and return false for new query_id', async () => {
            (cache.set as jest.Mock).mockResolvedValue('OK'); // NX set succeeded
            const result = await isIndiaMArtDuplicate({ query_id: 'Q-100200' }, 'org-1');
            expect(result).toBe(false);
            expect(cache.set).toHaveBeenCalledWith(
                'seen:indiamart:org-1:qid:Q-100200',
                '1',
                { ex: 2592000, nx: true }
            );
        });

        it('should return true when query_id is already seen (cache.set returns null)', async () => {
            (cache.set as jest.Mock).mockResolvedValue(null); // NX set failed (already exists)
            const result = await isIndiaMArtDuplicate({ QUERY_ID: 'Q-100200' }, 'org-1');
            expect(result).toBe(true);
        });

        it('should fallback to content fingerprint deduplication when query_id is absent', async () => {
            (cache.set as jest.Mock).mockResolvedValue('OK');
            const lead = {
                sender_mobile: '+91 9876543210',
                query_message: 'Urgent requirement for copper cables',
                query_product_name: 'Electrical Cables'
            };
            const result = await isIndiaMArtDuplicate(lead, 'org-1');
            expect(result).toBe(false);
            expect(cache.set).toHaveBeenCalledWith(
                expect.stringMatching(/^seen:indiamart:org-1:fp:[a-f0-9]{16}$/),
                '1',
                { ex: 2592000, nx: true }
            );
        });
    });

    describe('safeQueueIndiaMARTLead', () => {
        it('should skip queue and increment dedup stat counter if lead is duplicate', async () => {
            (cache.set as jest.Mock).mockResolvedValue(null); // duplicate
            await safeQueueIndiaMARTLead({ query_id: 'Q-DUP' }, 'org-1');

            expect(scrapeQueue.add).not.toHaveBeenCalled();
            expect(cache.incr).toHaveBeenCalledWith(
                expect.stringMatching(/^stats:dedup:indiamart:org-1:\d{4}-\d{2}-\d{2}$/)
            );
        });

        it('should enqueue signal job and increment queued stat counter if lead is fresh', async () => {
            (cache.set as jest.Mock).mockResolvedValue('OK'); // fresh
            const lead = { query_id: 'Q-FRESH', query_message: 'Need 10 units' };

            await safeQueueIndiaMARTLead(lead, 'org-1');

            expect(scrapeQueue.add).toHaveBeenCalledWith(
                'ingest_registry_signal',
                expect.objectContaining({
                    source: 'IndiaMART',
                    type: 'BUYER_INTENT',
                    rawPayload: lead,
                    organizationId: 'org-1'
                }),
                expect.any(Object)
            );

            expect(cache.incr).toHaveBeenCalledWith(
                expect.stringMatching(/^stats:queued:indiamart:org-1:\d{4}-\d{2}-\d{2}$/)
            );
        });
    });

    it('does not treat a lead from another organization as a duplicate', async () => {
        (cache.set as jest.Mock).mockResolvedValue('OK');
        await isIndiaMArtDuplicate({ query_id: 'Q-1' }, 'org-a');
        await isIndiaMArtDuplicate({ query_id: 'Q-1' }, 'org-b');
        const keys = (cache.set as jest.Mock).mock.calls.map((c) => c[0]);
        expect(new Set(keys).size).toBe(2);
    });

    describe('getDedupStats', () => {
        it('should calculate daily dedup rate percentages', async () => {
            (cache.get as jest.Mock)
                .mockResolvedValueOnce('80') // queued
                .mockResolvedValueOnce('20'); // duped

            const stats = await getDedupStats('org-1', 1);

            expect(stats).toHaveLength(1);
            expect(stats[0]).toEqual({
                date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
                queued: 80,
                duplicates: 20,
                dedup_rate: '20%'
            });
        });
    });
});
