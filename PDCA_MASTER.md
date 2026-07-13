# ConvoSpan Intel — PDCA Master Tracking Document

This is the master document tracking the Plan-Do-Check-Act (PDCA) stages of all production readiness improvements.

---

## 🚦 Phase Status Summary

| Cycle / Task | Phase | Status | Target Date |
|---|---|---|---|
| **Cycle 1: RLS Enforcement on Covospan** | Act (A) | ✅ Completed | 2026-07-13 |
| **Cycle 2: DLQ 1ms loop log-spam** | Act (A) | ✅ Completed | 2026-07-13 |
| **Cycle 3: Frontend API header cleanup** | Act (A) | ✅ Completed | 2026-07-13 |
| **Cycle 4: Shared Redis pool** | Act (A) | ✅ Completed | 2026-07-13 |
| **Cycle 5: CSV Export injection fix** | Act (A) | ✅ Completed | 2026-07-13 |
| **Cycle 6: SAST / Semgrep Hardening** | Act (A) | ✅ Completed | 2026-07-13 |

---

## 📋 Detailed Cycle Tracking

### Cycle 1: RLS Enforcement on Covospan (configs & logs)
*   **Plan (P)**: 
    *   Enable Row Level Security (RLS) on `covospan_configs` and `covospan_push_log` tables in database.
    *   Refactor [covospan.ts](file:///c:/Users/siddharth/.gemini/antigravity/scratch/b2b-scraper/src/routes/covospan.ts) routes to use `queryWithOrg`.
    *   Refactor [CovospanPusher.ts](file:///c:/Users/siddharth/.gemini/antigravity/scratch/b2b-scraper/src/core/CovospanPusher.ts) (background configuration reads and log writes) to use `queryWithOrg` to inject tenant context.
    *   Refactor [VanishProtocol.ts](file:///c:/Users/siddharth/.gemini/antigravity/scratch/b2b-scraper/src/core/rag/VanishProtocol.ts) (GDPR purges) to explicitly execute `SET LOCAL app.bypass_rls = 'true'` inside the transaction.
*   **Do (D)**: Refactored database configuration lookup and logging inside `CovospanPusher.ts` to use `queryWithOrg`. Refactored `VanishProtocol.ts` to bypass RLS during GDPR purges.
*   **Check (C)**: Verified backend build compilation. Verified that all 37 tests (including multi-tenant and RLS mocks) pass cleanly.
*   **Act (A)**: Established `GUARDRAILS.md` to prevent future RLS context bypasses and AI slop.

### Cycle 2: DLQ archiveOldEntries log-spam reduction
*   **Plan (P)**: Schedule DLQ archival daily instead of every 30 days to avoid Node.js 32-bit signed integer overflow which resets intervals to 1ms.
*   **Do (D)**: Changed the interval setting in [server.ts](file:///c:/Users/siddharth/.gemini/antigravity/scratch/b2b-scraper/src/server.ts) to `24 * 60 * 60 * 1000` ms.
*   **Check (C)**: Confirmed log output runs cleanly without the fast looping behavior.
*   **Act (A)**: Standardized daily timers for background crons.

### Cycle 3: Frontend `x-organization-id` header removal
*   **Plan (P)**: Stop sending `x-organization-id` header from the client API fetch file.
*   **Do (D)**: Modified [api.ts](file:///c:/Users/siddharth/.gemini/antigravity/scratch/b2b-scraper/client/src/lib/api.ts) to delete the header and remove unused local variables.
*   **Check (C)**: Verified that frontend compiles cleanly under strict TypeScript.
*   **Act (A)**: Standardized token-based authentication session parsing.

### Cycle 4: Shared Redis connection pool
*   **Plan (P)**: Consolidate multiple independent Redis clients to prevent TCP socket exhaustion.
*   **Do (D)**: Created [redis.ts](file:///c:/Users/siddharth/.gemini/antigravity/scratch/b2b-scraper/src/lib/redis.ts) to manage a shared connection singleton and refactored core files.
*   **Check (C)**: Monitored client lists in local runtime environments.
*   **Act (A)**: Enforced reuse rules for standard KV caching.

### Cycle 5: CSV Export injection protection
*   **Plan (P)**: Escape potential math formula trigger prefixes in CSV cells.
*   **Do (D)**: Added `escapeCsvValue()` in [reports.ts](file:///c:/Users/siddharth/.gemini/antigravity/scratch/b2b-scraper/src/routes/reports.ts) to escape fields with single quotes.
*   **Check (C)**: Tested exports and verified spreadsheet parsers treat values as raw text.
*   **Act (A)**: Added to export verification checklist.

### Cycle 6: SAST / Semgrep Hardening
*   **Plan (P)**: Address Docker user permissions, compose opt escalations, path traversal bounds, and log security formats.
*   **Do (D)**: Hardened Dockerfiles/compose configs to run as non-root with no-new-privileges/read-only parameters, validated path traversal bounds using `path.basename` in `SovereignFirewall.ts`/`pdfReport.ts`, and updated unsafe format string patterns.
*   **Check (C)**: Verified backend build passes. Ran Jest test suite (all 37 tests passed).
*   **Act (A)**: Add SAST scanning configuration and ignore profiles to deployment guide checklists.
