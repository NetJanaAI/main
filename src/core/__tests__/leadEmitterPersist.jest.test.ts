const dbQuery = jest.fn();
const upsert = jest.fn().mockResolvedValue(undefined);
const exec = jest.fn().mockResolvedValue([]);
const pipeline = { zadd: jest.fn().mockReturnThis(), setex: jest.fn().mockReturnThis(), exec };
const covoPush = jest.fn().mockResolvedValue(undefined);
const cmfPush = jest.fn().mockResolvedValue(undefined);

jest.mock('../../lib/database', () => ({ db: { query: (...a: any[]) => dbQuery(...a) } }));
jest.mock('../../lib/redis', () => ({ getSharedRedisClient: () => ({ pipeline: () => pipeline }) }));
jest.mock('../rag/TenantRAGStore', () => ({ TenantRAGStore: jest.fn().mockImplementation(() => ({ upsert })) }));
jest.mock('../CovospanPusher', () => ({ CovospanPusher: { push: (...a: any[]) => covoPush(...a) } }));
jest.mock('../CraftMyFunnelPusher', () => ({ sendCraftMyFunnelLeadSignal: (...a: any[]) => cmfPush(...a) }));

import { emitLeadCard } from '../lead-emitter';

const lead = {
    lead_id: '00000000-0000-4000-8000-000000000001', org_id: 'org-1', company_name: 'Acme', geo_state: 'MH',
    sector: 'Steel', source_id: 'gem', source_tier: 'TIER_2', verity_tier: 'GOLD', intent_score: 80, decay_score: 80,
    created_at: new Date().toISOString(),
};

function io() {
    const emit = jest.fn();
    return { server: { to: jest.fn().mockReturnValue({ emit }) } as any, emit };
}

describe('lead emitter persistence', () => {
    beforeEach(() => jest.clearAllMocks());

    it('fails the job when the lead cannot be stored, so it is retried', async () => {
        dbQuery.mockRejectedValue(new Error('connection reset'));
        const { server, emit } = io();

        await expect(emitLeadCard(server, lead)).rejects.toThrow('connection reset');

        expect(emit).not.toHaveBeenCalled();
        expect(exec).not.toHaveBeenCalled();
        expect(covoPush).not.toHaveBeenCalled();
        expect(cmfPush).not.toHaveBeenCalled();
    });

    it('announces and pushes a lead once it is stored', async () => {
        dbQuery.mockResolvedValue({ rows: [] });
        const { server, emit } = io();

        await emitLeadCard(server, lead);

        expect(emit).toHaveBeenCalledWith('new_lead', lead);
        expect(exec).toHaveBeenCalled();
        expect(covoPush).toHaveBeenCalled();
        expect(cmfPush).toHaveBeenCalled();
    });
});
