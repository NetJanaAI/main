import { OutreachGenerator } from '../OutreachGenerator';
import { TenantRAGStore } from '../../rag/TenantRAGStore';
import { callModel, parseModelJson } from '../../../lib/model-api';
import { cache } from '../../../lib/cache';
import { getHmacSecret } from '../../../lib/secrets';

jest.mock('../../rag/TenantRAGStore');
jest.mock('../../../lib/model-api');
jest.mock('../../../lib/cache', () => ({
    cache: {
        set: jest.fn().mockResolvedValue(true)
    }
}));
jest.mock('../../../lib/secrets', () => ({
    getHmacSecret: jest.fn().mockReturnValue('test-hmac-secret-key-32-bytes!')
}));

describe('OutreachGenerator Inference Agent', () => {
    let generator: OutreachGenerator;
    let mockQuery: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        generator = new OutreachGenerator();

        mockQuery = jest.fn();
        (TenantRAGStore as jest.Mock).mockImplementation(() => ({
            query: mockQuery
        }));
    });

    it('should throw an error if lead data is not found in Tenant RAG store', async () => {
        mockQuery.mockResolvedValue([]);
        await expect(generator.generate('lead-999', 'org-1')).rejects.toThrow(
            'Lead data not found in RAG store.'
        );
    });

    it('should generate, audit, sign, and cache outreach assets successfully', async () => {
        const leadDoc = {
            metadata: {
                companyName: 'Acme Logistics',
                industry: 'Supply Chain',
                region: 'India',
                signals: [{ type: 'CAPACITY', description: 'Fleet expansion', score: 85 }]
            }
        };

        mockQuery
            .mockResolvedValueOnce([leadDoc])  // Lead lookup
            .mockResolvedValueOnce([]);        // Influence map lookup

        const primaryAssets = {
            coldEmail: { subject: 'Fleet expansion support for Acme', body: 'We noticed your recent fleet expansion...' },
            linkedinNote: 'Hi, saw Acme expansion in India.',
            callScript: { opener: 'Hi Acme team', frictionHook: 'Noticed fleet expansion', cta: 'Book 15m demo' }
        };

        const criticAudit = {
            score: 90,
            issues: [],
            rewrite: false
        };

        (callModel as jest.Mock)
            .mockResolvedValueOnce(JSON.stringify(primaryAssets))
            .mockResolvedValueOnce(JSON.stringify(criticAudit));

        (parseModelJson as jest.Mock)
            .mockReturnValueOnce(primaryAssets)
            .mockReturnValueOnce(criticAudit);

        const payload = await generator.generate('lead-100', 'org-1', 'direct');

        expect(payload.qualityScore).toBe(90);
        expect(payload.coldEmail.subject).toContain('Fleet expansion');
        expect(payload.metadata.signature).toBeTruthy();
        expect(payload.metadata.isRewritten).toBe(false);
        expect(cache.set).toHaveBeenCalledWith(
            'outreach:org-1:lead-100:latest',
            expect.any(String),
            { ex: 2592000 }
        );
    });

    it('should trigger adversarial rewrite when critic quality score is below 70', async () => {
        const leadDoc = {
            metadata: { companyName: 'Delta Systems', region: 'UAE' }
        };

        mockQuery.mockResolvedValue([leadDoc]);

        const weakAssets = {
            coldEmail: { subject: 'Hello', body: 'Generic pitch' },
            linkedinNote: 'Connect please',
            callScript: { opener: 'Hello', frictionHook: 'None', cta: 'Call me' }
        };

        const rewrittenAssets = {
            coldEmail: { subject: 'Specific UAE Tech Infrastructure', body: 'Tailored pitch' },
            linkedinNote: 'UAE specific connect',
            callScript: { opener: 'UAE opener', frictionHook: 'Tech gap', cta: 'Meet at DIFC' }
        };

        const criticAudit = {
            score: 55,
            issues: ['Too generic'],
            rewrite: true,
            rewrittenAssets
        };

        (callModel as jest.Mock)
            .mockResolvedValueOnce(JSON.stringify(weakAssets))
            .mockResolvedValueOnce(JSON.stringify(criticAudit));

        (parseModelJson as jest.Mock)
            .mockReturnValueOnce(weakAssets)
            .mockReturnValueOnce(criticAudit);

        const payload = await generator.generate('lead-200', 'org-2', 'consultative');

        expect(payload.qualityScore).toBe(55);
        expect(payload.metadata.isRewritten).toBe(true);
        expect(payload.coldEmail.subject).toBe('Specific UAE Tech Infrastructure');
    });
});
