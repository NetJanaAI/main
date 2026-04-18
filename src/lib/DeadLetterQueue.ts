export interface FailedAnalysis {
    id?: string;
    timestamp?: string;
    url: string;
    error: string;
    rawText: string;
    llmResponse?: string;
    sourceQueue?: string;
    organizationId?: string;
    metadata?: any;
}

import { query } from './database';
import { dlqQueue, tier2Queue } from './queue';

export const DeadLetterQueue = {
    log: async (failure: FailedAnalysis) => {
        try {
            await query(
                'INSERT INTO dead_letter_queue (url, error, raw_text, llm_response, source_queue, organization_id, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                [
                    failure.url, 
                    failure.error, 
                    failure.rawText, 
                    failure.llmResponse || null,
                    failure.sourceQueue || null,
                    failure.organizationId || null,
                    failure.metadata ? JSON.stringify(failure.metadata) : null
                ]
            );
            // Enqueue for async alerting/processing
            await dlqQueue.add('alert_failure', failure);
            
            console.error(`[DLQ] Logged failed analysis for ${failure.url}`);
        } catch (err) {
            console.error('[DLQ] Postgres + Queue fail to write to dead letter queue:', err);
        }
    },

    getAll: async (): Promise<FailedAnalysis[]> => {
        try {
            const result = await query('SELECT * FROM dead_letter_queue ORDER BY created_at DESC LIMIT 100');
            return result.rows.map(row => ({
                id: row.id,
                timestamp: row.created_at,
                url: row.url,
                error: row.error,
                rawText: row.raw_text,
                llmResponse: row.llm_response,
                sourceQueue: row.source_queue,
                organizationId: row.organization_id,
                metadata: row.metadata
            }));
        } catch (err) {
            console.error('[DLQ] Postgres fail to read dead letter queue:', err);
            return [];
        }
    },

    delete: async (id: string) => {
        await query('DELETE FROM dead_letter_queue WHERE id = $1', [id]);
    },

    retry: async (id: string) => {
        const result = await query('SELECT * FROM dead_letter_queue WHERE id = $1', [id]);
        if (result.rows.length === 0) throw new Error("DLQ entry not found");
        
        const row = result.rows[0];
        
        // Re-inject into the target queue (defaulting to tier 2 for automated re-analysis)
        await tier2Queue.add('re-analysis', {
            url: row.url,
            raw_payload: row.raw_text,
            is_retry: true,
            original_error: row.error,
            organization_id: row.organization_id
        });

        // Remove from DLQ on successful re-enqueue
        await query('DELETE FROM dead_letter_queue WHERE id = $1', [id]);
    }
};
