# Merge Preparation: ConvoSpan Intel Implementation

Generated on: 2026-05-27

## Current State

This working tree contains the implemented local-production-readiness pass, frontend onboarding flow, navigation fixes, backend route wiring, and local Docker-compatible runtime fixes.

Last verified:
- Backend build: `npm run build`
- Frontend build: `npm run build --prefix client`
- Frontend lint: `npm run lint --prefix client` passes with warnings only
- Live browser route/link check: 17 clickable links passed, 12 routes loaded, no console errors
- Runtime URLs after restart:
  - Backend: `http://localhost:3001`
  - Frontend: `http://127.0.0.1:5173`

## Merge Strategy

Merge this as one implementation branch if possible. The changes are coupled across frontend routes, auth fallback, API helpers, backend middleware, and server route mounts.

Recommended commit split if a clean repo needs smaller chunks:

1. Local runtime and backend API readiness
2. Frontend onboarding, auth fallback, routes, and navigation
3. Tender Watch / analytics / DLQ surfaces
4. Documentation and implementation plan

## Must Keep Together

### Frontend routing and auth

These files are interdependent. Do not merge only one of them.

- `client/src/main.tsx`
- `client/src/routes.tsx`
- `client/src/lib/auth.tsx`
- `client/src/lib/api.ts`
- `client/src/contexts/TenantContext.tsx`
- `client/src/components/RequireAuth.tsx`
- `client/src/layouts/AppLayout.tsx`
- `client/src/pages/Landing.tsx`
- `client/src/pages/Login.tsx`
- `client/src/pages/SetupWizard.tsx`
- `client/src/pages/Help.tsx`

Why: `main.tsx` now uses the local-safe `AuthProvider`, `TenantProvider`, and route tree. `Landing`, `Login`, and `SetupWizard` depend on those app-level providers and routes.

### Navigation fixes

- `client/src/index.css`
- `client/src/pages/Landing.tsx`
- `client/src/pages/Help.tsx`
- `client/src/pages/app/Dashboard.tsx`
- `client/src/pages/app/Reports.tsx`
- `client/src/pages/app/Signals.tsx`
- `client/src/pages/app/Query.tsx`
- `client/src/pages/app/ApiManager.tsx`
- `client/src/components/UsageMeter.tsx`
- `client/src/components/ReEngageQueue.tsx`

Why: links now route to real pages instead of dead buttons or placeholder URLs. `index.css` removes the scanline pointer-event blocker that made visible links unclickable.

### Backend local Docker readiness

- `src/server.ts`
- `src/lib/cache.ts`
- `src/lib/database.ts`
- `src/lib/queue.ts`
- `src/middleware/tenant.ts`
- `src/middleware/rateLimit.ts`
- `src/lib/telemetry.ts`
- `src/lib/canary.ts`

Why: this set allows local operation with Docker Postgres/Redis before real Clerk, Upstash, Sentry, and model secrets are available. It also mounts health/telemetry and worker startup more defensively.

### Newly mounted backend routes

- `src/routes/analytics.ts`
- `src/routes/dlq.ts`
- `src/routes/watch-profiles.ts`
- `src/routes/reports.ts`
- `src/routes/outreach.ts`
- `src/routes/share.ts`
- `src/routes/sources.ts`
- `src/routes/leads.ts`
- `src/server.ts`

Why: `server.ts` imports and mounts these routes. Merging routes without the mounts, or mounts without the route files, will break runtime startup.

### Tender Watch feature

- `client/src/pages/app/TenderWatch.tsx`
- `client/src/components/TenderNotifications.tsx`
- `src/core/collectors/gem-xml.ts`
- `src/core/tender-watch/matcher.ts`
- `src/routes/watch-profiles.ts`
- `src/workers/scrapeWorker.ts`
- `src/lib/scheduler.ts`
- `src/lib/database.ts`
- `client/src/routes.tsx`
- `client/src/layouts/AppLayout.tsx`

Why: UI route, notifications, DB table, schedule hook, and worker ingestion path are tied together.

### DLQ / operations feature

- `client/src/components/views/DeadLetterQueue.tsx`
- `src/routes/dlq.ts`
- `src/lib/queue.ts`
- `src/server.ts`
- `client/src/App.tsx`

