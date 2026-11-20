type Row = { id: string; status: string };

let processor: (job: any) => Promise<any>;
const scrapeRows: Row[] = [];
const leadRows: Row[] = [];
let largestBatch = 0;

jest.mock('bullmq', () => ({
    Worker: jest.fn().mockImplementation((_n: string, fn: any) => { processor = fn; return {}; }),
}));
jest.mock('../../lib/queue', () => ({ connection: {} }));
jest.mock('../../lib/quota', () => ({ enqueueScrape: jest.fn(), QuotaExceededError: class extends Error {} }));
jest.mock('../../config/mode', () => ({ IS_COVOSPAN: false }));
jest.mock('../../config/featureFlags', () => ({ isFeatureEnabled: () => false, Feature: { AUTONOMOUS_HUNTER: 'h' } }));
jest.mock('../../utils/logger', () => ({ SecureLogger: { maskPII: (s: string) => s } }));
jest.mock('../../core/signals/intentDecay', () => ({
    calculateDecay: () => ({ decayedScore: 0, status: 'Dead', daysSince: 99 }),
}));

// Emulates the two paging styles over an in-memory table so skipped rows show up as unprocessed ones.
function page(rows: Row[], sql: string, params: any[]) {
    const live = rows.filter((r) => r.status !== 'Dead').sort((a, b) => a.id.localeCompare(b.id));
    if (sql.includes('OFFSET')) return live.slice(params[1], params[1] + params[0]);
    const [cursor, limit] = params;
    return live.filter((r) => cursor === null || r.id > cursor).slice(0, limit);
}

jest.mock('../../lib/database', () => ({
    query: async (sql: string, params: any[] = []) => {
        const s = sql.replace(/\s+/g, ' ');
        if (s.startsWith('SELECT') && s.includes('FROM scrape_results')) {
            const out = page(scrapeRows, s, params);
            largestBatch = Math.max(largestBatch, out.length);
            return { rows: out.map((r) => ({ id: r.id, organization_id: 'o', base_score: '1', signal_captured_at: new Date(), decay_status: 'Hot', previous_decay_status: null, company_name: 'c', url: 'u' })) };
        }
        if (s.startsWith('SELECT') && s.includes('FROM lead_cards')) {
            const out = page(leadRows, s, params);
            largestBatch = Math.max(largestBatch, out.length);
            return { rows: out.map((r) => ({ lead_id: r.id, org_id: 'o', company_name: 'c', intent_score: '1', decay_score: 1, created_at: new Date(), decay_status: 'Hot' })) };
        }
        const target = s.startsWith('UPDATE scrape_results') ? scrapeRows : s.startsWith('UPDATE lead_cards') ? leadRows : null;
        if (target && (params.includes('Dead') || s.includes("'Dead'"))) {
            const row = target.find((r) => r.id === params[params.length - 1]);
            if (row) row.status = 'Dead';
        }
        return { rows: [] };
    },
}));

import { startDecayRescoreWorker } from '../decayRescoreWorker';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

describe('decay rescore visits every live row while rows flip to Dead', () => {
    beforeAll(async () => {
        await startDecayRescoreWorker({ to: () => ({ emit: jest.fn() }) } as any);
    });

    it('rescored all scrape_results and lead_cards, in bounded batches', async () => {
        scrapeRows.push(...ids(450).map((id) => ({ id, status: 'Hot' })));
        leadRows.push(...ids(450).map((id) => ({ id, status: 'Hot' })));

        const out = await processor({});

        expect(scrapeRows.filter((r) => r.status !== 'Dead')).toHaveLength(0);
        expect(leadRows.filter((r) => r.status !== 'Dead')).toHaveLength(0);
        expect(out.processed).toBe(900);
        expect(largestBatch).toBeLessThanOrEqual(200);
    });
});
