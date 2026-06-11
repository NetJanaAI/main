import nodemailer from 'nodemailer';
import axios from 'axios';
import { query } from "../../lib/database";

export interface DispatchResult {
    success: boolean;
    channel: 'EMAIL' | 'WABA' | 'LINKEDIN';
    messageId?: string;
    error?: string;
    unconfigured?: boolean; // S1-3: true when credentials are missing (stub) vs. a real send failure
    copyPayload?: string;   // P0-C: LinkedIn copy-to-clipboard fallback text
}

export interface ChannelStatus {
    configured: boolean;
    mode: 'live' | 'stub' | 'copy_only';
}

export class OutreachDispatcher {
    /**
     * S1-3: Check whether a channel is actually configured before attempting dispatch.
     * Used by the outreach worker to prevent silent stub completions from appearing as successes.
     */
    static isConfigured(channel: 'EMAIL' | 'WABA' | 'LINKEDIN'): boolean {
        switch (channel) {
            case 'EMAIL':
                return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
            case 'WABA':
                return Boolean(process.env.WABA_TOKEN && process.env.WABA_PHONE_NUMBER_ID);
            case 'LINKEDIN':
                // P0-C: LinkedIn messaging requires OAuth partner-level access (not a standard token).
                // Always returns false — LinkedIn is handled as copy_only, never auto-sent.
                return false;
        }
    }

    /**
     * P0-C: Returns the full status of all outreach channels, including mode.
     * Used by GET /api/outreach/channels/status to gate frontend UI affordances.
     */
    static getChannelStatuses(): Record<'EMAIL' | 'WABA' | 'LINKEDIN', ChannelStatus> {
        return {
            EMAIL: {
                configured: OutreachDispatcher.isConfigured('EMAIL'),
                mode: OutreachDispatcher.isConfigured('EMAIL') ? 'live' : 'stub'
            },
            WABA: {
                configured: OutreachDispatcher.isConfigured('WABA'),
                mode: OutreachDispatcher.isConfigured('WABA') ? 'live' : 'stub'
            },
            LINKEDIN: {
                // P0-C: LinkedIn is intentionally copy_only — never auto-dispatched.
                // The correct integration requires LinkedIn Marketing API OAuth partner access.
                configured: false,
                mode: 'copy_only'
            }
        };
    }

    /**
     * P0-C: Returns a formatted message payload for copy-to-clipboard LinkedIn outreach.
     * The frontend uses this instead of auto-sending when channel mode is 'copy_only'.
     */
    static getLinkedInCopyPayload(note: string, companyName?: string): string {
        const greeting = companyName ? `Hi, I noticed ${companyName}` : 'Hi,';
        return `${greeting}\n\n${note}\n\nLooking forward to connecting.`;
    }

    private async logDispatch(leadId: string, channel: string, status: string, error?: string) {
        try {
            await query(
                'INSERT INTO outreach_logs (id, lead_id, channel, status, sent_at) VALUES (gen_random_uuid(), $1, $2, $3, NOW())',
                [leadId, channel, status]
            );
        } catch (dbErr: any) {
            console.error(`[Dispatcher:Log] Failed to log outreach:`, dbErr.message);
        }
    }

    /**
     * Unified Dispatcher for B2B Outreach
     */
    async dispatch(channel: string, payload: any, lead: any): Promise<DispatchResult> {
        console.log(`[Dispatcher] Routing mission to ${channel} for ${lead.companyName || lead.domain}`);

        let result: DispatchResult;
        switch (channel.toUpperCase()) {
            case 'EMAIL':
                result = await this.dispatchEmail(payload.coldEmail, lead.contactEmail || lead.email);
                break;
            case 'WABA':
                result = await this.dispatchWaba(payload.whatsappBody || payload.linkedinNote, lead.phone);
                break;
            case 'LINKEDIN':
                // P0-C: LinkedIn is copy_only — never auto-dispatched
                result = this.dispatchLinkedIn(payload.linkedinNote, lead.companyName);
                break;
            default:
                result = { success: false, channel: channel as any, error: `Unknown channel: ${channel}` };
        }

        if (lead.leadId) {
            // Log COPY_READY for LinkedIn so the worker knows to surface the copy payload
            const logStatus = channel.toUpperCase() === 'LINKEDIN' ? 'COPY_READY' : (result.success ? 'SENT' : 'FAILED');
            await this.logDispatch(lead.leadId, channel, logStatus, result.error);
        }

        return result;
    }

