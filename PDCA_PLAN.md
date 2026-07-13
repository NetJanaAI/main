# ConvoSpan Intel — PDCA Production Readiness Plan

This plan details the **Plan-Do-Check-Act (PDCA)** remediation cycle based on the **ConvoSpan Intel — Production Readiness Report** generated on **2026-07-13**.

---

## 📋 Remediation Roadmap

### 1. [P0] RLS Enforcement on Covospan configs & logs (FINDING-MT-01)
*   **Plan (P)**: 
    *   Protect `covospan_configs` and `covospan_push_log` under Postgres Row-Level Security (RLS) policies.
    *   Ensure all database operations—including frontend routes, background tasks, and compliance purge routines—carry correct tenant context or explicitly bypass policies where needed.
*   **Do (D)**: 
    *   Alter tables to `ENABLE ROW LEVEL SECURITY` in `initDb()` inside [database.ts](file:///c:/Users/siddharth/.gemini/antigravity/scratch/b2b-scraper/src/lib/database.ts) and add isolation policies.
    *   Refactor [covospan.ts](file:///c:/Users/siddharth/.gemini/antigravity/scratch/b2b-scraper/src/routes/covospan.ts) routes to use `queryWithOrg(text, params, orgId)`.
    *   Refactor background methods `getConfig` and `log` in [CovospanPusher.ts](file:///c:/Users/siddharth/.gemini/antigravity/scratch/b2b-scraper/src/core/CovospanPusher.ts) to utilize `queryWithOrg` to inject correct `org_id` context.
    *   Update GDPR deletion queries in [VanishProtocol.ts](file:///c:/Users/siddharth/.gemini/antigravity/scratch/b2b-scraper/src/core/rag/VanishProtocol.ts) to explicitly set `SET LOCAL app.bypass_rls = 'true'` inside the purge transaction to allow deletion of RLS-protected tables under system privileges.
*   **Check (C)**: 
    *   Verify tenant isolation on endpoints. Test manual and auto-trigger pushing to verify worker configurations load and write logs under active RLS. Run GDPR purge tests to verify cleanup success.
*   **Act (A)**: 
    *   Integrate RLS context audits in CI pipelines and pre-deployment schema migrations.


### 2. [P0] DLQ archiveOldEntries log-spam reduction (FINDING-OPS-01)
*   **Plan (P)**: 
    *   Stop recursive query failures from flooding console logs when Postgres is unreachable during startup or downtime.
*   **Do (D)**: 
    *   Wrap `DeadLetterQueue.archiveOldEntries` execution with query retry counters or a circuit-breaker check. If a query fails continuously, pause the execution interval or double the timeout window.
*   **Check (C)**: 
    *   Launch application server with an invalid `DATABASE_URL` and verify that the logs print connection warnings at most once per minute instead of looping hundreds of times per second.
*   **Act (A)**: 
    *   Enforce similar circuit-breakers across all asynchronous background queues.

### 3. [P1] Frontend `x-organization-id` header removal (FINDING-AUTH-01 / FINDING-FE-01)
*   **Plan (P)**: 
    *   Stop sending the redundant `x-organization-id` header from client requests since backend routes now determine organization identity securely through JWT tokens.
*   **Do (D)**: 
    *   Edit [api.ts](file:///c:/Users/siddharth/.gemini/antigravity/scratch/b2b-scraper/client/src/lib/api.ts) to remove the lines appending the header `x-organization-id`.
*   **Check (C)**: 
    *   Test app navigation and confirm endpoints process requests correctly solely using the JWT auth header.
*   **Act (A)**: 
    *   Verify that any new endpoints resolve tenant context via `req.organizationId` populated by the session handler.

### 4. [P1] Shared Redis connection pool (FINDING-OPS-02)
*   **Plan (P)**: 
    *   Consolidate independent Redis instances to prevent active connection exhaustion.
*   **Do (D)**: 
    *   Define a single shared Redis connection factory in a central module and import it across worker/cache handlers.
*   **Check (C)**: 
    *   Run `CLIENT LIST` inside Redis during startup and confirm the number of active connection channels has decreased.
*   **Act (A)**: 
    *   Standardize worker startup scripts to use the pooled database connections.

### 5. [P2] CSV Export injection protection (FINDING-INPUT-01)
*   **Plan (P)**: 
    *   Escape all values in CSV report generation to prevent spreadsheet formula injection.
*   **Do (D)**: 
    *   Sanitize variables `company_name` and `card_why_now` in [reports.ts](file:///c:/Users/siddharth/.gemini/antigravity/scratch/b2b-scraper/src/routes/reports.ts) by prefixing cell values starting with `=`, `+`, `-`, or `@` with a single quote (`'`).
*   **Check (C)**: 
    *   Verify the exported CSV has single-quoted cells for strings mimicking math formulas.
*   **Act (A)**: 
    *   Make this sanitization step standard for all client exports.
