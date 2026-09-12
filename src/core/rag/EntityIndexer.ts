import { CanonicalEntity } from '../entity-resolution/types';
import { ChunkingPipeline } from './ChunkingPipeline';
import { TenantRAGStore } from './TenantRAGStore';
import { ragIndexQueue } from '../../lib/queue';

export interface RagIndexJobData {
    type: 'entity' | 'signal' | 'wiki';
    orgId: string;
    entityId?: string;
    title?: string;
    markdown?: string;
    entityData?: CanonicalEntity;
    signalData?: any;
}

export class EntityIndexer {
    /**
     * Immediately indexes a CanonicalEntity into the RAG vector store.
     */
    static async indexEntity(entity: CanonicalEntity, orgId: string = 'default'): Promise<number> {
        try {
            if (!entity || !entity.canonicalName) return 0;
            const chunks = ChunkingPipeline.chunkEntity(entity);
            const store = new TenantRAGStore(orgId);
            const count = await store.upsertBatch(chunks, 'entity', entity.canonicalName, entity.entityId);
            console.log(`[EntityIndexer] Indexed ${count} chunks for entity: ${entity.canonicalName} (${entity.entityId}) [Org: ${orgId}]`);
            return count;
        } catch (error: any) {
            console.error(`[EntityIndexer] Failed to index entity ${entity?.entityId}:`, error.message);
            return 0;
        }
    }

    /**
     * Immediately indexes an intent signal into the RAG vector store.
     */
    static async indexSignal(signal: any, orgId: string = 'default'): Promise<number> {
        try {
            if (!signal) return 0;
            const chunks = ChunkingPipeline.chunkSignal(signal);
            const store = new TenantRAGStore(orgId);
            const sourceId = signal.source_id || 'signal';
            const count = await store.upsertBatch(chunks, 'signal', sourceId, signal.org_id);
            console.log(`[EntityIndexer] Indexed ${count} chunk for signal: ${signal.company_name_clean || signal.company_name_raw} [Org: ${orgId}]`);
            return count;
        } catch (error: any) {
            console.error(`[EntityIndexer] Failed to index signal:`, error.message);
            return 0;
        }
    }

    /**
     * Indexes a company wiki page into the RAG vector store.
     * Cleans up prior wiki chunks for this entity first to ensure clean state.
     */
    static async indexWiki(entityId: string, title: string, markdown: string, orgId: string = 'default'): Promise<number> {
        try {
            const store = new TenantRAGStore(orgId);
            // Delete prior wiki chunks for this entity
            await store.delete('wiki', entityId);

            const chunks = ChunkingPipeline.chunkWiki(entityId, title, markdown);
            const count = await store.upsertBatch(chunks, 'wiki', `wiki_${entityId}`, entityId);
            console.log(`[EntityIndexer] Indexed ${count} wiki chunks for: ${title} (${entityId}) [Org: ${orgId}]`);
            return count;
        } catch (error: any) {
            console.error(`[EntityIndexer] Failed to index wiki for ${entityId}:`, error.message);
            return 0;
        }
    }

    /**
     * Enqueues an indexing task to BullMQ for asynchronous non-blocking background processing.
     */
    static async enqueueEntityIndex(entity: CanonicalEntity, orgId: string = 'default'): Promise<void> {
        try {
            await ragIndexQueue.add('index_entity', {
                type: 'entity',
                orgId,
                entityId: entity.entityId,
                entityData: entity
            }, {
                jobId: `rag_idx_ent_${entity.entityId}_${Date.now()}`
            });
        } catch (err: any) {
            // Fallback: index directly synchronously if queue fails
            console.warn('[EntityIndexer] Queue submission failed, falling back to direct indexing:', err.message);
            await this.indexEntity(entity, orgId);
        }
    }

    /**
     * Enqueues a signal indexing task to BullMQ.
     */
    static async enqueueSignalIndex(signal: any, orgId: string = 'default'): Promise<void> {
        try {
            await ragIndexQueue.add('index_signal', {
                type: 'signal',
                orgId,
                signalData: signal
            });
        } catch (err: any) {
            await this.indexSignal(signal, orgId);
        }
    }
}
