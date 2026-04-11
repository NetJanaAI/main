import nodemailer from 'nodemailer';
import axios from 'axios';
import { SecureLogger } from "../../utils/logger";
import { query } from "../../lib/database";

export interface DispatchResult {
    success: boolean;
    channel: 'EMAIL' | 'WABA' | 'LINKEDIN';
    messageId?: string;
    error?: string;
}

export class OutreachDispatcher {
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
        if (!to) return { success: false, channel: 'EMAIL', error: 'No recipient email found' };

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

        // SDK STUB: In production, this calls Meta Graph API or a provider like Twilio/Gupshup
        console.log(`[Dispatcher:WABA] MISSION SIMULATION: Sending to ${phone}`);
        console.log(`[Dispatcher:WABA] CONTENT: ${body}`);

        try {
            // Simulated HTTP call to WABA endpoint
            /*
            await axios.post('https://api.netjana.com/v1/waba/dispatch', {
                to: phone,
                message: body,
                priority: 'high'
            }, { headers: { 'Authorization': `Bearer ${process.env.WABA_TOKEN}` }});
            */
            return { success: true, channel: 'WABA', messageId: `waba_${Date.now()}` };
        } catch (error: any) {
            return { success: false, channel: 'WABA', error: error.message };
        }
    }

    private async dispatchLinkedIn(note: string, profile: string): Promise<DispatchResult> {
        if (!profile) return { success: false, channel: 'LINKEDIN', error: 'No LinkedIn profile found' };

        // SDK STUB: In production, this uses LinkedIn Messaging API or an automation bridge
        console.log(`[Dispatcher:LinkedIn] MISSION SIMULATION: Messaging ${profile}`);
        console.log(`[Dispatcher:LinkedIn] NOTE: ${note}`);

        return { success: true, channel: 'LINKEDIN', messageId: `li_${Date.now()}` };
    }
}
