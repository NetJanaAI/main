import nodemailer from 'nodemailer';
import axios from 'axios';
import { SecureLogger } from "../../utils/logger";
import { query } from "../../lib/database";

export interface DispatchResult {
    success: boolean;
    channel: 'EMAIL' | 'WABA' | 'LINKEDIN';
    messageId?: string;
    error?: string;
    unconfigured?: boolean; // S1-3: true when credentials are missing (stub) vs. a real send failure
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
                return Boolean(process.env.LINKEDIN_TOKEN && process.env.LINKEDIN_URN);
        }
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
                result = await this.dispatchLinkedIn(payload.linkedinNote, lead.linkedinProfile);
                break;
            default:
                result = { success: false, channel: channel as any, error: `Unknown channel: ${channel}` };
        }

        if (lead.leadId) {
            await this.logDispatch(lead.leadId, channel, result.success ? 'SENT' : 'FAILED', result.error);
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

    private async dispatchLinkedIn(note: string, profile: string): Promise<DispatchResult> {
        if (!profile) return { success: false, channel: 'LINKEDIN', error: 'No LinkedIn profile found' };

        const token = process.env.LINKEDIN_TOKEN;
        const authorUrn = process.env.LINKEDIN_URN;

        if (!token || !authorUrn) {
            console.warn(`[Dispatcher:LinkedIn] LINKEDIN_TOKEN / LINKEDIN_URN not configured.`);
            return {
                success: false,
                channel: 'LINKEDIN',
                unconfigured: true, // S1-3: signals the outreach worker to DLQ this job
                error: 'STUB_UNIMPLEMENTED: Set LINKEDIN_TOKEN and LINKEDIN_URN to enable LinkedIn dispatch.'
            };
        }

        // Note: Sending a message directly to a profile URL requires resolving the profile URL to a LinkedIn Member URN.
        // For simplicity in this implementation, we assume `profile` is the target Member URN if it starts with 'urn:li:person:',
        // otherwise we simulate a failure or a resolution step.
        let targetUrn = profile;
        if (!targetUrn.startsWith('urn:li:person:')) {
             // In a real scenario, we'd look up the URN. For now, we'll try to extract it or fallback.
             targetUrn = `urn:li:person:${profile.split('/').pop() || 'unknown'}`;
        }

        try {
            const response = await axios.post(
                'https://api.linkedin.com/v2/messages',
                {
                    recipients: [targetUrn],
                    subject: 'NetJana Intent Outreach',
                    body: note,
                    messageType: 'MEMBER_TO_MEMBER'
                },
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                        'X-Restli-Protocol-Version': '2.0.0'
                    }
                }
            );

            console.log(`[Dispatcher:LinkedIn] Sent to ${profile}. MessageId: ${response.data.id}`);
            return { success: true, channel: 'LINKEDIN', messageId: response.data.id };
        } catch (error: any) {
            console.error(`[Dispatcher:LinkedIn] Failed:`, error.response?.data || error.message);
            return { success: false, channel: 'LINKEDIN', error: error.response?.data?.message || error.message };
        }
    }
}
