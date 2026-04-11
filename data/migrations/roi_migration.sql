-- Migration: ROI Report Export Audit
-- Tracks document integrity and generated-at timestamps for ROI reports.

CREATE TABLE IF NOT EXISTS roi_exports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    hmac_hash TEXT NOT NULL,
    is_redacted BOOLEAN DEFAULT false,
    
    CONSTRAINT fk_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_roi_campaign ON roi_exports (campaign_id);
CREATE INDEX IF NOT EXISTS idx_roi_org ON roi_exports (organization_id);
