-- Migration: India/UAE Influence Map & Alpha Scoring
-- Adds columns for regional influence mapping and composite alpha scoring.

ALTER TABLE scrape_results 
ADD COLUMN IF NOT EXISTS influence_score DECIMAL(5,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS influence_enriched_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS alpha_score DECIMAL(5,2) DEFAULT 0;

-- Dedicated table for rich influence JSON data
CREATE TABLE IF NOT EXISTS lead_influence_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    influence_map JSONB NOT NULL,
    enriched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT fk_lead FOREIGN KEY (lead_id) REFERENCES scrape_results(job_id) ON DELETE CASCADE
);

-- Indices for influence queries
CREATE INDEX IF NOT EXISTS idx_influence_lead ON lead_influence_data (lead_id);
CREATE INDEX IF NOT EXISTS idx_influence_org ON lead_influence_data (organization_id);
CREATE INDEX IF NOT EXISTS idx_leads_alpha ON scrape_results (organization_id, alpha_score);
