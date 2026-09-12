-- 0010_rag_embeddings_and_wiki.sql
-- Persistent Vector Store (pgvector) and Company Wiki Layer

-- 1. pgvector extension (if available)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Persistent RAG embeddings table
CREATE TABLE IF NOT EXISTS rag_embeddings (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        TEXT NOT NULL,
    entity_id     TEXT,                     -- links to canonical_entity_cache(entity_id)
    doc_type      TEXT NOT NULL,            -- 'entity' | 'signal' | 'upload' | 'wiki'
    source_id     TEXT,                     -- 'insta_financials', 'gem', 'wiki_editor', upload filename, etc.
    chunk_index   INT NOT NULL DEFAULT 0,
    content       TEXT NOT NULL,
    content_hash  TEXT NOT NULL,           -- SHA-256 for idempotent dedup
    metadata      JSONB DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (org_id, doc_type, content_hash)
);

-- Conditionally add embedding column based on vector extension availability
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'rag_embeddings' AND column_name = 'embedding'
        ) THEN
            ALTER TABLE rag_embeddings ADD COLUMN embedding vector(768);
        END IF;
    ELSE
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'rag_embeddings' AND column_name = 'embedding'
        ) THEN
            ALTER TABLE rag_embeddings ADD COLUMN embedding JSONB;
        END IF;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rag_embeddings_org_type ON rag_embeddings (org_id, doc_type);
CREATE INDEX IF NOT EXISTS idx_rag_embeddings_entity ON rag_embeddings (entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rag_embeddings_hash ON rag_embeddings (content_hash);

-- Try to create ivfflat index if vector is available
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
        BEGIN
            CREATE INDEX IF NOT EXISTS idx_rag_embeddings_vec 
            ON rag_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
        EXCEPTION WHEN OTHERS THEN
            -- ivfflat can fail if table is empty or lists exceeds row count; graceful fallback
            NULL;
        END;
    END IF;
END $$;

ALTER TABLE rag_embeddings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rag_embeddings' AND policyname = 'org_isolation_policy_rag') THEN
        DROP POLICY org_isolation_policy_rag ON rag_embeddings;
    END IF;
    CREATE POLICY org_isolation_policy_rag ON rag_embeddings
    USING (
        current_setting('app.bypass_rls', true) = 'true'
        OR org_id = current_setting('app.current_organization_id')
    );
END $$;

-- 3. Company Wiki Pages (per-tenant human curated company knowledge)
CREATE TABLE IF NOT EXISTS wiki_pages (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        TEXT NOT NULL,
    entity_id     TEXT NOT NULL,            -- links to canonical_entity_cache(entity_id)
    slug          TEXT NOT NULL,
    title         TEXT NOT NULL,
    body_md       TEXT NOT NULL DEFAULT '',
    author_id     TEXT,
    author_name   TEXT,
    version       INT NOT NULL DEFAULT 1,
    is_published  BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (org_id, entity_id)
);

-- 4. Wiki Revisions (Auditable version history with diffs)
CREATE TABLE IF NOT EXISTS wiki_revisions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id       UUID NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
    org_id        TEXT NOT NULL,
    entity_id     TEXT NOT NULL,
    body_md       TEXT NOT NULL,
    author_id     TEXT,
    author_name   TEXT,
    version       INT NOT NULL,
    change_summary TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wiki_pages_org_entity ON wiki_pages (org_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_org_slug ON wiki_pages (org_id, slug);
CREATE INDEX IF NOT EXISTS idx_wiki_revisions_page ON wiki_revisions (page_id, version DESC);

ALTER TABLE wiki_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE wiki_revisions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'wiki_pages' AND policyname = 'org_isolation_policy_wiki') THEN
        DROP POLICY org_isolation_policy_wiki ON wiki_pages;
    END IF;
    CREATE POLICY org_isolation_policy_wiki ON wiki_pages
    USING (
        current_setting('app.bypass_rls', true) = 'true'
        OR org_id = current_setting('app.current_organization_id')
    );

    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'wiki_revisions' AND policyname = 'org_isolation_policy_wiki_rev') THEN
        DROP POLICY org_isolation_policy_wiki_rev ON wiki_revisions;
    END IF;
    CREATE POLICY org_isolation_policy_wiki_rev ON wiki_revisions
    USING (
        current_setting('app.bypass_rls', true) = 'true'
        OR org_id = current_setting('app.current_organization_id')
    );
END $$;