    private async dispatchEmail(email: { subject: string; body: string }, to: string): Promise<DispatchResult> {
        if (!OutreachDispatcher.isConfigured('EMAIL')) {
            return {
                success: false,
                channel: 'EMAIL',
                unconfigured: true,
                error: 'EMAIL_UNCONFIGURED: Set SMTP_HOST, SMTP_USER, and SMTP_PASS to enable email dispatch.'
            };
        }
        if (!to) return { success: false, channel: 'EMAIL', error: 'No recipient email found' };
        if (to === 'recipient@example.com') {
            return { success: false, channel: 'EMAIL', error: 'Refusing to dispatch to placeholder recipient.' };
        }

        try {
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: parseInt(process.env.SMTP_PORT || '587'),
                secure: process.env.SMTP_SECURE === 'true',
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS,
                },
            });

            const info = await transporter.sendMail({
                from: `"NetJana Intelligence" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
                to,
                subject: email.subject,
                text: email.body,
                html: email.body.replace(/\n/g, '<br>'),
            });

            console.log(`[Dispatcher:Email] Sent to ${to}. MessageId: ${info.messageId}`);
            return { success: true, channel: 'EMAIL', messageId: info.messageId };
        } catch (error: any) {
            console.error(`[Dispatcher:Email] Failed:`, error.message);
            return { success: false, channel: 'EMAIL', error: error.message };
        }
    }

    private async dispatchWaba(body: string, phone: string): Promise<DispatchResult> {
        if (!phone) return { success: false, channel: 'WABA', error: 'No phone number found' };

        const token = process.env.WABA_TOKEN;
        const phoneNumberId = process.env.WABA_PHONE_NUMBER_ID;

        if (!token || !phoneNumberId) {
            console.warn(`[Dispatcher:WABA] WABA_TOKEN / WABA_PHONE_NUMBER_ID not configured.`);
            return {
                success: false,
                channel: 'WABA',
                unconfigured: true, // S1-3: signals the outreach worker to DLQ this job
                error: 'STUB_UNIMPLEMENTED: Set WABA_TOKEN and WABA_PHONE_NUMBER_ID to enable WhatsApp dispatch.'
            };
        }

        try {
            const response = await axios.post(
                `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`,
                {
                    messaging_product: 'whatsapp',
                    to: phone.replace(/[^0-9]/g, ''),
                    type: 'text',
                    text: { body }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            console.log(`[Dispatcher:WABA] Sent to ${phone}. MessageId: ${response.data.messages?.[0]?.id}`);
            return { success: true, channel: 'WABA', messageId: response.data.messages?.[0]?.id };
        } catch (error: any) {
            console.error(`[Dispatcher:WABA] Failed:`, error.response?.data || error.message);
            return { success: false, channel: 'WABA', error: error.response?.data?.error?.message || error.message };
        }
    }

    /**
     * P0-C Fix: LinkedIn auto-dispatch is NOT supported.
     *
     * The LinkedIn Messaging API requires OAuth partner-level access — not available via a
     * standard developer token. The previous implementation called `https://api.linkedin.com/v2/messages`
     * which does not exist in the public API and would always fail in production.
     *
     * This method returns a `copyPayload` that the frontend surfaces as a copy-to-clipboard
     * action. The outreach worker logs this as 'COPY_READY' rather than 'SENT' or 'FAILED'.
     */
    private dispatchLinkedIn(note: string, companyName?: string): DispatchResult {
        const copyPayload = OutreachDispatcher.getLinkedInCopyPayload(note, companyName);
        console.log(`[Dispatcher:LinkedIn] LinkedIn auto-send not supported. Returning copy payload for manual outreach.`);
        return {
            success: false,
            channel: 'LINKEDIN',
            unconfigured: true,
            copyPayload,
            error: 'LINKEDIN_UNAVAILABLE: LinkedIn messaging requires OAuth partner access. Use the copy payload for manual outreach.'
        };
    }
}
