import entitiesRouter from '../../routes/entities';
import { hybridEntityResolver } from '../entity-resolution/hybrid-entity-resolver';

jest.mock('../entity-resolution/hybrid-entity-resolver', () => ({
    hybridEntityResolver: {
        resolve: jest.fn(),
        getEntityById: jest.fn(),
    }
}));

describe('Entity Resolution & Organogram REST Routes', () => {
    let mockReq: any;
    let mockRes: any;
    let postSearchHandler: any;
    let getOrganogramHandler: any;
    let getStatusHandler: any;

    beforeAll(() => {
        // Extract route handlers from express router stack
        const stack: any[] = (entitiesRouter as any).stack || [];
        const searchLayer = stack.find(
            (s: any) => s.route && s.route.path === '/search' && s.route.methods.post
        );
        postSearchHandler = searchLayer?.route?.stack?.[0]?.handle;

        const organogramLayer = stack.find(
            (s: any) => s.route && s.route.path === '/:entityId/organogram' && s.route.methods.get
        );
        getOrganogramHandler = organogramLayer?.route?.stack?.[0]?.handle;

        const statusLayer = stack.find(
            (s: any) => s.route && s.route.path === '/:entityId/status' && s.route.methods.get
        );
        getStatusHandler = statusLayer?.route?.stack?.[0]?.handle;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };
    });

    test('1. POST /search with short query (< 3 chars) returns 422 Unprocessable Entity', async () => {
        mockReq = {
            body: { query: 'ab' },
        };

        await postSearchHandler(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(422);
        expect(mockRes.json).toHaveBeenCalledWith(
            expect.objectContaining({
                error: 'UnprocessableEntity',
                message: expect.stringContaining('at least 3 characters'),
            })
        );
    });

    test('2. POST /search with valid query resolves canonical entity and generates organogram', async () => {
        mockReq = {
            body: {
                query: 'Tata Steel Limited',
                geoState: 'MH',
            },
        };

        (hybridEntityResolver.resolve as jest.Mock).mockResolvedValue({
            entityId: 'ent_tata_steel_123',
            canonicalName: 'Tata Steel Limited',
            cin: 'L27100MH1907PLC000260',
            companyStatus: 'ACTIVE',
            resolutionMethod: 'CIN_DIRECT',
            enrichmentStatus: 'COMPLETED',
            groupHierarchy: {
                parentName: 'Tata Sons',
                subsidiaries: [{ cin: 'U11111MH2000PTC111111', name: 'Tata Steel Tubes Ltd' }],
            },
            directors: [{ din: '00000001', name: 'N. Chandrasekaran', designation: 'Chairman' }],
            charges: [],
            establishments: [],
        });

        await postSearchHandler(mockReq, mockRes);

        expect(mockRes.json).toHaveBeenCalledWith(
            expect.objectContaining({
                enrichmentStatus: 'COMPLETED',
                resolvedBy: 'CIN_DIRECT',
                nodeCount: expect.any(Number),
                mermaidDiagram: expect.stringContaining('graph TD'),
                entity: expect.objectContaining({
                    canonicalName: 'Tata Steel Limited',
                }),
            })
        );
    });

    test('3. POST /search auto-detects 21-char CIN from query string', async () => {
        mockReq = {
            body: {
                query: 'L27100MH1907PLC000260',
            },
        };

        (hybridEntityResolver.resolve as jest.Mock).mockResolvedValue({
            entityId: 'ent_cin_detected',
            canonicalName: 'Tata Steel Limited',
            cin: 'L27100MH1907PLC000260',
            companyStatus: 'ACTIVE',
            resolutionMethod: 'CIN_DIRECT',
            enrichmentStatus: 'COMPLETED',
            groupHierarchy: {},
            directors: [],
            charges: [],
            establishments: [],
        });

        await postSearchHandler(mockReq, mockRes);

        expect(hybridEntityResolver.resolve).toHaveBeenCalledWith(
            expect.objectContaining({
                cinHint: 'L27100MH1907PLC000260',
            }),
            expect.any(Object)
        );
    });

    test('4. GET /:entityId/organogram returns 404 if entity not found in cache', async () => {
        mockReq = {
            params: { entityId: 'non_existent_id' },
        };

        (hybridEntityResolver.getEntityById as jest.Mock).mockResolvedValue(null);

        await getOrganogramHandler(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(404);
        expect(mockRes.json).toHaveBeenCalledWith(
            expect.objectContaining({
                error: 'NotFound',
            })
        );
    });

    test('5. GET /:entityId/organogram returns organogram when entity exists', async () => {
        mockReq = {
            params: { entityId: 'ent_cached_123' },
        };

        (hybridEntityResolver.getEntityById as jest.Mock).mockResolvedValue({
            entityId: 'ent_cached_123',
            canonicalName: 'Cached Entity Corp',
            cin: 'U72900KA2020PTC123456',
            companyStatus: 'ACTIVE',
            resolutionMethod: 'EXACT_MATCH',
            enrichmentStatus: 'COMPLETED',
            groupHierarchy: {},
            directors: [],
            charges: [],
            establishments: [],
        });

        await getOrganogramHandler(mockReq, mockRes);

        expect(mockRes.json).toHaveBeenCalledWith(
            expect.objectContaining({
                enrichmentStatus: 'COMPLETED',
                mermaidDiagram: expect.stringContaining('graph TD'),
            })
        );
    });

    test('6. GET /:entityId/status returns lightweight status payload', async () => {
        mockReq = {
            params: { entityId: 'ent_status_123' },
        };

        (hybridEntityResolver.getEntityById as jest.Mock).mockResolvedValue({
            entityId: 'ent_status_123',
            canonicalName: 'Status Corp',
            cin: 'U12345DL2021PTC111222',
            enrichmentStatus: 'PENDING',
            updatedAt: '2026-09-11T10:00:00.000Z',
        });

        await getStatusHandler(mockReq, mockRes);

        expect(mockRes.json).toHaveBeenCalledWith({
            entityId: 'ent_status_123',
            canonicalName: 'Status Corp',
            cin: 'U12345DL2021PTC111222',
            enrichmentStatus: 'PENDING',
            updatedAt: '2026-09-11T10:00:00.000Z',
        });
    });
});
