-- Migration: Lead Intent Decay Tracking
-- Adds columns to track signal freshness and autonomous re-engagement triggers.

ALTER TABLE scrape_results 
ADD COLUMN IF NOT EXISTS base_score DECIMAL(5,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS signal_captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS freshness_score DECIMAL(5,2) DEFAULT 100,
ADD COLUMN IF NOT EXISTS decay_status VARCHAR(10) DEFAULT 'Hot',
ADD COLUMN IF NOT EXISTS last_decay_calc TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS previous_decay_status VARCHAR(10);

-- Indices for performance on stale lead queues
CREATE INDEX IF NOT EXISTS idx_leads_decay_status ON scrape_results (organization_id, decay_status);
CREATE INDEX IF NOT EXISTS idx_leads_freshness ON scrape_results (organization_id, freshness_score);

-- Archive table for Dead leads
CREATE TABLE IF NOT EXISTS archived_scrape_results (
    LIKE scrape_results INCLUDING ALL,
    archived_at TIMESTAMPTZ DEFAULT NOW(),
    archival_reason TEXT
);
