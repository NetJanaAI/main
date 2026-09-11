import { buildMermaidOrganogram, sanitizeMermaidLabel } from '../entity-resolution/mermaid-organogram';
import { CanonicalEntity } from '../entity-resolution/types';

describe('Mermaid Organogram Generator', () => {
    test('1. Full hierarchy: ultimate parent -> parent -> target -> 3 subsidiaries + 2 associates + 4 directors', () => {
        const entity: CanonicalEntity = {
            entityId: 'ent_tata_steel',
            canonicalName: 'Tata Steel Limited',
            cin: 'L27100MH1907PLC000260',
            companyStatus: 'ACTIVE',
            resolutionMethod: 'CIN_DIRECT',
            enrichmentStatus: 'COMPLETED',
            groupHierarchy: {
                ultimateParentCin: 'L51000MH1917PLC000456',
                ultimateParentName: 'Tata Sons Private Limited',
                parentCin: 'L65990MH1945PLC004520',
                parentName: 'Tata Motors Holding Ltd',
                subsidiaries: [
                    { cin: 'U27100JH2000PTC010101', name: 'Tata Steel Tubes Ltd' },
                    { cin: 'U27100WB2001PTC020202', name: 'Tata Steel Processing Ltd' },
                    { cin: 'U27100OR2002PTC030303', name: 'Tata Steel Mining Ltd' },
                ],
                associates: [
                    { cin: 'U27100DL2005PTC040404', name: 'Tata BlueScope Steel Ltd' },
                    { cin: 'U27100MH2006PTC050505', name: 'TRF Limited' },
                ]
            },
            directors: [
                { din: '00000001', name: 'N. Chandrasekaran', designation: 'Chairman' },
                { din: '00000002', name: 'T. V. Narendran', designation: 'Managing Director' },
                { din: '00000003', name: 'Koushik Chatterjee', designation: 'Executive Director' },
                { din: '00000004', name: 'Mallika Srinivasan', designation: 'Independent Director' },
            ],
            charges: [],
            establishments: []
        };

        const result = buildMermaidOrganogram(entity);
        expect(result.diagram).toContain('graph TD');
        expect(result.diagram).toContain('Tata Sons Private Limited');
        expect(result.diagram).toContain('Tata Motors Holding Ltd');
        expect(result.diagram).toContain('Tata Steel Limited');
        expect(result.diagram).toContain('Tata Steel Tubes Ltd');
        expect(result.diagram).toContain('Tata BlueScope Steel Ltd');
        expect(result.diagram).toContain('N. Chandrasekaran');
        expect(result.diagram).toContain('-->|Controls|');
        expect(result.diagram).toContain('-->|Direct Parent|');
        expect(result.diagram).toContain('-->|Subsidiary|');
        expect(result.diagram).toContain('-.->|Associate Interest|');
        expect(result.diagram).toContain('---|Director|');
        expect(result.isTruncated).toBe(false);
        // 1 target + 1 ult + 1 parent + 3 sub + 2 assoc + 4 dir = 12 nodes
        expect(result.nodeCount).toBe(12);
    });

    test('2. Standalone company (no parent, no subsidiaries, no directors) -> valid minimal diagram', () => {
        const entity: CanonicalEntity = {
            entityId: 'ent_standalone',
            canonicalName: 'Fresh Startup Pvt Ltd',
            cin: 'U72900KA2023PTC170000',
            companyStatus: 'ACTIVE',
            resolutionMethod: 'EXACT_MATCH',
            enrichmentStatus: 'PENDING',
            directors: [],
            charges: [],
            establishments: [],
            groupHierarchy: {}
        };

        const result = buildMermaidOrganogram(entity);
        expect(result.diagram).toContain('graph TD');
        expect(result.diagram).toContain('Fresh Startup Pvt Ltd');
        expect(result.diagram).not.toContain('Controls');
        expect(result.diagram).not.toContain('Subsidiary');
        expect(result.diagram).not.toContain('Director');
        expect(result.nodeCount).toBe(1);
        expect(result.isTruncated).toBe(false);
    });

    test('3. Company name with special characters &, (, ), #, " -> sanitized without syntax breaking', () => {
        const entity: CanonicalEntity = {
            entityId: 'ent_special',
            canonicalName: 'Larsen & Toubro (L&T) "Infotech" #1 Ltd',
            cin: 'L72900MH1996PLC104693',
            companyStatus: 'ACTIVE',
            resolutionMethod: 'CIN_DIRECT',
            enrichmentStatus: 'COMPLETED',
            directors: [
                { din: '00112233', name: 'A. M. Naik (Chairman & MD)', designation: 'Senior Executive #1' }
            ],
            charges: [],
            establishments: [],
            groupHierarchy: {}
        };

        const result = buildMermaidOrganogram(entity);
        // Ensure no quotes, parens, ampersands or hashes exist inside node labels that break Mermaid
        expect(result.diagram).not.toContain('"Infotech"');
        expect(result.diagram).not.toContain('(');
        expect(result.diagram).not.toContain('&');
        expect(result.diagram).toContain('Infotech 1 Ltd');
        expect(result.diagram).toContain('Senior Executive 1');
        expect(sanitizeMermaidLabel('Test #1 & (2)')).toBe('Test 1 and 2');
        expect(result.diagram).toContain('and');
        expect(result.nodeCount).toBe(2);
    });

    test('4. Director cap: entity with 12 directors -> only 5 rendered, isTruncated = true', () => {
        const directors = Array.from({ length: 12 }, (_, i) => ({
            din: `0000001${i}`,
            name: `Director Number ${i + 1}`,
            designation: 'Director'
        }));

        const entity: CanonicalEntity = {
            entityId: 'ent_many_dirs',
            canonicalName: 'Large Board Corp Ltd',
            cin: 'L12345DL2010PLC123456',
            companyStatus: 'ACTIVE',
            resolutionMethod: 'CIN_DIRECT',
            enrichmentStatus: 'COMPLETED',
            directors,
            charges: [],
            establishments: [],
            groupHierarchy: {}
        };

        const result = buildMermaidOrganogram(entity);
        expect(result.isTruncated).toBe(true);
        expect(result.diagram).toContain('and 7 other directors');
        // 1 target + 5 directors + 1 truncation node = 7 nodes
        expect(result.nodeCount).toBe(7);
    });

    test('5. Subsidiary cap: entity with 15 subsidiaries -> only 10 rendered, isTruncated = true', () => {
        const subsidiaries = Array.from({ length: 15 }, (_, i) => ({
            cin: `U00000DL2020PTC0000${i}`,
            name: `Subsidiary Unit ${i + 1}`
        }));

        const entity: CanonicalEntity = {
            entityId: 'ent_conglomerate',
            canonicalName: 'Conglomerate Holdings Ltd',
            cin: 'L99999MH2000PLC999999',
            companyStatus: 'ACTIVE',
            resolutionMethod: 'CIN_DIRECT',
            enrichmentStatus: 'COMPLETED',
            directors: [],
            charges: [],
            establishments: [],
            groupHierarchy: {
                subsidiaries
            }
        };

        const result = buildMermaidOrganogram(entity);
        expect(result.isTruncated).toBe(true);
        expect(result.diagram).toContain('and 5 more subsidiaries');
        // 1 target + 10 subsidiaries + 1 truncation node = 12 nodes
        expect(result.nodeCount).toBe(12);
    });

    test('6. null / undefined groupHierarchy -> function returns safe fallback, does not throw', () => {
        const entity: any = {
            entityId: 'ent_null_hier',
            canonicalName: 'Null Hierarchy Corp',
            cin: 'U11111MH2020PTC111111',
            companyStatus: 'ACTIVE',
            resolutionMethod: 'CIN_DIRECT',
            enrichmentStatus: 'PENDING',
            directors: null,
            charges: null,
            establishments: null,
            groupHierarchy: null
        };

        expect(() => {
            const result = buildMermaidOrganogram(entity);
            expect(result.diagram).toContain('Null Hierarchy Corp');
            expect(result.nodeCount).toBe(1);
            expect(result.isTruncated).toBe(false);
        }).not.toThrow();

        // Also test null entity
        expect(() => {
            const nullResult = buildMermaidOrganogram(null as any);
            expect(nullResult.diagram).toContain('graph TD');
            expect(nullResult.nodeCount).toBe(1);
        }).not.toThrow();
    });
});
