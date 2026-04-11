-- =============================================================
-- NetJana Intel Engine — Docker Init SQL
-- Auto-executed on first postgres container start via
-- docker-compose /docker-entrypoint-initdb.d/ mount.
--
-- NOTE: The Node.js initDb() in src/lib/database.ts is the
-- authoritative migration source. This file ensures columns
-- exist even if the app hasn't started yet (e.g., for Go pusher
-- or direct SQL tooling).
-- =============================================================

-- Ensure lead_cards has all audit-remediation columns
-- (Safe to run on fresh or existing DBs — all IF NOT EXISTS)

DO $$
BEGIN
    -- Core table (may already exist from app boot)
    CREATE TABLE IF NOT EXISTS lead_cards (
        lead_id UUID PRIMARY KEY,
        org_id TEXT NOT NULL,
        company_name TEXT NOT NULL,
        geo_state TEXT NOT NULL,
        sector TEXT,
        source_id TEXT NOT NULL,
        source_tier TEXT NOT NULL,
        verity_tier TEXT NOT NULL,
        buying_stage TEXT,
        procurement_category TEXT,
        procurement_timeline TEXT,
        intent_score INT NOT NULL,
        decay_score DECIMAL(5,2) NOT NULL,
        is_triangulated BOOLEAN DEFAULT false,
        triangulated_sources JSONB,
        corroborated BOOLEAN DEFAULT false,
        signal_count INT DEFAULT 1,
        decay_status VARCHAR(20) DEFAULT 'Hot',
        last_decay_calc TIMESTAMPTZ,
        archived_at TIMESTAMPTZ,
        card_company TEXT,
        card_why_now TEXT,
        card_what_they_need TEXT,
        card_do_this TEXT,
        push_status VARCHAR(20) DEFAULT 'PENDING',
        locked_until TIMESTAMPTZ,
        push_attempts INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        feedback_status TEXT DEFAULT NULL,
        feedback_at TIMESTAMPTZ DEFAULT NULL
    );

    -- Idempotent column adds for existing installations
    BEGIN ALTER TABLE lead_cards ADD COLUMN IF NOT EXISTS is_triangulated BOOLEAN DEFAULT false; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TABLE lead_cards ADD COLUMN IF NOT EXISTS triangulated_sources JSONB; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TABLE lead_cards ADD COLUMN IF NOT EXISTS decay_status VARCHAR(20) DEFAULT 'Hot'; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TABLE lead_cards ADD COLUMN IF NOT EXISTS last_decay_calc TIMESTAMPTZ; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TABLE lead_cards ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TABLE lead_cards ADD COLUMN IF NOT EXISTS push_status VARCHAR(20) DEFAULT 'PENDING'; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TABLE lead_cards ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TABLE lead_cards ADD COLUMN IF NOT EXISTS push_attempts INT DEFAULT 0; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_lead_cards_org ON lead_cards (org_id);
CREATE INDEX IF NOT EXISTS idx_lead_cards_decay ON lead_cards (decay_status) WHERE decay_status != 'Dead';
CREATE INDEX IF NOT EXISTS idx_lead_cards_score ON lead_cards (intent_score DESC);
CREATE INDEX IF NOT EXISTS idx_lead_cards_source ON lead_cards (org_id, source_id);
CREATE INDEX IF NOT EXISTS idx_lead_cards_push_queue ON lead_cards (push_status, locked_until);

-- Go pusher needs these tables to exist for batch queries
CREATE TABLE IF NOT EXISTS covospan_push_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL,
    org_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'FAILED', 'SKIPPED')),
    detail TEXT,
    triggered_by TEXT NOT NULL DEFAULT 'auto',
    attempts INT DEFAULT 0,
    campaign_id TEXT,
    pushed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_covospan_log_org ON covospan_push_log (org_id, pushed_at DESC);
CREATE INDEX IF NOT EXISTS idx_covospan_log_lead ON covospan_push_log (lead_id);
CREATE INDEX IF NOT EXISTS idx_covospan_log_status ON covospan_push_log (org_id, status);

RAISE NOTICE 'NetJana init.sql — migration complete';
