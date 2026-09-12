import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../lib/database';
import { TenantRequest } from '../middleware/tenant';
import { EntityIndexer } from '../core/rag/EntityIndexer';
import { hybridEntityResolver } from '../core/entity-resolution/hybrid-entity-resolver';

const router = Router();

const WikiUpsertSchema = z.object({
    title: z.string().min(1, 'Title is required'),
    bodyMd: z.string().default(''),
    changeSummary: z.string().optional()
});

/**
 * Helper to slugify title or company name.
 */
function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');
}

/**
 * GET /api/wiki
 * Lists all wiki pages for the current tenant.
 */
router.get('/', async (req: TenantRequest, res: Response) => {
    try {
        const orgId = req.organizationId || 'default';
        const result = await query(
            `SELECT id, entity_id, slug, title, author_name, version, is_published, created_at, updated_at
             FROM wiki_pages 
             WHERE org_id = $1 AND is_published = TRUE
             ORDER BY updated_at DESC`,
            [orgId]
        );

        res.json({
            pages: result.rows,
            total: result.rows.length
        });
    } catch (err: any) {
        console.error('[Wiki API] Failed to fetch wiki pages:', err.message);
        res.status(500).json({ error: 'Failed to fetch wiki pages', details: err.message });
    }
});

/**
 * GET /api/wiki/:entityId
 * Fetches the latest wiki page for a specific canonical entity.
 */
router.get('/:entityId', async (req: TenantRequest, res: Response) => {
    try {
        const orgId = req.organizationId || 'default';
        const { entityId } = req.params;

        const result = await query(
            `SELECT * FROM wiki_pages 
             WHERE org_id = $1 AND entity_id = $2 AND is_published = TRUE
             LIMIT 1`,
            [orgId, entityId]
        );

        if (result.rows.length > 0) {
            return res.json({ page: result.rows[0], exists: true });
        }

        // Check if entity exists in canonical_entity_cache to provide initial default draft
        const entity = await hybridEntityResolver.getEntityById(entityId);
        if (entity) {
            return res.json({
                page: {
                    entity_id: entity.entityId,
                    title: entity.canonicalName,
                    slug: slugify(entity.canonicalName),
                    body_md: `# ${entity.canonicalName}\n\n` +
                        `**Status:** ${entity.companyStatus}\n` +
                        (entity.cin ? `**CIN:** ${entity.cin}\n` : '') +
                        (entity.pan ? `**PAN:** ${entity.pan}\n` : '') +
                        (entity.registeredState ? `**Location:** ${entity.registeredState}\n` : '') +
                        `\n## Executive Overview\n\nAdd proprietary notes, market position, key contacts, or deal context here...\n`,
                    version: 0,
                    is_published: false
                },
                exists: false
            });
        }

        return res.status(404).json({ error: 'Entity or Wiki page not found', entityId });
    } catch (err: any) {
        console.error('[Wiki API] Failed to fetch wiki page:', err.message);
        res.status(500).json({ error: 'Failed to fetch wiki page', details: err.message });
    }
});

/**
 * PUT /api/wiki/:entityId
 * Creates or updates a wiki page, snapshots revision history, and auto-indexes to RAG.
 */
