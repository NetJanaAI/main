import { Router, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { TenantRequest } from '../middleware/tenant';
import { hybridEntityResolver } from '../core/entity-resolution/hybrid-entity-resolver';
import { buildMermaidOrganogram } from '../core/entity-resolution/mermaid-organogram';
import { GoogleNewsTrendsService } from '../core/news-trends/GoogleNewsTrendsService';
import { EntityIndexer } from '../core/rag/EntityIndexer';
import { query as dbQuery } from '../lib/database';

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

/**
 * GET /api/v1/entities/:entityId/news
 * Live Google News articles for the canonical company name.
 */
router.get('/:entityId/news', async (req: TenantRequest, res: Response) => {
    const { entityId } = req.params;
    const limit = parseInt((req.query.limit as string) || '15', 10);

    try {
        const entity = await hybridEntityResolver.getEntityById(entityId);
        if (!entity) {
            return res.status(404).json({ error: 'NotFound', message: `Entity "${entityId}" not found.` });
        }

        const articles = await GoogleNewsTrendsService.fetchCompanyNews(entity.canonicalName, limit);
        const positiveCount = articles.filter(a => a.sentiment === 'POSITIVE').length;
        const negativeCount = articles.filter(a => a.sentiment === 'NEGATIVE').length;
        const neutralCount = articles.length - positiveCount - negativeCount;

        return res.json({
            entityId,
            companyName: entity.canonicalName,
            total: articles.length,
            sentimentSummary: { positiveCount, neutralCount, negativeCount },
            articles,
            fetchedAt: new Date().toISOString()
        });
    } catch (error: any) {
        console.error(`[EntityAPI] News error for ${entityId}:`, error.message);
        return res.status(500).json({ error: 'InternalServerError', message: 'Failed to fetch Google News.' });
    }
});

/**
 * GET /api/v1/entities/:entityId/trends
 * Google search trends, momentum, and related topics for the company.
 */
router.get('/:entityId/trends', async (req: TenantRequest, res: Response) => {
    const { entityId } = req.params;

    try {
        const entity = await hybridEntityResolver.getEntityById(entityId);
        if (!entity) {
            return res.status(404).json({ error: 'NotFound', message: `Entity "${entityId}" not found.` });
        }

        const trends = await GoogleNewsTrendsService.fetchSearchTrends(entity.canonicalName);
        return res.json({
            entityId,
            companyName: entity.canonicalName,
            ...trends
        });
    } catch (error: any) {
        console.error(`[EntityAPI] Trends error for ${entityId}:`, error.message);
        return res.status(500).json({ error: 'InternalServerError', message: 'Failed to fetch search trends.' });
    }
});

/**
 * POST /api/v1/entities/:entityId/news/index
 * Auto-indexes recent Google News articles into the RAG vector store for instant Q&A.
 */
router.post('/:entityId/news/index', async (req: TenantRequest, res: Response) => {
    const { entityId } = req.params;
    const orgId = req.organizationId || 'default';

    try {
        const entity = await hybridEntityResolver.getEntityById(entityId);
        if (!entity) {
            return res.status(404).json({ error: 'NotFound', message: `Entity "${entityId}" not found.` });
        }

        const articles = await GoogleNewsTrendsService.fetchCompanyNews(entity.canonicalName, 20);
        const indexedCount = await EntityIndexer.indexNews(entityId, entity.canonicalName, articles, orgId);

        return res.json({
            success: true,
            indexedCount,
            companyName: entity.canonicalName,
            message: `Indexed ${indexedCount} news articles into RAG vector knowledge base.`
        });
    } catch (error: any) {
        console.error(`[EntityAPI] News index error for ${entityId}:`, error.message);
        return res.status(500).json({ error: 'InternalServerError', message: 'Failed to index news into RAG.' });
    }
});

/**
 * GET /api/v1/entities/:entityId/dossier
 * Unified 360° Company Dossier Collage:
 * Aggregates canonical entity, organogram, live Google News, Search Trends, and Wiki status in one payload.
 */
router.get('/:entityId/dossier', async (req: TenantRequest, res: Response) => {
    const { entityId } = req.params;
    const orgId = req.organizationId || 'default';


    try {
        const entity = await hybridEntityResolver.getEntityById(entityId);
        if (!entity) {
            return res.status(404).json({ error: 'NotFound', message: `Entity "${entityId}" not found in cache.` });
        }

        // 1. Generate Corporate Organogram
        const organogram = buildMermaidOrganogram(entity);

        // 2. Fetch News and Trends in parallel
        const [newsResult, trendsResult, wikiResult] = await Promise.allSettled([
            GoogleNewsTrendsService.fetchCompanyNews(entity.canonicalName, 15),
            GoogleNewsTrendsService.fetchSearchTrends(entity.canonicalName),
            dbQuery(
                `SELECT revision_id, revision_number, updated_at FROM wiki_pages WHERE org_id = $1 AND entity_id = $2 LIMIT 1`,
                [orgId, entityId]
            ).catch(() => ({ rows: [] }))
        ]);

        const articles = newsResult.status === 'fulfilled' ? newsResult.value : [];
        const positiveCount = articles.filter(a => a.sentiment === 'POSITIVE').length;
        const negativeCount = articles.filter(a => a.sentiment === 'NEGATIVE').length;
        const neutralCount = articles.length - positiveCount - negativeCount;

        const trends = trendsResult.status === 'fulfilled' ? trendsResult.value : {
            query: entity.canonicalName,
            momentumScore: 60,
            velocityLabel: 'STEADY',
            changePercent: 0,
            timeframe: 'Past 30 days',
            dataPoints: [],
            relatedTopics: [],
            topSearchQueries: []
        };

        const wikiRows = wikiResult.status === 'fulfilled' ? (wikiResult.value?.rows || []) : [];
        const hasWiki = wikiRows.length > 0;
        const wikiSummary = {
            hasWiki,
            revisionCount: hasWiki ? (wikiRows[0].revision_number || 1) : 0,
            lastEdited: hasWiki ? wikiRows[0].updated_at : undefined
        };

        return res.json({
            entity,
            organogram: {
                diagram: organogram.diagram,
                nodeCount: organogram.nodeCount,
                isTruncated: organogram.isTruncated
            },
            news: {
                articles,
                total: articles.length,
                sentimentSummary: { positiveCount, neutralCount, negativeCount },
                lastUpdated: new Date().toISOString()
            },
            trends,
            wikiSummary
        });
    } catch (error: any) {
        console.error(`[EntityAPI] Dossier error for ${entityId}:`, error.message);
        return res.status(500).json({
            error: 'InternalServerError',
            message: 'Failed to compile 360° company intelligence dossier.'
        });
    }
});

/**
 * GET /api/v1/entities/live/trends
 * Direct lookup for trends by any keyword or company name.
 */
router.get('/live/trends', async (req: TenantRequest, res: Response) => {
    const query = (req.query.q as string || '').trim();
    if (!query) {
        return res.status(400).json({ error: 'BadRequest', message: 'Query parameter q is required.' });
    }

    try {
        const trends = await GoogleNewsTrendsService.fetchSearchTrends(query);
        return res.json(trends);
    } catch (error: any) {
        console.error('[EntityAPI] Live trends query error:', error.message);
        return res.status(500).json({ error: 'InternalServerError', message: 'Failed to fetch trends.' });
    }
});

export default router;

