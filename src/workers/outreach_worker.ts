import { Worker, Job } from 'bullmq';
import { connection, OUTREACH_QUEUE_NAME } from '../lib/queue';
import { OutreachGenerator } from '../core/outreach/OutreachGenerator';
import { OutreachDispatcher } from '../core/outreach/OutreachDispatcher';
import { query } from '../lib/database';
import { Server } from 'socket.io';
import { DeadLetterQueue } from '../lib/DeadLetterQueue';

export async function startOutreachWorker(io: Server) {
    const generator = new OutreachGenerator();
    const dispatcher = new OutreachDispatcher();

    const worker = new Worker(OUTREACH_QUEUE_NAME, async (job: Job) => {
        const { leadId, organizationId, tone } = job.data;
        
        console.log(`[OutreachWorker] Processing job ${job.id} for lead ${leadId}`);

        try {
            const result = await generator.generate(leadId, organizationId, tone);
            
            // 2. Fetch lead contact details for dispatch
            const leadRes = await query('SELECT company_name, card_why_now as why_now FROM lead_cards WHERE lead_id = $1', [leadId]);
            const leadMetadata = leadRes.rows[0] || {};
            
            // To provide real emails/phones, in this system we check the 'vault' or the original signal
            // For now, we'll pass what we have + the leadId for logging
            const dispatchLead = {
                ...leadMetadata,
                leadId,
                // Fallback email/phone logic would go here
                contactEmail: process.env.TEST_RECEIVER_EMAIL || 'recipient@example.com' 
            };

            // 3. Dispatch to primary channel (defaulting to EMAIL)
            const dispatchResult = await dispatcher.dispatch('EMAIL', result, dispatchLead);

            // 4. Notify UI via Socket.IO
            io.to(`org:${organizationId}`).emit('lead:outreach_ready', {
                leadId,
                payload: result,
                dispatch: dispatchResult
            });

            return { ...result, dispatch: dispatchResult };
        } catch (error: any) {
            console.error(`[OutreachWorker] Job ${job.id} failed:`, error.message);
            
            await DeadLetterQueue.log({
                timestamp: new Date().toISOString(),
                url: `lead:${leadId}`,
                error: `Outreach Generation Failed: ${error.message}`,
                rawText: JSON.stringify(job.data),
                organizationId,
                sourceQueue: 'outreach_queue'
            });

            // Notify UI of explicit failure
            io.to(`org:${organizationId}`).emit('lead:outreach_failed', { leadId, error: error.message });
            
            throw error;
        }
    }, { connection });

    console.log('[OutreachWorker] Ready to process missions.');
    return worker;
}
