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
            
            // 2. Fetch lead contact details for dispatch.
            // STUB-03 Fix: Include contact_email from lead_cards and lookup from pii_vault
            // if the column exists. Fallback to TEST_RECEIVER_EMAIL for dev/testing.
            const leadRes = await query(
                `SELECT company_name, card_why_now as why_now, contact_email
                 FROM lead_cards WHERE lead_id = $1`,
                [leadId]
            );
            const leadMetadata = leadRes.rows[0] || {};
            
            const contactEmail = process.env.TEST_RECEIVER_EMAIL
                || leadMetadata.contact_email
                || null;

            const dispatchLead = {
                ...leadMetadata,
                leadId,
                contactEmail
            };

            // STUB-01/02: Channel routing with graceful fallback.
            // Attempt EMAIL → WABA → LinkedIn (copy-only) in priority order.
            // Each unconfigured channel is skipped with a log entry rather than throwing.
            const channels: Array<'EMAIL' | 'WABA' | 'LINKEDIN'> = ['EMAIL', 'WABA', 'LINKEDIN'];
            let dispatchResult = null;

            for (const channel of channels) {
                if (!OutreachDispatcher.isConfigured(channel) && channel !== 'LINKEDIN') {
                    console.log(`[OutreachWorker] Channel ${channel} not configured — skipping.`);
                    continue;
                }

                const channelPayload = channel === 'EMAIL'
                    ? { coldEmail: result.coldEmail }
                    : channel === 'WABA'
                    ? { whatsappBody: result.linkedinNote || result.coldEmail?.body }
                    : { linkedinNote: result.linkedinNote };

                const leadForDispatch = {
                    ...dispatchLead,
                    email: contactEmail,
                    phone: leadMetadata.phone,
                    companyName: leadMetadata.company_name,
                };

                const attemptResult = await dispatcher.dispatch(channel, channelPayload, leadForDispatch);

                if (attemptResult.success || (channel === 'LINKEDIN' && attemptResult.copyPayload)) {
                    dispatchResult = attemptResult;
                    // Notify UI with copy payload for LinkedIn
                    if (channel === 'LINKEDIN' && attemptResult.copyPayload) {
                        io.to(`org:${organizationId}`).emit('lead:outreach_copy_ready', {
                            leadId,
                            channel: 'LINKEDIN',
                            copyPayload: attemptResult.copyPayload,
                        });
                    }
                    break;
                }

                // Last channel — if even LinkedIn didn't produce a copy payload, fail
                if (channel === 'LINKEDIN') {
                    throw new Error(
                        `All outreach channels exhausted. EMAIL: ${OutreachDispatcher.isConfigured('EMAIL') ? 'configured but failed' : 'not configured'}. ` +
                        `WABA: ${OutreachDispatcher.isConfigured('WABA') ? 'configured but failed' : 'not configured'}. LinkedIn: copy_only returned no payload.`
                    );
                }
            }

            if (!dispatchResult) {
                throw new Error('No outreach channel is configured. Set SMTP_HOST/SMTP_USER/SMTP_PASS for EMAIL or WABA_TOKEN/WABA_PHONE_NUMBER_ID for WhatsApp.');
            }

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
