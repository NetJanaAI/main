import { cache } from '../cache';
import { db } from '../database';

/**
 * TokenTracker — Handles telemetry and persistence for LLM usage.
 * Tracks real-time velocity in Redis and structured logs in Postgres.
 */
export class TokenTracker {
    /**
     * Estimates token count for a string. 
     * Uses a simplistic ~4 characters per token heuristic for estimation.
     * In production, this can be swapped for a real tiktoken-based counter.
     */
    static estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
    }

    /**
     * Calculates tokens saved by TOON by comparing JSON vs TOON sizes.
     */
    static calculateToonSavings(originalJson: any, toonString: string): number {
        const originalEstimated = TokenTracker.estimateTokens(JSON.stringify(originalJson));
        const toonEstimated = TokenTracker.estimateTokens(toonString);
        return Math.max(0, originalEstimated - toonEstimated);
    }

    /**
     * Record usage after an LLM call.
     */
    static async recordUsage(params: {
        orgId: string;
        role: string;
        model: string;
        inputTokens: number;
        outputTokens: number;
        tokensSaved?: number;
    }) {
        const { orgId, role, model, inputTokens, outputTokens, tokensSaved = 0 } = params;
        const dateStr = new Date().toISOString().split('T')[0];

        // 1. Real-time Telemetry (Redis)
        const dayKey = `usage:${orgId}:${dateStr}`;
        const pipeline = cache.pipeline();
        pipeline.hincrby(dayKey, 'input', inputTokens);
        pipeline.hincrby(dayKey, 'output', outputTokens);
        pipeline.hincrby(dayKey, 'saved', tokensSaved);
        pipeline.expire(dayKey, 86400 * 7); // Keep 7 days of daily redis stats
        await pipeline.exec();

        // 2. Global Speedometer (Input/Output rates for dashboard)
        await cache.incrby(`global:tokens:input`, inputTokens);
        await cache.incrby(`global:tokens:output`, outputTokens);
        await cache.incrby(`global:tokens:saved`, tokensSaved);

        // 3. Persistent Audit (Postgres) — background fire-and-forget
        db.query(
            `INSERT INTO llm_usage_logs (org_id, role, model, input_tokens, output_tokens, tokens_saved)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [orgId, role, model, inputTokens, outputTokens, tokensSaved]
        ).catch(e => console.warn('[TokenTracker] Log error:', e.message));
    }

    /**
     * Get real-time stats for an organization.
     */
    static async getStats(orgId: string, days: number = 1): Promise<any> {
        const stats = [];
        for (let i = 0; i < days; i++) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            const data = await cache.hgetall(`usage:${orgId}:${dateStr}`);
            stats.push({ date: dateStr, ...data });
        }
        return stats;
    }
}