router.put('/:entityId', async (req: TenantRequest, res: Response) => {
    try {
        const orgId = req.organizationId || 'default';
        const { entityId } = req.params;

        const parseResult = WikiUpsertSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({
                error: 'ValidationError',
                details: parseResult.error.issues
            });
        }

        const { title, bodyMd, changeSummary } = parseResult.data;
        const authorId = (req as any).auth?.userId || 'system_user';
        const authorName = (req as any).auth?.sessionClaims?.name || (req as any).auth?.userId || 'Knowledge Contributor';
        const slug = slugify(title);

        // Check existing page
        const existingRes = await query(
            `SELECT id, version FROM wiki_pages 
             WHERE org_id = $1 AND entity_id = $2 LIMIT 1`,
            [orgId, entityId]
        );

        let pageId: string;
        let newVersion: number;

        if (existingRes.rows.length > 0) {
            pageId = existingRes.rows[0].id;
            newVersion = existingRes.rows[0].version + 1;

            await query(
                `UPDATE wiki_pages 
                 SET title = $1, slug = $2, body_md = $3, author_id = $4, author_name = $5,
                     version = $6, is_published = TRUE, updated_at = NOW()
                 WHERE id = $7`,
                [title, slug, bodyMd, authorId, authorName, newVersion, pageId]
            );
        } else {
            newVersion = 1;
            const insertRes = await query(
                `INSERT INTO wiki_pages (
                    org_id, entity_id, slug, title, body_md, author_id, author_name, version, is_published
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
                 RETURNING id`,
                [orgId, entityId, slug, title, bodyMd, authorId, authorName, newVersion]
            );
            pageId = insertRes.rows[0].id;
        }

        // Record immutable revision snapshot
        await query(
            `INSERT INTO wiki_revisions (
                page_id, org_id, entity_id, body_md, author_id, author_name, version, change_summary
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [pageId, orgId, entityId, bodyMd, authorId, authorName, newVersion, changeSummary || `Updated to version ${newVersion}`]
        );

        // Auto-index into RAG Vector Store (background / non-blocking)
        EntityIndexer.indexWiki(entityId, title, bodyMd, orgId).catch(idxErr => {
            console.warn(`[Wiki API] Auto-index warning for wiki page ${entityId}:`, idxErr.message);
        });

        // Broadcast update via Socket.io
        const io = (req as any).io;
        if (io) {
            io.to(`org:${orgId}`).emit('wiki:updated', {
                entityId,
                title,
                version: newVersion,
                authorName,
                updatedAt: new Date().toISOString()
            });
        }

        res.json({
            message: 'Wiki page saved and indexed into knowledge base successfully.',
            pageId,
            entityId,
            version: newVersion,
            updatedAt: new Date().toISOString()
        });
    } catch (err: any) {
        console.error('[Wiki API] Failed to save wiki page:', err.message);
        res.status(500).json({ error: 'Failed to save wiki page', details: err.message });
    }
});

/**
 * GET /api/wiki/:entityId/history
 * Returns the revision history of a wiki page.
 */
router.get('/:entityId/history', async (req: TenantRequest, res: Response) => {
    try {
        const orgId = req.organizationId || 'default';
        const { entityId } = req.params;

        const result = await query(
            `SELECT id, version, author_name, change_summary, created_at,
                    LENGTH(body_md) as char_count
             FROM wiki_revisions 
             WHERE org_id = $1 AND entity_id = $2
             ORDER BY version DESC`,
            [orgId, entityId]
        );

        res.json({ revisions: result.rows });
    } catch (err: any) {
        console.error('[Wiki API] Failed to fetch wiki history:', err.message);
        res.status(500).json({ error: 'Failed to fetch wiki history', details: err.message });
    }
});

/**
 * GET /api/wiki/:entityId/revisions/:version
 * Fetches a specific historical revision of a wiki page.
 */
router.get('/:entityId/revisions/:version', async (req: TenantRequest, res: Response) => {
    try {
        const orgId = req.organizationId || 'default';
        const { entityId, version } = req.params;

        const result = await query(
            `SELECT * FROM wiki_revisions 
             WHERE org_id = $1 AND entity_id = $2 AND version = $3
             LIMIT 1`,
            [orgId, entityId, parseInt(version, 10)]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Revision not found' });
        }

        res.json({ revision: result.rows[0] });
    } catch (err: any) {
        console.error('[Wiki API] Failed to fetch revision:', err.message);
        res.status(500).json({ error: 'Failed to fetch revision', details: err.message });
    }
});

/**
 * DELETE /api/wiki/:entityId
 * Unpublishes a wiki page and purges its RAG vector embeddings.
 */
router.delete('/:entityId', async (req: TenantRequest, res: Response) => {
    try {
        const orgId = req.organizationId || 'default';
        const { entityId } = req.params;

        await query(
            `UPDATE wiki_pages SET is_published = FALSE, updated_at = NOW() 
             WHERE org_id = $1 AND entity_id = $2`,
            [orgId, entityId]
        );

        // Delete from RAG vector store
        const { TenantRAGStore } = await import('../core/rag/TenantRAGStore');
        const store = new TenantRAGStore(orgId);
        await store.delete('wiki', entityId);

        res.json({ message: 'Wiki page unpublished and removed from RAG knowledge store.' });
    } catch (err: any) {
        console.error('[Wiki API] Failed to delete wiki page:', err.message);
        res.status(500).json({ error: 'Failed to delete wiki page', details: err.message });
    }
});

export default router;
