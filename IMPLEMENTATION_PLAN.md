# ConvoSpan Intel Implementation Plan

## Current Verdict

This app has a strong architecture and many real components, but it is not production-ready yet. The main problem is not the idea or the amount of code. The main problem is contract drift:

- The frontend calls routes that the backend does not expose.
- The backend mounts some routes under different paths than the frontend expects.
- Auth behavior differs between local/dev and production.
- Scrape jobs can be enqueued to queues that workers are not listening to.
- Several features are still stubs or demo-mode paths but appear product-ready in the UI.

The goal of this plan is to stabilize one complete user journey before expanding the product surface.

## Golden User Journey

All implementation work should first support this path:

1. User opens the app.
2. User authenticates or receives a valid tenant context.
3. Dashboard loads without API failures.
4. User submits a scrape.
5. Worker processes the scrape job.
6. A lead appears in the dashboard/signals view.
7. User can inspect lead intelligence.
8. User can export/report or generate outreach.

Anything outside this flow is secondary until this path is reliable.

## Phase 1: Make It Build

### Tasks

- Remove unused `Search` and `Target` imports from `client/src/components/views/DeadLetterQueue.tsx`.
- Remove accidental `bitumen: 121` from `client/src/main.tsx`.
- Run backend build.
- Run frontend build.

### Commands

```bash
npm run build
npm run build --prefix client
```

### Exit Criteria

- Backend TypeScript build passes.
- Frontend TypeScript/Vite build passes.
- No accidental debug/junk code remains in app entrypoints.

## Phase 2: Fix API Contract Drift

### Known Route Mismatches

| Frontend Call | Backend Reality | Required Fix |
|---|---|---|
| `/api/scrape` | Backend currently exposes `/api/scrape/scrape` | Prefer making backend accept `POST /api/scrape` |
| `/api/reports/export` | `reportsRoutes` imported but not mounted | Mount `/api/reports` |
| `/api/outreach/...` | Route exists but is not mounted | Mount `/api/outreach` |
| `/api/share/...` | Route exists but is not mounted | Mount `/api/share` |
| `/api/campaign/...` | Backend uses `/api/campaigns/...` | Standardize on one path |
| `/api/lead/...` | Backend uses `/api/leads/...` | Update frontend or add compatibility route |

### Tasks

- Build a route contract table from all frontend API calls.
- Mount missing routers in `src/server.ts`.
- Rename or alias routes so frontend and backend agree.
- Prefer clean product-facing URLs over accidental internal paths.

### Exit Criteria

- No frontend API call points to a missing route.
- All high-value flows return useful responses instead of `404`.

## Phase 3: Fix Auth Contract

### Current Problem

The backend global tenant middleware requires a Clerk bearer token or API key for most `/api/*` routes. The frontend often sends only `x-organization-id`, and many components use direct `fetch()` without any tenant/auth wrapper.

This works only in local/dev fallback mode and will fail in production.

### Tasks

- Update `client/src/lib/api.ts` to support Clerk bearer tokens.
- Replace direct frontend `fetch()` calls with the shared API helper where practical.
- Decide which endpoints are public, such as landing page stats.
- Exempt or specially handle `/api/ingest/*` so generic tenant middleware does not block ingest auth before HMAC/API-key validation.

### Exit Criteria

- Authenticated app pages do not randomly return `401`.
- Production auth behavior is explicit and testable.
- Public endpoints are intentionally public, not accidentally open.

## Phase 4: Fix Scrape Queue Processing

### Current Problem

The API can enqueue scrape jobs to regional queues such as `b2b-scrapes:global`, while the worker listens to the base queue `b2b-scrapes`. This can cause jobs to sit forever without processing.

### Recommended V1 Fix

Use one scrape queue first. Disable regional queue routing until the base flow is stable.

### Alternative V1.1 Fix

Start workers for all configured regional queues.

### Tasks

- Make enqueue and worker queue names identical.
- Verify job status endpoint reads from the same queue where jobs are enqueued.
- Submit one scrape and confirm progress/complete events.

### Exit Criteria

- User submits scrape.
- Job is picked up.
- Worker emits progress.
- Job completes or fails visibly with a useful reason.

## Phase 5: Mount Missing Product Routes

### Tasks

- Mount `reportsRoutes` under `/api/reports`.
- Mount outreach route under `/api/outreach`.
- Mount share route under `/api/share`.
- Review whether `enterpriseRoutes` should be mounted.
- Confirm `campaignsRoutes` path matches frontend usage.

### Exit Criteria

- Reports export no longer 404s.
- Outreach generation route is reachable.
- Share route is reachable.
- Campaign ROI export path is consistent.

## Phase 6: Stabilize Backend Startup And Health

### Current Problem

The server can start in degraded mode while DB, Redis, or workers are unavailable. That creates a false sense that the app is healthy.

### Tasks

- Await DB initialization before accepting traffic, or clearly mark health as degraded until DB is ready.
- Make `/health` report:
  - DB status
  - Redis status
  - worker readiness
  - queue status
  - model provider mode
  - degraded/demo mode flags
- Ensure Redis failure is visible in health checks.
- Remove placeholder Sentry DSNs in production.

### Exit Criteria

- `/health` tells the truth.
- Dev mode can be degraded, but production must fail loudly for missing critical services.

## Phase 7: Decide Stub Policy

### Known Stub/Demo Areas

| Feature | Current State | Product Decision |
|---|---|---|
| WABA dispatch | Stub unless credentials exist | Hide, label beta, or fully implement |
| LinkedIn dispatch | Stub unless credentials exist | Hide, label beta, or fully implement |
| LLM fallback | Demo-mode mock responses | Never allow in production |
| ConvoSpan test push | Uses mock lead | Label as test tool only |
| Email outreach | Real only with SMTP configured | Show config/readiness state |

### Tasks

- Add capability/readiness flags to backend.
- Reflect disabled/stub state in UI.
- Prevent users from launching fake production actions.

### Exit Criteria

- No stub feature appears as fully working.
- Demo mode is impossible in production.
- UI explains disabled integrations through status, not marketing copy.

## Phase 8: Add Smoke Tests

### Minimum Smoke Tests

- Backend build passes.
- Frontend build passes.
- `/health` returns expected readiness.
- `/api/leads/stats` returns valid JSON.
- `/api/scrape` accepts a valid scrape request.
- Scrape worker consumes a queued job.
- Frontend API call scan finds no missing backend routes.

### Exit Criteria

- One command catches the current class of failures.
- Route contract drift becomes difficult to reintroduce.

## Recommended Sprint Order

### Sprint 1: Build And Route Contract

- Fix frontend build.
- Remove accidental junk code.
- Mount missing routes.
- Fix obvious route mismatches.

### Sprint 2: Auth And Scrape Processing

- Standardize frontend auth headers.
- Replace direct fetch calls.
- Fix queue naming.
- Confirm scrape job end-to-end.

### Sprint 3: Runtime Readiness

- Improve `/health`.
- Make DB/Redis/worker failures visible.
- Add smoke tests.

### Sprint 4: Product Hardening

- Hide or label stubs.
- Add integration readiness states.
- Clean demo-mode behavior.
- Prepare production deployment checklist.

## Definition Of Done

The app is no longer half-built when:

- Backend build passes.
- Frontend build passes.
- No frontend route hits a backend `404`.
- Auth behavior is consistent between frontend and backend.
- Scrape jobs actually complete.
- Dashboard shows real data or a clear empty state.
- Stubs are hidden, labeled, or implemented.
- `/health` reflects DB, Redis, queue, and worker truth.
- One smoke command verifies the golden user journey.

