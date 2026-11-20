import { PGlite } from '@electric-sql/pglite';

let processor: (job: any) => Promise<any>;
const state: { pg?: PGlite } = {};

jest.mock('bullmq', () => ({
    Worker: jest.fn().mockImplementation((_n: string, fn: any) => { processor = fn; return {}; }),
}));
jest.mock('../../lib/queue', () => ({ connection: {} }));
jest.mock('../../lib/quota', () => ({ enqueueScrape: jest.fn(), QuotaExceededError: class extends Error {} }));
jest.mock('../../config/mode', () => ({ IS_COVOSPAN: false }));
jest.mock('../../config/featureFlags', () => ({ isFeatureEnabled: () => false, Feature: { AUTONOMOUS_HUNTER: 'h' } }));
jest.mock('../../utils/logger', () => ({ SecureLogger: { maskPII: (s: string) => s } }));
jest.mock('../../lib/database', () => ({ query: (t: string, p?: any[]) => state.pg!.query(t, p) }));

import { startDecayRescoreWorker } from '../decayRescoreWorker';

const FRESH_LEGACY = '00000000-0000-4000-8000-000000000001';
const FRESH_SCORED = '00000000-0000-4000-8000-000000000002';

jest.setTimeout(60_000);

beforeAll(async () => {
    const pg = new PGlite();
    state.pg = pg;
    await pg.exec(`
        CREATE TABLE scrape_results (
            job_id UUID PRIMARY KEY, organization_id UUID, domain TEXT, friction_score INT,
            base_score DECIMAL(5,2) DEFAULT 0, signal_captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            freshness_score DECIMAL(5,2) DEFAULT 100, decay_status VARCHAR(10) DEFAULT 'Hot',
            last_decay_calc TIMESTAMPTZ, previous_decay_status VARCHAR(10)
        );
        CREATE TABLE archived_scrape_results (LIKE scrape_results, archived_at TIMESTAMPTZ, archival_reason TEXT);
        CREATE TABLE lead_cards (
            lead_id UUID PRIMARY KEY, org_id TEXT, company_name TEXT, intent_score DECIMAL(5,2),
            decay_score DECIMAL(5,2), created_at TIMESTAMPTZ DEFAULT NOW(), decay_status VARCHAR(10) DEFAULT 'Hot',
            last_decay_calc TIMESTAMPTZ, archived_at TIMESTAMPTZ
        );
        INSERT INTO scrape_results (job_id, domain, friction_score, base_score) VALUES
            ('${FRESH_LEGACY}', 'legacy.com', 80, 0),
            ('${FRESH_SCORED}', 'scored.com', 80, 80);
    `);
    await startDecayRescoreWorker({ to: () => ({ emit: jest.fn() }) } as any);
});
afterAll(async () => { await state.pg?.close(); });

describe('decay rescore on rows stored before base_score was written', () => {
    it('does not archive a fresh row whose base_score is the unset 0', async () => {
        await processor({});

        const rows = (await state.pg!.query<{ job_id: string; decay_status: string }>(
            'SELECT job_id, decay_status FROM scrape_results ORDER BY job_id'
        )).rows;
        expect(rows.find((r) => r.job_id === FRESH_SCORED)!.decay_status).not.toBe('Dead');
        expect(rows.find((r) => r.job_id === FRESH_LEGACY)!.decay_status).not.toBe('Dead');
        expect((await state.pg!.query('SELECT 1 FROM archived_scrape_results')).rows).toHaveLength(0);
    });
});
