# ConvoSpan Intel — Implementation Plan
## Infrastructure Transformation + Product Repositioning

**Date:** March 2026  
**Status:** In Progress

> **North Star:** Stop building infrastructure that fights websites.  
> Build infrastructure that reads governments.

---

## STRATEGIC OVERVIEW

| Pillar | Current State | Target State |
|--------|--------------|--------------|
| **Cache** | Self-hosted `ioredis` in app code | Managed Upstash Redis (serverless, edge) |
| **Entity Registry** | Redis hashes (`org:*` keys) | Postgres tables with audit trail |
| **AI Layer** | Gemini hardwired into BullMQ workers | Provider-agnostic ModelAPI service |
| **Product Narrative** | "B2B Scraper" | "Government Registry Intelligence Layer" |

---

## PHASE 1 — Managed Cache (Upstash Redis)
**Effort: 1 day | Risk: Low**

### Goal
Replace raw `ioredis` instances in application code with a single managed Upstash Redis client. BullMQ keeps its own `ioredis` connection — do **not** merge them.

### New File: `src/lib/cache.ts`
```typescript
import { Redis } from '@upstash/redis';

export const cache = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});
```

### Files to Update

- [ ] `src/lib/cache.ts` — **CREATE** (Upstash client singleton)
- [ ] `src/core/entity-resolver.ts` — replace `ioredis` import with `cache`
- [ ] `src/core/collectors/indiamart-dedup.ts` — replace `ioredis` import with `cache`
- [ ] `src/core/gemini-chain.ts` — replace spend-guard `ioredis` instance with `cache`

### Install
```bash
npm install @upstash/redis
```

### New ENV Vars
```env
UPSTASH_REDIS_REST_URL=https://xxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AXxx...
```

### Important Rule
```
BullMQ connection (src/lib/queue.ts) ← ioredis, maxRetriesPerRequest: null — NEVER CHANGE
App-level KV (cache.ts)              ← Upstash REST — all dedup, locks, spend counters
```

---

## PHASE 2 — Postgres Entity Registry
**Effort: 2 days | Risk: Medium**

### Goal
Move entity resolution data from Redis hashes (ephemeral, unqueryable) to Postgres tables (durable, indexed, auditable). The Upstash cache from Phase 1 acts as a read-through layer for hot-path speed.

### Problem with current state
- Redis `org:*` hashes — lost on cache eviction, cannot be queried or joined
- `entity:merge_log` Redis list — capped at 5000 entries, unqueryable
- `entity:phonetic:*` Redis sets — no compound indexing, no partial match

### New Tables — add to `initDb()` in `src/lib/database.ts`

```sql
-- Canonical organization registry
CREATE TABLE IF NOT EXISTS org_registry (
    org_id            TEXT PRIMARY KEY,
    canonical_name    TEXT NOT NULL,
    geo_state         TEXT NOT NULL,
    geo_market        TEXT NOT NULL DEFAULT 'IN',
    phonetic_key      TEXT,
    cin               TEXT,
    resolution_method TEXT NOT NULL,
    first_seen        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_signal_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    signal_count      INT NOT NULL DEFAULT 1,
    cumulative_score  DECIMAL(6,2) DEFAULT 0,
    verity_tier       TEXT NOT NULL DEFAULT 'UNSCORED',
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_canonical ON org_registry (canonical_name, geo_state);
CREATE INDEX IF NOT EXISTS idx_org_phonetic  ON org_registry (phonetic_key, geo_state);
CREATE INDEX IF NOT EXISTS idx_org_cin       ON org_registry (cin) WHERE cin IS NOT NULL;

-- Immutable merge / resolution audit log
CREATE TABLE IF NOT EXISTS entity_merge_log (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_name          TEXT NOT NULL,
    clean_name        TEXT NOT NULL,
    merged_into       TEXT NOT NULL REFERENCES org_registry(org_id),
    resolution_method TEXT NOT NULL,
    merged_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_merge_org ON entity_merge_log (merged_into);
CREATE INDEX IF NOT EXISTS idx_merge_at  ON entity_merge_log (merged_at);
```

### Resolution Flow (unchanged order, new backend)

```
1. Exact match  → SELECT FROM org_registry WHERE canonical_name=$1 AND geo_state=$2
2. CIN lookup   → SELECT FROM org_registry WHERE cin=$1
3. Phonetic     → SELECT FROM org_registry WHERE phonetic_key=$1 AND geo_state=$2
4. MCA API      → external call → INSERT INTO org_registry
5. Local hash   → INSERT INTO org_registry
All steps       → INSERT INTO entity_merge_log
```

### Cache Read-Through Pattern

