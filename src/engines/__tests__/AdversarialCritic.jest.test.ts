import { AdversarialCritic } from '../AdversarialCritic';
import { TenantRAGStore } from '../../core/rag/TenantRAGStore';
import { callModel, parseModelJson } from '../../lib/model-api';
import { DeadLetterQueue } from '../../lib/DeadLetterQueue';

jest.mock('../../core/rag/TenantRAGStore');
jest.mock('../../lib/model-api');
jest.mock('../../lib/DeadLetterQueue');

describe('AdversarialCritic Inference Agent (Advocate & Critic 2-Phase Loop)', () => {
    let criticEngine: AdversarialCritic;
    let mockStoreQuery: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        criticEngine = new AdversarialCritic();

        mockStoreQuery = jest.fn().mockResolvedValue([]);
        (TenantRAGStore as jest.Mock).mockImplementation(() => ({
            query: mockStoreQuery
        }));
    });

    it('should complete Advocate phase and Critic phase successfully when proposal is valid', async () => {
        mockStoreQuery.mockResolvedValue([
            { pageContent: 'Legacy ERP system crashing daily', metadata: { source: 'audit' } }
        ]);

        const advocateResponse = {
            frictionScore: 82,
            intentSummary: 'ERP migration intent detected',
            signals: [
                { category: 'TECHNICAL_DEBT', value: 'Legacy ERP instability', source_citation: 'audit-log-1' },
                { category: 'OPERATIONAL_FRICTION', value: 'Manual order processing', source_citation: 'ops-review' }
            ]
        };

        const criticResponse = {
            isValid: true,
            challenges: [],
            recommendedScore: 80,
            groundingScore: 0.88
        };

        (callModel as jest.Mock)
            .mockResolvedValueOnce(JSON.stringify(advocateResponse))
            .mockResolvedValueOnce(JSON.stringify(criticResponse));

        (parseModelJson as jest.Mock)
            .mockReturnValueOnce(advocateResponse)
            .mockReturnValueOnce(criticResponse);

        const result = await criticEngine.analyze(
            'Raw signal text',
            'job-101',
            'https://example.com/signal',
            'org-1'
        );

        expect(result.frictionScore).toBe(82);
        expect(result.intentSummary).toBe('ERP migration intent detected');
        expect(result.groundingScore).toBe(0.88);
        expect(result.complianceVerified).toBe(true);
        expect(result.painPoints.technicalDebt).toContain('Legacy ERP instability');
        expect(result.painPoints.operationalBottlenecks).toContain('Manual order processing');
        expect(result.citations).toEqual(['audit-log-1', 'ops-review']);
    });

    it('should use Critic recommended score and set complianceVerified to false when Critic refutes proposal', async () => {
        const advocateResponse = {
            frictionScore: 95,
            intentSummary: 'Unsubstantiated purchase intent',
            signals: [
                { category: 'STRATEGIC_ALPHA', value: 'Unverified expansion', source_citation: 'rumor' }
            ]
        };

        const criticResponse = {
            isValid: false,
            challenges: ['Insufficient evidence in source documents'],
            recommendedScore: 40,
            groundingScore: 0.3
        };

        (callModel as jest.Mock)
            .mockResolvedValueOnce(JSON.stringify(advocateResponse))
            .mockResolvedValueOnce(JSON.stringify(criticResponse));

        (parseModelJson as jest.Mock)
            .mockReturnValueOnce(advocateResponse)
            .mockReturnValueOnce(criticResponse);

        const result = await criticEngine.analyze('Weak text', 'job-102', undefined, 'org-1');

        expect(result.frictionScore).toBe(40);
        expect(result.intentSummary).toContain('[Verified]');
        expect(result.complianceVerified).toBe(false);
    });

    it('should route to DeadLetterQueue and return safe fallback if an unhandled exception occurs', async () => {
        (callModel as jest.Mock).mockRejectedValue(new Error('LLM API quota exceeded'));

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        const result = await criticEngine.analyze('Failing text', 'job-err', 'https://fail.com', 'org-1');

        expect(DeadLetterQueue.log).toHaveBeenCalledWith(
            expect.objectContaining({
                error: 'LLM API quota exceeded',
                url: 'https://fail.com',
                sourceQueue: 'analysis_tier'
            })
        );

        expect(result.frictionScore).toBe(0);
        expect(result.intentSummary).toBe('Analysis Failed');
        expect(result.complianceVerified).toBe(false);

        consoleSpy.mockRestore();
    });
});
