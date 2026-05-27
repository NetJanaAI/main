import { db } from '../../lib/database';
import { getHmacSecret } from '../../lib/secrets';
import crypto from 'crypto';

export interface AuditEvent {
    actorId: string;
    organizationId: string;
    action: string;
    resource: string;
    metadata?: any;
}

export class AuditTrail {
    /**
     * Records a secure, immutable audit log entry.
     * In prod, this would also ship to an external WORM (Write Once Read Many) storage.
     */
    static async log(event: AuditEvent) {
        const timestamp = new Date().toISOString();
        const payload = JSON.stringify(event);
        
        // HMAC signature for tamper-evidence (SOC2 requirement)
        const signature = crypto
            .createHmac('sha256', getHmacSecret('audit trail signing'))
            .update(`${timestamp}|${payload}`)
            .digest('hex');

        try {
            await db.query(
                'INSERT INTO audit_logs (id, actor_id, organization_id, action, resource, metadata, signature, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                [crypto.randomUUID(), event.actorId, event.organizationId, event.action, event.resource, event.metadata, signature, timestamp]
            );
        } catch (e: any) {
            console.error('[AuditTrail] Failed to log event:', e.message);
            // Don't throw to avoid breaking main flow, but in high-compliance we might want to fail-closed
        }
    }

    /**
     * GDPR/CCPA PII Masking Utility
     */
    static maskPII(text: string): string {
        // Simple regex-based masking for emails/phones
        return text
            .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]')
            .replace(/\b\d{10,}\b/g, '[REDACTED_SENSITIVE_ID]');
    }
}