```typescript
const cacheKey = `entity:exact:${cleanName}:${stateCode}`;
const cached = await cache.get(cacheKey);
if (cached) return cached as string;

const result = await query(
    'SELECT org_id FROM org_registry WHERE canonical_name=$1 AND geo_state=$2',
    [cleanName, stateCode]
);
if (result.rows[0]) {
    await cache.set(cacheKey, result.rows[0].org_id, { ex: 86400 }); // 24h TTL
    return result.rows[0].org_id;
}
```

### Distributed Lock — Postgres Advisory Locks

Replace `redis.set(key, '1', 'EX', 5, 'NX')` with:

```typescript
function nameToLockId(name: string): number {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = (Math.imul(31, hash) + name.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

const lockId = nameToLockId(`${cleanName}:${stateCode}`);
const { rows } = await query('SELECT pg_try_advisory_lock($1)', [lockId]);
if (!rows[0].pg_try_advisory_lock) {
    await new Promise(r => setTimeout(r, 300));
    return resolveEntity(rawName, geoState, cinHint);
}
try {
    return await resolveEntity(rawName, geoState, cinHint);
} finally {
    await query('SELECT pg_advisory_unlock($1)', [lockId]);
}
```

### Files to Update

- [ ] `src/lib/database.ts` — add `org_registry` + `entity_merge_log` to `initDb()`
- [ ] `src/core/entity-resolver.ts` — rewrite all Redis hash reads/writes to Postgres queries

### One-Time Migration Script: `scripts/migrate-entities.ts`

```typescript
import Redis from 'ioredis';
import { query, initDb } from '../src/lib/database';

const redis = new Redis();
await initDb();
const keys = await redis.keys('org:*');

for (const key of keys) {
    const data = await redis.hgetall(key);
    if (!data.org_id) continue;
    await query(`
        INSERT INTO org_registry
            (org_id, canonical_name, geo_state, resolution_method, first_seen, last_signal_at, signal_count)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (org_id) DO NOTHING
    `, [
        data.org_id,
        data.canonical_name || 'UNKNOWN',
        data.geo_state || 'XX',
        data.resolution_method || 'MIGRATED',
        data.first_seen || new Date().toISOString(),
        data.last_signal_at || new Date().toISOString(),
        parseInt(data.signal_count || '1')
    ]);
}
console.log(`Migrated ${keys.length} entity records to Postgres.`);
process.exit(0);
```

---

## PHASE 3 — Model API Abstraction Layer
**Effort: 1.5 days | Risk: Low-Medium**

### Goal
Extract all Gemini/AI calls from business logic into a provider-agnostic `ModelAPI` service. No business logic file should ever import LangChain or reference a model name.

### Problem with current state
`gemini-chain.ts` directly instantiates three LangChain models. Switching providers = rewriting business logic. Retry and spend tracking are scattered.

### New File: `src/lib/model-api.ts`