Why: the old dashboard tab imports the DLQ view, and the backend exposes the route.

### Package changes

- `package.json`
- `package-lock.json`
- `client/package.json`
- `client/package-lock.json`
- `client/eslint.config.js`

Why: new code uses added dependencies including `csv-parse`, `i18next`, and `react-i18next`. Lockfiles should travel with package manifests.

## New Files To Add

- `IMPLEMENTATION_PLAN.md`
- `MERGE_PREP.md`
- `client/src/components/RequireAuth.tsx`
- `client/src/components/SocketBridge.tsx`
- `client/src/components/TenderNotifications.tsx`
- `client/src/components/views/DeadLetterQueue.tsx`
- `client/src/i18n.ts`
- `client/src/lib/auth.tsx`
- `client/src/pages/Login.tsx`
- `client/src/pages/SetupWizard.tsx`
- `client/src/pages/app/TenderWatch.tsx`
- `src/core/collectors/gem-xml.ts`
- `src/core/tender-watch/matcher.ts`
- `src/routes/analytics.ts`
- `src/routes/dlq.ts`
- `src/routes/watch-profiles.ts`

## Files With Modified Behavior

Frontend:
- `client/src/pages/Landing.tsx`: splits hero/onboarding and terminal experience; adds working route links and API fallback.
- `client/src/pages/Login.tsx`: new local-safe login entry.
- `client/src/pages/SetupWizard.tsx`: collects industry, keywords, sources, regions, and writes onboarding state.
- `client/src/routes.tsx`: adds `/login`, `/setup`, protected `/app/*`, and `/app/watch`.
- `client/src/layouts/AppLayout.tsx`: adds Tender Watch navigation and live socket bridge.
- `client/src/lib/api.ts`: central API client with org header and typed error handling.
- `client/src/lib/auth.tsx`: Clerk-compatible local fallback when real Clerk keys are absent.

Backend:
- `src/server.ts`: waits for DB init, mounts missing routes, starts workers after Redis readiness, skips placeholder Sentry.
- `src/lib/cache.ts`: supports Upstash when configured and local Redis fallback otherwise.
- `src/lib/database.ts`: adds retry connection, tenant-safe unique indexes, system canaries, watch profiles.
- `src/middleware/tenant.ts`: local-dev default tenant fallback before real secrets are available.
- `src/middleware/rateLimit.ts`: raises local-dev limits to avoid blocking automated QA.

Docs:
- `IMPLEMENTATION_PLAN.md`: product/engineering implementation plan.
- `README.md`, `architecture.md`, `INTEL_ENGINE_AUDIT.md`: updated product/runtime language.

## Known Remaining Warnings

`npm run lint --prefix client` reports warnings only. Existing categories:
- `no-explicit-any`
- missing hook dependencies
- unused caught error variables
- a few pre-existing empty block warnings

No lint errors were present in the last run.

## Merge Risks

- The working tree is broad: 86 tracked files modified and 15 new files including this file.
- The backend intentionally supports degraded local mode. Production still requires real secrets and should keep `NODE_ENV=production`.
- Some WABA and LinkedIn outreach paths remain explicit stubs until provider credentials and SDK/OAuth wiring are added.
- Lockfiles changed and should not be omitted if package manifests are merged.
- Do not merge `client/node_modules` or generated runtime logs.

## Clean Repo Merge Checklist

1. Apply all files in the "Must Keep Together" groups.
2. Install dependencies:
   - `npm install`
   - `npm install --prefix client`
3. Start Docker Postgres and Redis.
4. Run:
   - `npm run build`
   - `npm run build --prefix client`
   - `npm run lint --prefix client`
5. Start backend and frontend:
   - backend on `http://localhost:3001`
   - frontend on `http://127.0.0.1:5173`
6. Re-run browser smoke:
   - hero login/setup/help
   - terminal anchors and dashboard launch
   - app sidebar routes
   - dashboard feed link
   - reports help link

## Suggested Commit Messages

1. `feat: add onboarding and local-safe auth flow`
2. `fix: wire frontend navigation to real routes`
3. `feat: mount analytics dlq reports outreach and watch APIs`
4. `fix: support local redis postgres and dev tenant fallback`
5. `docs: add implementation and merge preparation notes`
