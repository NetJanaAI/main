import { Router, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { TenantRequest } from '../middleware/tenant';
import { hybridEntityResolver } from '../core/entity-resolution/hybrid-entity-resolver';
import { buildMermaidOrganogram } from '../core/entity-resolution/mermaid-organogram';

const router = Router();

const CIN_REGEX = /^[LUu][0-9]{5}[A-Za-z]{2}[0-9]{4}[A-Za-z]{3}[0-9]{6}$/;
const PAN_REGEX = /^[A-Za-z]{5}[0-9]{4}[A-Za-z]{1}$/;

const SearchBodySchema = z.object({
    query: z.string().min(1, 'Search query is required'),
    geoState: z.string().optional(),
    cinHint: z.string().optional(),
    panHint: z.string().optional(),
    gstinHint: z.string().optional(),
    enableRemoteSearch: z.boolean().optional().default(true)
});

/**
 * POST /api/v1/entities/search
 * Resolves a company query into a canonical entity and builds the Mermaid corporate hierarchy organogram.
 */
router.post('/search', async (req: TenantRequest, res: Response) => {
    const startTime = Date.now();
    const requestId = randomUUID();

    try {
        const parseResult = SearchBodySchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({
                error: 'ValidationError',
                details: parseResult.error.issues.map(err => ({
                    path: err.path.join('.'),
                    message: err.message
                })),
                requestId
            });
        }

        const { query, geoState, cinHint, panHint, gstinHint, enableRemoteSearch } = parseResult.data;
        const cleanQuery = query.trim();

        if (cleanQuery.length < 3) {
            return res.status(422).json({
                error: 'UnprocessableEntity',
                message: 'Query must be at least 3 characters long.',
                requestId
            });
        }

        // Auto-detect identifier types if not provided in hints
        let detectedCin = cinHint;
        let detectedPan = panHint;
        if (!detectedCin && CIN_REGEX.test(cleanQuery)) {
            detectedCin = cleanQuery.toUpperCase();
        }
        if (!detectedPan && PAN_REGEX.test(cleanQuery)) {
            detectedPan = cleanQuery.toUpperCase();
        }

        // 1. Resolve canonical entity through 5-stage pipeline
        const entity = await hybridEntityResolver.resolve({
            rawName: cleanQuery,
            geoState,
            cinHint: detectedCin,
            panHint: detectedPan,
            gstinHint
        }, {
            enableInstaSearch: enableRemoteSearch !== false
        });

        // 2. Generate corporate hierarchy organogram
        const organogram = buildMermaidOrganogram(entity);

        const processingMs = Date.now() - startTime;

        return res.json({
            entity,
            mermaidDiagram: organogram.diagram,
            nodeCount: organogram.nodeCount,
            isTruncated: organogram.isTruncated,
            enrichmentStatus: entity.enrichmentStatus,
            resolvedBy: entity.resolutionMethod,
            requestId,
            processingMs
        });
    } catch (error: any) {
        console.error(`[EntityAPI] Search error (req: ${requestId}):`, error.message);
        return res.status(500).json({
            error: 'InternalServerError',
            message: 'Failed to resolve entity or generate hierarchy organogram.',
            requestId
        });
    }
});

/**
 * GET /api/v1/entities/:entityId/organogram
 * Read-only fetch of canonical entity and organogram from cache. Does not trigger remote searches.
 */
router.get('/:entityId/organogram', async (req: TenantRequest, res: Response) => {
    const { entityId } = req.params;

    try {
        const entity = await hybridEntityResolver.getEntityById(entityId);
        if (!entity) {
            return res.status(404).json({
                error: 'NotFound',
                message: `Entity with ID "${entityId}" not found in canonical cache.`
            });
        }

        const organogram = buildMermaidOrganogram(entity);

        return res.json({
            entity,
            mermaidDiagram: organogram.diagram,
            nodeCount: organogram.nodeCount,
            isTruncated: organogram.isTruncated,
            enrichmentStatus: entity.enrichmentStatus,
            resolvedBy: entity.resolutionMethod
        });
    } catch (error: any) {
        console.error(`[EntityAPI] Organogram fetch error for ${entityId}:`, error.message);
        return res.status(500).json({
            error: 'InternalServerError',
            message: 'Failed to fetch entity organogram.'
        });
    }
});

/**
 * GET /api/v1/entities/:entityId/status
 * Lightweight polling status endpoint used as fallback when WebSocket is unavailable.
 */
router.get('/:entityId/status', async (req: TenantRequest, res: Response) => {
    const { entityId } = req.params;

    try {
        const entity = await hybridEntityResolver.getEntityById(entityId);
        if (!entity) {
            return res.status(404).json({
                error: 'NotFound',
                message: `Entity with ID "${entityId}" not found.`
            });
        }

        return res.json({
            entityId: entity.entityId,
            canonicalName: entity.canonicalName,
            cin: entity.cin,
            enrichmentStatus: entity.enrichmentStatus,
            updatedAt: entity.updatedAt
        });
    } catch (error: any) {
        console.error(`[EntityAPI] Status fetch error for ${entityId}:`, error.message);
        return res.status(500).json({
            error: 'InternalServerError',
            message: 'Failed to fetch entity status.'
        });
    }
});

export default router;
