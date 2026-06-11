import { setupGeminiWorkers } from '../gemini-chain';
import { callModel } from '../../lib/model-api';
import { resolveEntitySafe } from '../entity-resolver';
import { emitLeadCard } from '../lead-emitter';
import { OutreachService } from '../outreach';
import { tier3Queue } from '../../lib/queue';

// Mock database to avoid connection issues
jest.mock('../../lib/database', () => ({
    query: jest.fn(),
    queryWithOrg: jest.fn(),
}));

// Mock ioredis
jest.mock('ioredis', () => {
    return jest.fn().mockImplementation(() => {
        return {
            on: jest.fn(),
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue('OK'),
            del: jest.fn().mockResolvedValue(1),
            incr: jest.fn().mockResolvedValue(1),
            incrby: jest.fn().mockResolvedValue(1),
            decr: jest.fn().mockResolvedValue(0),
            expire: jest.fn().mockResolvedValue(1),
            lrange: jest.fn().mockResolvedValue([]),
            hgetall: jest.fn().mockResolvedValue({}),
            pipeline: jest.fn().mockReturnValue({
                incr: jest.fn().mockReturnThis(),
                expire: jest.fn().mockReturnThis(),
                hincrby: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue([[null, 1], [null, 1]]),
            }),
        };
    });
});

// Mock dependencies
jest.mock('../knowledge-graph', () => ({
    KnowledgeGraphService: {
        getGraphContext: jest.fn().mockResolvedValue('Graph context sample data'),
    },
}));

jest.mock('../outreach', () => ({
    OutreachService: {
        enqueueForApproval: jest.fn().mockResolvedValue(true),
    },
}));

jest.mock('../entity-resolver', () => ({
    resolveEntitySafe: jest.fn().mockResolvedValue('00000000-0000-0000-0000-000000000002'),
}));

jest.mock('../lead-emitter', () => ({
    emitLeadCard: jest.fn().mockResolvedValue(true),
}));

// Mock bullmq to extract the processors
let tier2Processor: Function;
jest.mock('bullmq', () => {
    return {
        Worker: jest.fn().mockImplementation((queueName, processor) => {
            if (queueName === 'tier2_queue') {
                tier2Processor = processor;
            }
            return {
                on: jest.fn(),
                close: jest.fn(),
            };
        }),
        Queue: jest.fn().mockImplementation(() => ({
            add: jest.fn(),
        })),
    };
});

// Mock ModelAPI to spy/control outputs
jest.mock('../../lib/model-api', () => {
    const original = jest.requireActual('../../lib/model-api');
    return {
        ...original,
        callModel: jest.fn(),
    };
});

describe('Tier 2 Pipeline Integration Test (DEMO_MODE)', () => {
    const mockIo = {
        emit: jest.fn(),
    } as any;

    beforeAll(() => {
        jest.setTimeout(30000);
        setupGeminiWorkers(mockIo);
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('successfully processes a valid high-intent signal (Gate -> Qualifier -> Writer)', async () => {
        // Mock model responses for successful path
        (callModel as jest.Mock)
            .mockResolvedValueOnce(JSON.stringify({ is_buyer: true, confidence: 0.9, valid: true, reason: 'Test gate pass' })) // Gate
            .mockResolvedValueOnce(JSON.stringify({
                procurement_category: 'AI Software',
                procurement_timeline: 'IMMEDIATE',
                buying_stage: 'DECISION',
                pain_point: 'Manual process scaling issues',
                confidence: 'HIGH'
            })) // Qualifier
            .mockResolvedValueOnce(JSON.stringify({
                company: 'Acme Corp Pune',
                why_now: 'Acme Corp has active procurement requirements.',
                what_they_need: 'AI automation software',
                do_this: 'Contact director'
            })); // Writer

        const signal = {
            signal_id: 'sig_123',
            company_name_raw: 'Acme Corp',
            company_name_clean: 'Acme Corp',
            geo_state: 'Maharashtra',
            geo_market: 'IN',
            sector_inferred: 'Technology',
            source_id: 'indiamart',
            source_tier: 'TIER_2',
            signal_strength_I0: 0.95,
            lambda: 0.05,
            collected_at: new Date().toISOString(),
            raw_payload: { requirement: 'Need AI software' },
        };

        const job = {
            data: {
                signal,
                is_triangulated: false,
            }
        } as any;

        const result = await tier2Processor(job);

        expect(result).toEqual({ status: 'lead_card_generated', lead_id: expect.any(String) });
        expect(callModel).toHaveBeenCalledTimes(3);
        expect(resolveEntitySafe).toHaveBeenCalledWith('Acme Corp', 'Maharashtra', undefined);
        expect(emitLeadCard).toHaveBeenCalledTimes(1);
        expect(OutreachService.enqueueForApproval).toHaveBeenCalledTimes(1);
    });

    it('discards a signal when Gate identifies no buying intent', async () => {
        (callModel as jest.Mock).mockResolvedValueOnce(JSON.stringify({ is_buyer: false, confidence: 0.3, valid: false, reason: 'No intent' }));

        const signal = {
            signal_id: 'sig_456',
            company_name_raw: 'Reject Corp',
            company_name_clean: 'Reject Corp',
            geo_state: 'Delhi',
            geo_market: 'IN',
            sector_inferred: 'Retail',
            source_id: 'indiamart',
            source_tier: 'TIER_2',
            signal_strength_I0: 0.5,
            lambda: 0.05,
            collected_at: new Date().toISOString(),
            raw_payload: { requirement: 'General inquiry' },
        };

        const job = {
            data: {
                signal,
                is_triangulated: false,
            }
        } as any;

        const result = await tier2Processor(job);

        expect(result).toEqual({ status: 'discarded' });
        expect(callModel).toHaveBeenCalledTimes(1); // Stops after gate
        expect(emitLeadCard).not.toHaveBeenCalled();
    });

    it('downgrades to Tier 3 when Qualifier confidence is LOW', async () => {
        (callModel as jest.Mock)
            .mockResolvedValueOnce(JSON.stringify({ is_buyer: true, confidence: 0.7, valid: true, reason: 'Potential buyer' }))
            .mockResolvedValueOnce(JSON.stringify({
                procurement_category: 'Consulting',
                procurement_timeline: 'PIPELINE',
                buying_stage: 'AWARENESS',
                pain_point: 'Unclear strategy',
                confidence: 'LOW' // Triggers downgrade
            }));

        const signal = {
            signal_id: 'sig_789',
            company_name_raw: 'Uncertain LLC',
            company_name_clean: 'Uncertain LLC',
            geo_state: 'Karnataka',
            geo_market: 'IN',
            sector_inferred: 'Services',
            source_id: 'indiamart',
            source_tier: 'TIER_2',
            signal_strength_I0: 0.8,
            lambda: 0.05,
            collected_at: new Date().toISOString(),
            raw_payload: { requirement: 'Need advice' },
        };

        const job = {
            data: {
                signal,
                is_triangulated: false,
            }
        } as any;

        const result = await tier2Processor(job);

        expect(result).toEqual({ status: 'downgraded_to_tier3' });
        expect(callModel).toHaveBeenCalledTimes(2); // Stops after qualifier
        expect(tier3Queue.add).toHaveBeenCalledWith('enrichment_pool', expect.objectContaining({
            signal,
            org_id: '00000000-0000-0000-0000-000000000002'
        }));
        expect(emitLeadCard).not.toHaveBeenCalled();
    });
});
