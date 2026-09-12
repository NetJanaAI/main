import { TenantRAGStore } from '../TenantRAGStore';
import { EntityIndexer } from '../EntityIndexer';
import { CanonicalEntity } from '../../entity-resolution/types';

describe('TenantRAGStore & EntityIndexer', () => {
    test('TenantRAGStore upserts and queries with memory fallback in test environment', async () => {
        const store = new TenantRAGStore('org_test_suite');

        await store.upsert(
            'entity',
            'doc_test_1',
            'Tata Motors manufactures passenger electric vehicles and commercial trucks.',
            { entityId: 'org_ent_tatamotors', sourceId: 'InstaFinancials' }
        );

        const results = await store.query('electric vehicles', 3);
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].pageContent).toContain('electric vehicles');
        expect(results[0].metadata.entityId).toBe('org_ent_tatamotors');
    });

    test('EntityIndexer indexes CanonicalEntity cleanly', async () => {
        const entity: CanonicalEntity = {
            entityId: 'org_ent_indexed1',
            canonicalName: 'Zenith Robotics Private Limited',
            companyStatus: 'ACTIVE',
            cin: 'U29100KA2021PTC654321',
            registeredState: 'Karnataka',
            directors: [{ din: '09876543', name: 'Alice Walker', designation: 'Director' }],
            charges: [],
            establishments: [],
            groupHierarchy: {},
            resolutionMethod: 'CIN_DIRECT',
            enrichmentStatus: 'COMPLETED'
        };

        const count = await EntityIndexer.indexEntity(entity, 'org_test_suite');
        expect(count).toBeGreaterThan(0);

        const store = new TenantRAGStore('org_test_suite');
        const queryResults = await store.query('Zenith Robotics', 3);
        expect(queryResults.length).toBeGreaterThan(0);
        expect(queryResults.some(d => d.pageContent.includes('Zenith Robotics'))).toBe(true);
    });

    test('EntityIndexer indexes company wiki and queries it', async () => {
        const entityId = 'org_ent_wiki_test';
        const count = await EntityIndexer.indexWiki(
            entityId,
            'Zenith Robotics Wiki',
            '## Deal History\nAcquired seed funding of $2M from prominent venture funds in Bengaluru.',
            'org_test_suite'
        );
        expect(count).toBeGreaterThan(0);

        const store = new TenantRAGStore('org_test_suite');
        const queryResults = await store.query('venture funds Bengaluru', 3);
        expect(queryResults.length).toBeGreaterThan(0);
    });
});
