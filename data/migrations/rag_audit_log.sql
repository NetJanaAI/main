-- SQL Migration: rag_audit_log
-- Purpose: Append-only, immutable audit trail for all RAG operations.
-- Compliance: GDPR Article 5, India DPDP Act Section 4.

CREATE TABLE IF NOT EXISTS rag_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id VARCHAR(255) NOT NULL,
    namespace VARCHAR(255) NOT NULL,
    operation VARCHAR(50) CHECK (operation IN ('read', 'write', 'delete')),
    doc_id VARCHAR(255),
    request_id UUID,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB -- For storing non-PII contextual info
);

-- Deny UPDATE and DELETE on the audit log to ensure immutability
REVOKE UPDATE, DELETE ON rag_audit_log FROM PUBLIC;

-- Indexing for admin lookups
CREATE INDEX idx_rag_audit_org ON rag_audit_log(organization_id);
CREATE INDEX idx_rag_audit_ts ON rag_audit_log(timestamp);
