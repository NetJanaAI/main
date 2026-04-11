import { query } from "../../lib/database";
import { SecureLogger } from "../../utils/logger";

export interface LogEntry {
    organizationId: string;
    namespace: string;
    operation: 'read' | 'write' | 'delete';
    docId?: string;
    requestId?: string;
    metadata?: any;
}

export class RAGAuditLog {
    /**
     * Records an immutable entry in the RAG audit log.
     * Automatically redacts PII from metadata.
     */
    static async log(entry: LogEntry) {
        try {
            // 1. Redact PII from any metadata or identifiers
            const sanitizedDocId = entry.docId ? SecureLogger.maskPII(entry.docId) : null;
            const sanitizedMetadata = entry.metadata ? JSON.parse(SecureLogger.maskPII(JSON.stringify(entry.metadata))) : null;

            // 2. Insert into PostgreSQL (Append-only)
            await query(`
                INSERT INTO rag_audit_log (
                    organization_id, namespace, operation, doc_id, request_id, metadata
                ) VALUES ($1, $2, $3, $4, $5, $6)
            `, [
                entry.organizationId,
                entry.namespace,
                entry.operation,
                sanitizedDocId,
                entry.requestId || null,
                sanitizedMetadata
            ]);
            
            console.log(`[RAG-Audit] Logged ${entry.operation} on ${entry.namespace}`);
        } catch (e) {
            console.error('[RAG-Audit] FAILED TO LOG RAG OPERATION:', e);
            // In a mission-critical system, we might want to throw here to prevent the operation if logging fails.
        }
    }
}
