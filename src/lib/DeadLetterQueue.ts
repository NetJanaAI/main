import { query } from './database';

export interface FailedAnalysis {
    timestamp: string;
    url: string;
    error: string;
    rawText: string;
    llmResponse?: string;
}

export const DeadLetterQueue = {
    log: async (failure: FailedAnalysis) => {
        try {
            await query(
                'INSERT INTO dead_letter_queue (url, error, raw_text, llm_response) VALUES ($1, $2, $3, $4)',
                [failure.url, failure.error, failure.rawText, failure.llmResponse || null]
            );
            console.error(`[DLQ] Logged failed analysis for ${failure.url}`);
        } catch (err) {
            console.error('[DLQ] Postgres fail to write to dead letter queue:', err);
        }
    },

    getAll: async (): Promise<FailedAnalysis[]> => {
        try {
            const result = await query('SELECT * FROM dead_letter_queue ORDER BY created_at DESC LIMIT 100');
            return result.rows.map(row => ({
                timestamp: row.created_at,
                url: row.url,
                error: row.error,
                rawText: row.raw_text,
                llmResponse: row.llm_response
            }));
        } catch (err) {
            console.error('[DLQ] Postgres fail to read dead letter queue:', err);
            return [];
        }
    }
};
