import { ChunkingPipeline } from '../ChunkingPipeline';
import { CanonicalEntity } from '../../entity-resolution/types';

describe('ChunkingPipeline', () => {
    test('chunkText splits long paragraphs with overlap', () => {
        const text = 'First long paragraph with some interesting company data.\n\nSecond paragraph with financial data.\n\nThird paragraph with director details.';
        const chunks = ChunkingPipeline.chunkText(text, 10, 2);
        expect(chunks.length).toBeGreaterThan(1);
    });

    test('hashContent is deterministic', () => {
        const h1 = ChunkingPipeline.hashContent('Tata Motors Limited');
        const h2 = ChunkingPipeline.hashContent('Tata Motors Limited');
        const h3 = ChunkingPipeline.hashContent('Tata Steel Limited');
        expect(h1).toBe(h2);
        expect(h1).not.toBe(h3);
    });

    test('chunkEntity produces structured section chunks', () => {
        const entity: CanonicalEntity = {
            entityId: 'org_ent_test123',
            canonicalName: 'Acme Dynamics Private Limited',
            companyStatus: 'ACTIVE',
            cin: 'U72200MH2020PTC123456',
            pan: 'ABCDE1234F',
            registeredState: 'Maharashtra',
            registeredPincode: '400001',
            authorizedCapital: 10000000,
            paidUpCapital: 5000000,
            directors: [
                { din: '01234567', name: 'John Doe', designation: 'Managing Director' },
                { din: '07654321', name: 'Jane Smith', designation: 'Director' }
            ],
            charges: [
                { holderName: 'State Bank of India', amount: 25000000, status: 'OPEN' }
            ],
            establishments: [
                { gstin: '27ABCDE1234F1Z5', stateCode: '27', stateName: 'Maharashtra', isPrimary: true }
            ],
            groupHierarchy: {
                parentName: 'Acme Global Holdings Ltd',
                parentCin: 'L99999MH2010PLC999999'
            },
            resolutionMethod: 'CIN_DIRECT',
            enrichmentStatus: 'COMPLETED'
        };

        const chunks = ChunkingPipeline.chunkEntity(entity);
        expect(chunks.length).toBe(5);

        const sections = chunks.map(c => c.section);
        expect(sections).toContain('IDENTITY');
        expect(sections).toContain('DIRECTORS');
        expect(sections).toContain('CHARGES');
        expect(sections).toContain('ESTABLISHMENTS');
        expect(sections).toContain('HIERARCHY');

        expect(chunks[0].content).toContain('Acme Dynamics Private Limited');
        expect(chunks[0].content).toContain('U72200MH2020PTC123456');
        expect(chunks[1].content).toContain('John Doe');
        expect(chunks[2].content).toContain('State Bank of India');
        expect(chunks[3].content).toContain('27ABCDE1234F1Z5');
        expect(chunks[4].content).toContain('Acme Global Holdings Ltd');
    });

    test('chunkSignal creates a clean market intent chunk', () => {
        const signal = {
            company_name_clean: 'Apex Buildcon Ltd',
            geo_state: 'Gujarat',
            sector_inferred: 'Infrastructure',
            source_id: 'gem',
            source_tier: 'TIER_1',
            procurement_category: 'Cement & Concrete',
            intent_score: 92,
            card_why_now: 'Fresh bid published on GeM portal'
        };

        const chunks = ChunkingPipeline.chunkSignal(signal);
        expect(chunks.length).toBe(1);
        expect(chunks[0].section).toBe('SIGNAL');
        expect(chunks[0].content).toContain('Apex Buildcon Ltd');
        expect(chunks[0].content).toContain('Infrastructure');
        expect(chunks[0].content).toContain('92/100');
    });

    test('chunkWiki splits wiki markdown into parts', () => {
        const markdown = '# Overview\n\nKey details about the strategic partnership and procurement pipeline.';
        const chunks = ChunkingPipeline.chunkWiki('org_ent_123', 'Acme Wiki', markdown);
        expect(chunks.length).toBeGreaterThanOrEqual(1);
        expect(chunks[0].section).toBe('WIKI');
        expect(chunks[0].content).toContain('Acme Wiki');
    });
});
