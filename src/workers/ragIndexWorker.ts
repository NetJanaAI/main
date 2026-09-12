import { Worker, Job } from 'bullmq';
import { connection, RAG_INDEX_QUEUE_NAME } from '../lib/queue';
import { EntityIndexer, RagIndexJobData } from '../core/rag/EntityIndexer';

export function setupRagIndexWorker(): Worker | null {
    if (process.env.NODE_ENV === 'test') {
        console.log('[RagIndexWorker] Test environment detected; worker skipped.');
        return null;
    }

    const concurrency = process.env.RAG_INDEX_CONCURRENCY 
        ? parseInt(process.env.RAG_INDEX_CONCURRENCY, 10) 
        : 2;

    const worker = new Worker<RagIndexJobData>(
        RAG_INDEX_QUEUE_NAME,
        async (job: Job<RagIndexJobData>) => {
            const data = job.data;
            const orgId = data.orgId || 'default';
            console.log(`[RagIndexWorker] Processing ${data.type} index job (${job.id}) [Org: ${orgId}]`);

            try {
                if (data.type === 'entity' && data.entityData) {
                    await EntityIndexer.indexEntity(data.entityData, orgId);
                } else if (data.type === 'signal' && data.signalData) {
                    await EntityIndexer.indexSignal(data.signalData, orgId);
                } else if (data.type === 'wiki' && data.entityId && data.markdown) {
                    await EntityIndexer.indexWiki(data.entityId, data.title || 'Company Wiki', data.markdown, orgId);
                }
                return { status: 'indexed', type: data.type };
            } catch (err: any) {
                console.error(`[RagIndexWorker] Error indexing ${data.type}:`, err.message);
                throw err;
            }
        },
        {
            connection,
            concurrency,
            lockDuration: 60_000
        }
    );

    worker.on('failed', (job, err) => {
        console.error(`[RagIndexWorker] Job ${job?.id} failed: ${err.message}`);
    });

    console.log(`[RagIndexWorker] Worker started for "${RAG_INDEX_QUEUE_NAME}" (Concurrency: ${concurrency})`);
    return worker;
}
