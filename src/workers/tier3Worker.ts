/**
 * Tier 3 Worker — Adversarial Enrichment Pool
 *
 * S1-1 Fix: This worker was missing. tier3Queue.add() is called by the Qualifier
 * when confidence === 'LOW', but no worker was consuming the queue. All LOW-confidence
 * signals were silently accumulating in Redis.
 *
 * Pipeline:
 *  1. Consume from tier3_queue
 *  2. Run AdversarialCritic (Advocate → Critic) on RAG-retrieved docs
 *  3a. If critic validates the signal (isValid: true): re-route to tier2Queue for Lead Writer
 *  3b. If critic rejects (isValid: false): log to DLQ with enrichment failure reason
 */
import { Worker, Job } from 'bullmq';
import { connection, tier2Queue, TIER3_QUEUE_NAME } from '../lib/queue';
import { AdversarialCritic } from '../engines/AdversarialCritic';
import { DeadLetterQueue } from '../lib/DeadLetterQueue';
import { Server } from 'socket.io';
import { db } from '../lib/database';

export function setupTier3Worker(io?: Server | null): Worker {
    const critic = new AdversarialCritic();

    const worker = new Worker(TIER3_QUEUE_NAME, async (job: Job) => {
        const { signal, org_id, is_triangulated, triangulated_sources } = job.data;

        console.log(`[Tier3Worker] Enriching signal ${signal?.signal_id} for org ${org_id}`);

        const rawText = signal?.raw_payload
            ? JSON.stringify(signal.raw_payload)
            : signal?.company_name_clean || 'NO_DATA';

        try {
            // Run the Adversarial Critic loop (Advocate → Critic → consensus)
            const result = await critic.analyze(
                rawText,
                signal?.signal_id || job.id || 'unknown',
                signal?.company_name_clean,
                org_id
            );

            // Critic accepted the signal — re-promote to Tier 2 for Lead Writer
            if (result.complianceVerified || result.frictionScore > 40) {
                console.log(`[Tier3Worker] Signal ${signal?.signal_id} validated by critic (score: ${result.frictionScore}). Re-routing to Tier 2.`);

                await tier2Queue.add('enriched_signal', {
                    ...job.data,
                    enriched: true,
                    critic_analysis: result,
                }, {
                    jobId: `enriched_${signal?.signal_id || Date.now()}`,
                });

                if (io) {
                    io.emit('tier3:promoted', {
                        signal_id: signal?.signal_id,
                        org_id,
                        frictionScore: result.frictionScore,
                    });
                }

                return { status: 'promoted_to_tier2', frictionScore: result.frictionScore };
            }

            // Critic rejected the signal — log to DLQ for operator review
            console.warn(`[Tier3Worker] Signal ${signal?.signal_id} rejected by critic (score: ${result.frictionScore}). Sending to DLQ.`);

            await DeadLetterQueue.log({
                timestamp: new Date().toISOString(),
                url: signal?.company_name_clean || 'unknown',
                error: `Tier3 Enrichment: Critic rejected signal. Score: ${result.frictionScore}. Summary: ${result.intentSummary}`,
                rawText: rawText.substring(0, 1000),
                organizationId: org_id,
                sourceQueue: TIER3_QUEUE_NAME,
                metadata: {
                    signal_id: signal?.signal_id,
                    critic_summary: result.intentSummary,
                    friction_score: result.frictionScore,
                },
            });

            return { status: 'rejected_to_dlq', frictionScore: result.frictionScore };

        } catch (err: any) {
            console.error(`[Tier3Worker] Job ${job.id} failed:`, err.message);

            await DeadLetterQueue.log({
                timestamp: new Date().toISOString(),
                url: signal?.company_name_clean || 'unknown',
                error: `Tier3 Worker Error: ${err.message}`,
                rawText: rawText.substring(0, 500),
                organizationId: org_id,
                sourceQueue: TIER3_QUEUE_NAME,
                metadata: { signal_id: signal?.signal_id, job_id: job.id },
            });

            throw err; // BullMQ will retry per queue config
        }
    }, {
        connection,
        concurrency: 1, // Adversarial critic is LLM-heavy — 1 at a time to stay within spend guard
    });

    worker.on('completed', (job) => {
        console.log(`[Tier3Worker] Job ${job.id} completed.`);

        // Write heartbeat to system_canaries
        db.query(`
            INSERT INTO system_canaries (type, status, last_heartbeat, metadata, updated_at)
            VALUES ('TIER3_WORKER', 'OK', NOW(), $1, NOW())
            ON CONFLICT (type)
            DO UPDATE SET status = 'OK', last_heartbeat = NOW(), metadata = EXCLUDED.metadata, updated_at = NOW()
        `, [JSON.stringify({ pid: process.pid })]).catch(() => {});
    });

    worker.on('failed', (job, err) => {
        console.error(`[Tier3Worker] Job ${job?.id} failed permanently:`, err.message);
    });

    console.log('[Tier3Worker] Adversarial enrichment pool active.');
    return worker;
}
