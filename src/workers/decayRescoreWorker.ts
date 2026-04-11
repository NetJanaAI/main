import { Worker, Job, Queue } from 'bullmq';
import { connection } from '../lib/queue';
import { query } from '../lib/database';
import { calculateDecay } from '../core/signals/intentDecay';
import { SecureLogger } from '../utils/logger';
import { Server } from 'socket.io';
import { IS_COVOSPAN } from '../config/mode';
import { isFeatureEnabled, Feature } from '../config/featureFlags';

const scrapeQueue = new Queue('scrape', { connection });

export async function startDecayRescoreWorker(io: Server) {
    const worker = new Worker('decay-rescore', async (job: Job) => {
        console.log(`[DecayWorker] Starting daily rescore at ${new Date().toISOString()}`);
        let totalProcessed = 0;
        
        // 1. Rescore scrape_results (web-scrape originated leads)
        const leads = await query(
            "SELECT id, organization_id, company_name, base_score, signal_captured_at, decay_status, previous_decay_status FROM scrape_results WHERE decay_status != 'Dead'"
        );

        for (const lead of leads.rows) {
            const decay = calculateDecay(parseFloat(lead.base_score), new Date(lead.signal_captured_at));
            
            // 2. Detect transition
            const statusChanged = lead.decay_status !== decay.status;
            const transitionedToCold = lead.decay_status === 'Warm' && decay.status === 'Cold';

            // 3. Update DB
            await query(
                `UPDATE scrape_results SET 
                    freshness_score = $1, 
                    decay_status = $2, 
                    last_decay_calc = NOW(), 
                    previous_decay_status = $3
                 WHERE id = $4`,
                [decay.decayedScore, decay.status, statusChanged ? lead.decay_status : lead.previous_decay_status, lead.id]
            );

            // 4. Handle transitions
            if (transitionedToCold) {
                io.to(`org:${lead.organization_id}`).emit('lead:re_engage_alert', {
                    leadId: lead.id,
                    companyName: SecureLogger.maskPII(lead.company_name),
                    daysSince: decay.daysSince,
                    decayStatus: 'Cold',
                    previousStatus: 'Warm',
                    reengageUrl: `/leads/${lead.id}`
                });

                // 5. Hunter Mode Integration (CovoSpan Only)
                if (IS_COVOSPAN && isFeatureEnabled(Feature.AUTONOMOUS_HUNTER, 'paid')) {
                    if (decay.decayedScore > 75) {
                        console.log(`[Hunter] Auto-rescrape triggered for ${lead.id} due to decay.`);
                        await scrapeQueue.add('scrape', {
                            jobId: `rescrape_${lead.id}_${Date.now()}`,
                            url: lead.url,
                            organizationId: lead.organization_id,
                            reason: 'decay_threshold'
                        });
                        io.to(`org:${lead.organization_id}`).emit('hunter:auto_rescrape_queued', {
                            leadId: lead.id,
                            reason: 'decay_threshold'
                        });
                    }
                }
            }

            // 6. Handle Death (Archiving)
            if (decay.status === 'Dead') {
                await query(
                    "INSERT INTO archived_scrape_results SELECT *, NOW(), 'Signal expired (Dead status)' FROM scrape_results WHERE id = $1",
                    [lead.id]
                );
                await query("DELETE FROM scrape_results WHERE id = $1", [lead.id]);
                io.to(`org:${lead.organization_id}`).emit('lead:archived', { leadId: lead.id });
            }
        }
        totalProcessed += leads.rows.length;

        // M-06: Rescore lead_cards (signal-pipeline originated leads)
        // These were previously never rescored because the worker only queried scrape_results.
        try {
            const pipelineLeads = await query(
                `SELECT lead_id, org_id, company_name, intent_score, decay_score, created_at,
                        COALESCE(decay_status, 'Hot') as decay_status
                 FROM lead_cards
                 WHERE COALESCE(decay_status, 'Hot') != 'Dead'`
            );

            for (const lead of pipelineLeads.rows) {
                const decay = calculateDecay(parseFloat(lead.intent_score), new Date(lead.created_at));

                const statusChanged = lead.decay_status !== decay.status;
                const transitionedToCold = lead.decay_status === 'Warm' && decay.status === 'Cold';

                await query(
                    `UPDATE lead_cards SET 
                        decay_score = $1,
                        decay_status = $2,
                        last_decay_calc = NOW()
                     WHERE lead_id = $3`,
                    [decay.decayedScore, decay.status, lead.lead_id]
                );

                if (transitionedToCold) {
                    io.to(`org:${lead.org_id}`).emit('lead:re_engage_alert', {
                        leadId: lead.lead_id,
                        companyName: SecureLogger.maskPII(lead.company_name),
                        daysSince: decay.daysSince,
                        decayStatus: 'Cold',
                        previousStatus: 'Warm',
                        reengageUrl: `/leads/${lead.lead_id}`,
                        source: 'pipeline'
                    });
                }

                if (decay.status === 'Dead') {
                    // Archive dead pipeline leads (soft delete via status)
                    await query(
                        `UPDATE lead_cards SET decay_status = 'Dead', archived_at = NOW() WHERE lead_id = $1`,
                        [lead.lead_id]
                    );
                    io.to(`org:${lead.org_id}`).emit('lead:archived', { leadId: lead.lead_id, source: 'pipeline' });
                }
            }
            totalProcessed += pipelineLeads.rows.length;
        } catch (e: any) {
            console.warn('[DecayWorker] lead_cards rescore failed (table may not have decay columns yet):', e.message);
        }

        return { processed: totalProcessed };
    }, { connection });

    console.log('[DecayWorker] Daily resonance monitor active.');
    return worker;
}
