import { Worker, Job } from 'bullmq';
import { Server } from 'socket.io';
import { connection, ENTITY_ENRICHMENT_QUEUE_NAME } from '../lib/queue';
import { getInstaClient } from '../core/entity-resolution/insta-client';
import { EnrichmentJobData } from '../core/entity-resolution/types';
import { query } from '../lib/database';
import { buildMermaidOrganogram } from '../core/entity-resolution/mermaid-organogram';
import { EntityIndexer } from '../core/rag/EntityIndexer';

export function setupEntityEnrichmentWorker(io?: Server): Worker | null {
    if (process.env.NODE_ENV === 'test') {
        console.log('[EntityEnrichmentWorker] Test environment detected; worker skipped.');
        return null;
    }

    const concurrency = process.env.ENTITY_ENRICHMENT_CONCURRENCY 
        ? parseInt(process.env.ENTITY_ENRICHMENT_CONCURRENCY, 10) 
        : 3;

    const worker = new Worker<EnrichmentJobData>(
        ENTITY_ENRICHMENT_QUEUE_NAME,
        async (job: Job<EnrichmentJobData>) => {
            const { cin, entityId, enrichTiers, locationClues } = job.data;
            console.log(`[EntityEnrichmentWorker] Processing enrichment for CIN: ${cin} (EntityId: ${entityId}, Job: ${job.id})`);

            try {
                // Update status to RUNNING in database
                await query(
                    `UPDATE canonical_entity_cache 
                     SET enrichment_status = 'RUNNING', updated_at = NOW() 
                     WHERE entity_id = $1`,
                    [entityId]
                );

                // Run full enrichment lifecycle
                const result = await getInstaClient().runEnrichmentLifecycle(cin, {
                    enrichTiers,
                    locationClues
                });

                console.log(`[EntityEnrichmentWorker] Successfully enriched CIN: ${cin} -> ${result.canonicalName}`);

                // Auto-index into RAG Vector Store
                EntityIndexer.enqueueEntityIndex(result).catch(idxErr => {
                    console.warn(`[EntityEnrichmentWorker] Auto-index warning for ${result.canonicalName}:`, idxErr.message);
                });

                // Broadcast real-time update to connected UI clients
                if (io) {
                    const organogram = buildMermaidOrganogram(result);
                    io.emit('entity:enriched', {
                        entityId: result.entityId,
                        canonicalName: result.canonicalName,
                        cin: result.cin,
                        companyStatus: result.companyStatus,
                        enrichmentStatus: 'COMPLETED',
                        mermaidDiagram: organogram.diagram,
                        nodeCount: organogram.nodeCount,
                        isTruncated: organogram.isTruncated,
                        timestamp: new Date().toISOString()
                    });
                }

                return result;
            } catch (error: any) {
                console.error(`[EntityEnrichmentWorker] Enrichment failed for CIN ${cin}:`, error.message);

                // Mark FAILED in database
                await query(
                    `UPDATE canonical_entity_cache 
                     SET enrichment_status = 'FAILED', updated_at = NOW() 
                     WHERE entity_id = $1`,
                    [entityId]
                );

                if (io) {
                    io.emit('entity:enrichment_failed', {
                        entityId,
                        cin,
                        error: error.message,
                        timestamp: new Date().toISOString()
                    });
                }

                throw error; // Let BullMQ handle retry / backoff
            }
        },
        {
            connection,
            concurrency,
            lockDuration: 180_000, // 3 minutes for long polling lifecycle
        }
    );

    worker.on('failed', (job, err) => {
        console.error(`[EntityEnrichmentWorker] Job ${job?.id} failed with error: ${err.message}`);
    });

    worker.on('error', (err) => {
        console.error(`[EntityEnrichmentWorker] Worker encountered connection error: ${err.message}`);
    });

    console.log(`[EntityEnrichmentWorker] Worker started for queue "${ENTITY_ENRICHMENT_QUEUE_NAME}" (Concurrency: ${concurrency}, LockDuration: 180s)`);
    return worker;
}