```typescript
/**
 * ModelAPI — Provider-agnostic LLM abstraction.
 * To swap Gemini for any other provider: edit MODEL_CONFIG only.
 * Business logic files (gemini-chain, outreach) import this. Never LangChain directly.
 */

import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { cache } from './cache';

export type ModelRole = 'gate' | 'qualifier' | 'writer' | 'synthesizer';

const MODEL_CONFIG: Record<ModelRole, { model: string; maxTokens: number; temperature: number }> = {
    gate:        { model: 'gemini-1.5-flash', maxTokens: 128,  temperature: 0.1  },
    qualifier:   { model: 'gemini-1.5-pro',   maxTokens: 384,  temperature: 0.1  },
    writer:      { model: 'gemini-1.5-flash', maxTokens: 512,  temperature: 0.1  },
    synthesizer: { model: 'gemini-1.5-pro',   maxTokens: 768,  temperature: 0.15 },
};

export interface ModelCallOptions {
    role: ModelRole;
    system: string;
    user: string;
    spendKey: string;
    dailyLimit?: number;
}

export async function callModel(opts: ModelCallOptions): Promise<string> {
    const { role, system, user, spendKey, dailyLimit = 400 } = opts;

    const count = parseInt((await cache.get<string>(spendKey)) || '0', 10);
    if (count >= dailyLimit) {
        throw new Error(`[ModelAPI] Daily spend limit reached for key: ${spendKey}`);
    }

    const config = MODEL_CONFIG[role];
    const client = new ChatGoogleGenerativeAI({
        model: config.model,
        maxOutputTokens: config.maxTokens,
        temperature: config.temperature,
    });

    for (let attempt = 0; attempt < 2; attempt++) {
        const userPrompt = attempt === 0
            ? user
            : user + '\nReturn ONLY the JSON object. No markdown, no explanation.';
        const res = await client.invoke([['system', system], ['user', userPrompt]]);
        await cache.incr(spendKey);
        return res.content as string;
    }
    throw new Error(`[ModelAPI] All retries exhausted for role: ${role}`);
}

export function parseModelJson(raw: string): any {
    try {
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) return null;
        return JSON.parse(match[0].replace(/```json/gi, '').replace(/```/g, ''));
    } catch {
        return null;
    }
}
```

### Changes to `src/core/gemini-chain.ts`

```diff
- import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
+ import { callModel, parseModelJson } from '../lib/model-api';

- const flashModelGate    = new ChatGoogleGenerativeAI({ model: 'gemini-1.5-flash', ... });
- const proModelQualifier = new ChatGoogleGenerativeAI({ model: 'gemini-1.5-pro',   ... });
- const proModelWriter    = new ChatGoogleGenerativeAI({ model: 'gemini-1.5-flash', ... });
- function parseJsonSafe() { ... }

  // Gate
- const gateRes = await flashModelGate.invoke([...]);
+ const gateRaw = await callModel({ role: 'gate', system: gateSysPrompt, user: gateUserPrompt, spendKey });
+ gateResult = parseModelJson(gateRaw);

  // Qualifier
- const qualRes = await proModelQualifier.invoke([...]);
+ const qualRaw = await callModel({ role: 'qualifier', system: qualSysPrompt, user: qualUserPrompt, spendKey });
+ qualResult = parseModelJson(qualRaw);

  // Writer
- const writerRes = await proModelWriter.invoke([...]);
+ const writerRaw = await callModel({ role: 'writer', system: writerSysPrompt, user: writerUserPrompt, spendKey });
+ writerResult = parseModelJson(writerRaw);
```

### Files to Update

- [ ] `src/lib/model-api.ts` — **CREATE**
- [ ] `src/core/gemini-chain.ts` — remove LangChain imports, use `callModel`
- [ ] `src/core/outreach/OutreachGenerator.ts` — if it instantiates models directly, same pattern

---

## PHASE 4 — Product Repositioning
**Effort: 0.5 days | Impact: Highest commercial leverage**

No engineering. Narrative change only.

### Files to Update

- [ ] `README.md` — remove "scraper", lead with registry data sources
- [ ] `architecture.md` — rename "Scraper Engine" → "Registry Ingestion Layer"
- [ ] `INTEL_ENGINE_AUDIT.md` — add §15: Data Provenance & Legal Standing

### New README opening (replace current lede)

```
ConvoSpan Intel is the only B2B intelligence platform that triangulates Indian and UAE 
government registries to surface companies with verified, time-bounded buying intent — 
before they issue an RFP.

Sources: MCA21 · GeM Portal · RERA · DGFT · Naukri · UAE DMCC · ADGM

Zero scraping of private websites. 100% legally sourced. Compliance-first by architecture.
```

---

## DELIVERY SEQUENCE

| Day | Phase | Deliverable |
|-----|-------|-------------|
| **1** | Phase 1 | `src/lib/cache.ts` created; 3 consumer files updated |
| **2** | Phase 2a | Migration SQL in `database.ts`; migration script runs |
| **3** | Phase 2b | `entity-resolver.ts` rewritten to Postgres |
| **4** | Phase 3 | `src/lib/model-api.ts` created; `gemini-chain.ts` refactored |
| **5** | Phase 4 | README, architecture.md, audit doc updated |

---

## COMPLETE ENV VAR REFERENCE

```env
# Phase 1 — Managed Cache (NEW)
UPSTASH_REDIS_REST_URL=https://xxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AXxx...

# Phase 2 — Postgres (already exists)
DATABASE_URL=postgresql://user:pass@host/db

# Phase 3 — Gemini (already exists)
GOOGLE_API_KEY=AIza...

# BullMQ — stays on ioredis, never replaced
REDIS_HOST=localhost
REDIS_PORT=6379

# Existing
HMAC_SECRET=...
BRAIN_WEBHOOK_URL=...
REGION_ID=IN_MH_01
SANDBOX_API_KEY=...
```

---

## RISK REGISTER

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Redis `org:*` keys lost on cutover | Medium | Run migration script **before** deploying new entity-resolver |
| Postgres advisory lock contention | Low-Medium | `lock_timeout = 3s`; fall back to deterministic local hash |
| Upstash free-tier limit (10k/day) | Low | Monitor `/metrics`; upgrade to pay-as-you-go at first limit hit |
| ModelAPI retry doubles spend | Low | Retry only on JSON parse failure, not on HTTP error |
| BullMQ + Upstash confused | Low | Strict rule: queue.ts = ioredis only, cache.ts = Upstash only |
