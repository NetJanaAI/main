# NetJana Action Plan

Written 2026-11-18 from a full review of `main` (b9fa89c) by three independent read-only reviews (backend security and tenancy, correctness and reliability, client/CI/repo), plus the work already done in this effort.

**How to read the confidence tags**
- **Verified**: I read the cited code myself and the claim holds.
- **Reported**: a reviewer read the code and reported it; I have not re-checked it. Treat as likely, confirm when fixing.
- **Depends**: true or false depending on how it is deployed. The check is stated.

Each item names the file to start in. Every fix should follow the working rules: failing test first, minimum code, `npx tsc --noEmit`, `npx tsx scripts/verify-security.ts` at 0 issues, one PR per phase, no merge without the owner's say-so.

---

## 0. Where things stand

| Item | State |
|---|---|
| Merged to `main` | scanner fix and Zod validation on all routers, fail-closed secrets, outreach leftovers removed, shared `isOrgAdmin`, tenant-lookup guard test, `rls` test timeout |
| PR #27 | Website Signals page, with plan-cap display. CI green. Open |
| PR #28 | CraftMyFunnel tenant push pinned to the validated address. CI green. Open |
| PR #29 | known-gaps table in `agents.md` corrected. CI green. Open |
| PR #30 | daily website-signals refresh with a per-plan cap and a once-per-day lock. Open (CI re-running after the last push) |

Merge order: #28, #29, #30, then #27 (the page reads fields that #30 adds; it shows nothing until then).

## 1. Decisions needed from the owner (blocking or shaping work)

1. **Rotate the keys that were in `.env.example`** at each provider, then decide on a history rewrite (needs explicit sign-off before any force-push). Also remove the old `SMTP_`, `WABA_`, `LINKEDIN_`, `OUTREACH_` lines from the local `.env.example`.
2. **Real plan caps.** Website signals cap is a placeholder: 25 companies on `free`, 500 on `paid`. Set real numbers or `WEBSITE_SIGNALS_DOMAIN_LIMITS`.
3. **Backend host settings.** Confirm production sets `NODE_ENV=production`, `HMAC_SECRET`, `API_KEY_SECRET` and `CREDENTIAL_ENCRYPTION_KEY`; boot fails without them since #24.
4. **Real API address** to replace `api.netjana.ai` in `ApiManager.tsx` (and `app.convospan.com` in `ConvospanSync.tsx`).
5. **Deployment shape** for two items marked Depends: is the app behind a proxy (item 2.4), and does it connect to Postgres as the table owner (item 2.3)?
6. **Is the ingest design intentional** (item 2.2): should ingested leads belong to the ingesting tenant or to the target company?
7. **Drop `outreach_log`, `outreach_logs`, `approval_queue`?** Irreversible; needs a yes.
8. **Old docs**: delete or archive (list in section 6).
9. **Enable branch protection** in GitHub settings (the API refused on this plan).
10. **Standalone mode (A6), CSV upload (B8), contact-PII signals**: keep, finish or remove.

---

## 2. Phase 1: security and tenant isolation (do first)

| # | Item | Where | Conf. | Fix |
|---|---|---|---|---|
| 2.1 | **SSRF on the ConvoSpan push.** Tenant-set `endpoint_url` accepts http and internal hosts; the push calls plain `fetch`, and the first 500 chars of the response are stored and readable via `GET /api/covospan/log`. This is the same hole #28 closes for CraftMyFunnel. | `routes/covospan.ts:14`, `core/CovospanPusher.ts:175,244` | Verified (fetch and schema); response exposure Reported | Require https, run `validateTargetUrl` on save and before send, send with `pinnedPost`, stop storing response bodies |
| 2.2 | **Ingested leads are not owned by the ingesting tenant.** The authenticated tenant is not carried in the queued signal; `org_id` becomes the target company id. Tenant routes filter on the tenant uuid, so these leads may never show, and same-company leads are shared across tenants. | `routes/ingest.ts`, `core/router.ts:50`, `core/gemini-chain.ts:46`, `core/lead-emitter.ts:60` | Reported (design intent unknown, see decision 6) | Carry `tenant_id` in the signal; keep the company entity id in a separate field |
| 2.3 | **RLS is not forced by default** (`RLS_FORCE`), and many queries use the plain `query` instead of `queryWithOrg`: `lead-emitter`, `CraftMyFunnelPusher`, `knowledge`, `wiki`, `dlq`, `schedules`, `campaigns`, `leads`, `CampaignROIAggregator`, `ShareService`, `mcp`. If the app connects as the table owner, isolation rests only on hand-written `WHERE` clauses. | `lib/database.ts:1157` and files listed | Reported; Depends on the DB role | Move each to `queryWithOrg` or `withOrgTransaction`, run as a non-owner role without BYPASSRLS, then turn `RLS_FORCE` on in staging |
| 2.4 | **No `trust proxy`.** Behind a proxy every client shares one rate-limit bucket and the ingest IP allowlist sees the proxy address; if that address is loopback the allowlist is skipped in production. | `middleware/ingestAuth.ts:31,62`, `middleware/rateLimit.ts:22` | Verified (no setting anywhere); impact Depends | `app.set('trust proxy', <hops>)`; drop the localhost exemption in production |
| 2.5 | **Missing admin checks.** Any org member can rotate the org API key and create, delete or edit ConvoSpan and integration settings. | `routes/profile.ts:41` (regenerate-key), `routes/covospan.ts:42,78,235`, `routes/api-manager.ts:31,51,161` | Verified (profile, covospan); api-manager Reported | Add `isOrgAdmin` |
| 2.6 | **`isOrgAdmin` treats a missing role as admin.** Intended for API-key callers, but a Clerk token without `org_role` also passes. | `lib/orgRole.ts` | Verified | Make API-key callers explicit; read both claim shapes; otherwise deny |
| 2.7 | **Global ConvoSpan env fallback** sends every tenant's leads to one endpoint. | `core/CovospanPusher.ts:88` | Reported | Use an explicit allowlist like `CRAFTMYFUNNEL_ENV_FALLBACK_ORGS`, or remove |
| 2.8 | **Standalone entry trusts client headers** (`x-tier`, `x-organization-id`); `app.ts` has open CORS, Socket.IO `*`, no helmet, unauthenticated `/metrics`. | `modes/standalone/index.ts:26`, `standalone/middleware/featureGate.ts`, `app.ts` | Done (standalone kept) | Tier and org derived from the session tenant, helmet, origin allowlist, `/metrics` token; fate of standalone (decision 10) still open |
| 2.9 | **Cross-tenant leaks in shared keys and joins**: ingest dedup key has no org (tenant B can have a payload dropped because A sent it, and can probe for it); feedback counters `fb:` and `source_perf:` are global; `/intelligence` joins `scrape_results` and `lead_influence_data` without an org condition. | `routes/ingest.ts:21`, `routes/leads.ts:226,262` | Verified (dedup key); others Reported | Add the org id to keys; add `AND organization_id = $2` to the joins |
| 2.10 | **Scheduler keyed by domain across tenants**: tenant B scheduling the same domain cancels tenant A's cron, and `last_run` is stamped on both. Invalid cron strings are saved and then silently ignored. | `lib/scheduler.ts:20,27,53,60,67`, `routes/schedules.ts` | Verified | Key by schedule `id`; validate cron on save; update by `id` |
| 2.11 | **Error detail leaks** (raw Postgres messages, error names and codes) from `error-handler.ts` and many `catch` blocks returning `e.message`. | `middleware/error-handler.ts:12`, `routes/admin.ts`, `results.ts`, `knowledge.ts`, `wiki.ts`, `vault.ts`, `csv-ingest.ts`, `campaigns.ts`, `leads.ts` | Reported | Generic message in production; log detail server-side |
| 2.12 | **`/v1/intel` rate limit is bypassable** (keyed on the last 8 chars of a caller-chosen key, outside the per-IP limiter) and each new value costs an HMAC plus a DB lookup. | `middleware/rateLimit.ts:84`, `server.ts:312,384` | Reported | Per-IP limiter before the key lookup |
| 2.13 | **Unbounded input**: `limit` and `page` uncapped on results; multer without a size limit and no row cap on watch-profile CSV. | `routes/results.ts:12`, `routes/watch-profiles.ts:16` | Verified (results) | Cap `limit` at about 200, clamp `page`, set multer limits and a row cap |
| 2.14 | **Public share links cannot be revoked** (7-day lead links, 30-day ROI links) and the lead payload is `SELECT *` masked by regex. | `core/ShareService.ts`, `routes/share.ts:55`, `routes/campaigns.ts:96` | Reported | Column allowlist, revoke endpoint, shorter expiry |
| 2.15 | **MCP server has no tenant context** and reads all tenants' campaigns and results. | `mcp/index.ts:65,102` | Reported | Require an org id at startup and use `queryWithOrg`, or do not ship it |
| 2.16 | Smaller: `replayGuard` sets the nonce before verifying the signature (Redis flood); `/health` and `/metrics` open and costly (new Redis connection per call, leaks env var names); telemetry aggregates across tenants; vault CSV export lacks formula-injection escaping (reuse `escapeCsvValue`); wiki author always `system_user` (reads `userId`, token carries `sub`); `sentinel/compliance.ts:85` fetches robots.txt with a redirect-following `axios.get`. | listed files | Reported | Mostly done (vault CSV, wiki author in #40; `replayGuard` order, `/health` detail and cost, robots redirect here); telemetry tenant aggregation remains |

## 3. Phase 2: correctness and data loss

| # | Item | Where | Conf. | Fix |
|---|---|---|---|---|
| 3.1 | **Scrape results expire after one night.** Nothing writes `scrape_results.base_score`, so it is 0; the 02:00 rescore computes score 0 and status Dead for every row, archives them and emits `lead:archived`. | `workers/decayRescoreWorker.ts:22,33`, `lib/database.ts:363`, `dispatcher.ts:69` | Verified (no writer exists); runtime effect Reported | Write `base_score` on insert; skip rows with 0 |
| 3.2 | **Unbounded Tier2 to Tier3 loop.** Tier3 re-queues with `enriched: true` but nothing reads the flag, so a signal the Qualifier rates LOW again goes back to Tier3, repeating until the daily spend cap. | `workers/tier3Worker.ts:47`, `core/gemini-chain.ts:107,177` | Verified (flag never read) | Skip the LOW downgrade when `enriched` is set; add an attempt counter |
| 3.3 | **Every instance runs every cron**, so decay rescore, per-domain scrapes (burning tenant quota), tender watch and the canary multiply by instance count. (The website refresh from #30 is already locked.) | `lib/scheduler.ts:34,93-127` | Verified for the pattern; counts Reported | Done: `lib/cronLock.ts` `runOnce` wraps every cron in the scheduler (Redis `SET NX EX`, skips on Redis failure) |
| 3.4 | **Tender watch**: no dedup (the same bid becomes a new lead and push every 30 minutes), and matching is wrong (empty keywords or region-only profiles never match). | `core/tender-watch/matcher.ts:23-90` | Reported | Deterministic signal id plus a seen-key; match = keywords-ok AND region-ok, empty means any |
| 3.5 | **Dead-letter rows are lost**: `organization_id` is a UUID FK, but callers pass entity ids or `'default'`, so the insert throws and is only logged; the alert is skipped too. DLQ auto-retry also re-queues from text truncated to 500 to 1000 characters, which cannot parse. | `lib/DeadLetterQueue.ts:58`, `tier3Worker.ts:67`, `AdversarialCritic.ts:122`, `dlqWorker.ts:67` | Reported | Real tenant uuid or null, entity id in metadata; store the full signal for retry |
| 3.6 | **Lead persistence failure is swallowed** in the emitter; the job reports success with no retry, leaving the card only in Redis (24 h) and the socket. The CMF and ConvoSpan push is fire-and-forget (3 attempts, then lost); the outbox columns exist but are unused. | `core/lead-emitter.ts:60,81,107` | Reported | Rethrow so BullMQ retries; drive pushes from a `push_status` outbox with `FOR UPDATE SKIP LOCKED` |
| 3.7 | **Lead merge never happens**: `ON CONFLICT (lead_id)` with a fresh uuid each time, no unique `(org_id, source_id)`, so repeats create new cards and `signal_count` never grows. | `core/lead-emitter.ts:24` | Reported | Deterministic lead id or a unique index to conflict on |
| 3.8 | **Spend guard leaks**: counted once per call but the loop can call the model twice and BullMQ retries whole chains; a Redis hiccup after a successful response discards it and calls again; the Critic fixes yesterday's key at construction; hitting the limit throws with no delay, so signals fail permanently (`removeOnFail` unset). | `lib/model-api.ts:126,139,174`, `engines/AdversarialCritic.ts:14` | Reported | Count per invoke; best-effort usage recording; build the key per call; on limit, delay the job to the next day and record it |
| 3.9 | **LLM output not validated** (`"false"` passes the Gate, `valid:false` ignored, `"low"` confidence proceeds, fields written unvalidated); no timeout on model or embedding calls. Critic also promotes signals it marked invalid and queries unfiltered documents. | `core/gemini-chain.ts:141-258`, `lib/model-api.ts:159`, `engines/AdversarialCritic.ts:56,103,120` | Reported | Zod schemas with strict enums and booleans; `AbortSignal.timeout`; promote only on `complianceVerified` |
| 3.10 | **`initDb` can abort mid-migration**: a tolerated failure (for example missing pgvector) inside the transaction poisons the next statement, so the JSONB fallback never runs; no migration lock, so concurrent starts race. | `lib/database.ts:213,233,557,1021,1066` | Reported | `SAVEPOINT` around tolerated statements; `pg_advisory_xact_lock` around the whole migration |
| 3.11 | **Entity-resolver lock is taken on pooled connections**, so the unlock usually runs on a different connection, the lock leaks and later signals wait 3 s then resolve unsynchronised. | `core/entity-resolver.ts:197` | Reported | One checked-out client, or `pg_advisory_xact_lock` in a transaction |
| 3.12 | **Memory and key growth**: `live_leads` zset never trimmed, `router_log` never trimmed, in-memory vector stores never evicted, `signal_observation` rows past `expires_at` never deleted, failed jobs kept forever (`removeOnFail` unset on tier queues), per-host map in `safeFetch` grows. | `lead-emitter.ts:87`, `router.ts:57`, `TenantRAGStore.ts:110`, `signals/website/store.ts`, `lib/queue.ts:94`, `safeFetch.ts:78` | Reported | Trim and expire; add a daily purge for observations; `removeOnFail: { age, count }` |
| 3.13 | **Decay worker**: `OFFSET` paging while rows flip to Dead skips rows; `lead_cards` rescore loads everything with no batching. | `workers/decayRescoreWorker.ts:19,110` | Reported | Keyset pagination or one set-based update |
| 3.14 | **Scrape worker**: 60 s timeout rejects the job but does not stop the browser, and the retry starts a second scrape; rescrape job ids may not be UUIDs (insert failure swallowed). Quota `incr` and `expire` are separate calls; month boundary uses server-local time. | `workers/scrapeWorker.ts:79`, `lib/quota.ts:37` | Reported (id issue UNVERIFIED) | Pass an abort signal and close the browser; use UUID ids; set the quota TTL atomically in UTC |
| 3.15 | **Canary**: `checkDrought` runs in both the 5-minute and hourly jobs (Slack spam), and the Slack call in the catch is unguarded. Recalibration's Redis client may fail its first command. | `lib/canary.ts:62,76`, `lib/scheduler.ts:105`, `lib/recalibration.ts:5` | Reported (recalibration UNVERIFIED) | One schedule for the drought check; guard the call; use the shared client |
| 3.16 | **Tenants cannot disable all sources**: an empty result falls back to "all enabled". | `core/router.ts:30`, `workers/scrapeWorker.ts:55` | Reported | Treat an explicit empty set as empty |

## 4. Phase 3: client

| # | Item | Where | Conf. | Fix |
|---|---|---|---|---|
| 4.1 | **Demo sign-in in production builds.** With no real Clerk key the app falls back to a stub, and `localStorage.netjana_demo_auth=true` signs anyone into `/app/*`; the API gets no token in that mode. Narrower than first reported: it only applies when the key is missing or contains "dummy". | `client/src/lib/auth.tsx:30-48`, `RequireAuth.tsx`, `routes.tsx:38` (`/setup` unprotected) | Verified | Fail the production build without a real key; demo mode only behind an explicit flag; protect `/setup` |
| 4.2 | **Possible stored XSS**: Mermaid runs with `securityLevel: 'loose'` and the SVG is injected with `dangerouslySetInnerHTML`; the diagram text comes from company names in scraped data. | `components/EntityOrganogram.tsx:54,227` | Verified (both lines); name sanitising Reported | `securityLevel: 'strict'` and DOMPurify |
| 4.3 | **Invented figures presented as live**: Landing shows fixed numbers (latency, active agents, "Qualified Leads 1,284", "Pipeline Value $8.7M", source split) beside real stats. | `pages/Landing.tsx` | Reported | Label as an illustrative preview or drive from the stats endpoint |
| 4.4 | **API client** reads the token from `window.Clerk`, silently sends no header if Clerk has not loaded, and has no central 401 handling. | `lib/api.ts` | Reported | Token provider via `useAuth`; central 401 handling |
| 4.5 | **Sentry** samples 100% of traces and replays on error without masking text or media in a lead tool. | `main.tsx:23` | Reported | About 0.1 sampling; `maskAllText`, `blockAllMedia` |
| 4.6 | **Hard-coded URLs and third parties**: `Meta.tsx` canonical is the Vercel hostname, `ApiManager` shows `api.netjana.ai`, Login hotlinks an Unsplash image, Google Fonts imported at runtime. | `Meta.tsx:14`, `ApiManager.tsx:366`, `Login.tsx:12`, `index.css:2` | Reported | Env-driven URLs (decision 4); self-host font and image |
| 4.7 | **Bundle**: all 13 pages imported eagerly, no `manualChunks`. | `routes.tsx`, `vite.config.ts` | Reported | `React.lazy` per route |
| 4.8 | **Accessibility and polish**: few labels on icon buttons, very small text, `window.confirm` auth prompts, leftover template files (`react.svg`, `App.css`), "mock signed-in user" copy. | various | Reported | axe audit; clean up |
| 4.9 | **No client tests.** | `client/` | Reported | Start with auth gating and the API client |

## 5. Phase 4: build, deploy, dependencies

| # | Item | Conf. | Fix |
|---|---|---|---|
| 5.1 | **`ip` package has a high-severity advisory with no fix** and guards the ingest allowlist (`middleware/ingestAuth.ts`). `npm audit` also lists 4 moderate. | Reported | Replace with `net.BlockList` or `ipaddr.js`; review the moderates |
| 5.2 | **go-pusher healthcheck can never pass**: compose checks `localhost:8080/health`, the Go code serves no HTTP. | Verified | Add a tiny health listener or change the check |
| 5.3 | **Committed binaries**: `go-pusher/push`, `go-pusher/push.exe` (15 MB each), plus `build-output.txt` and `test_out.txt`. | Verified (binaries tracked) | `git rm`, add to `.gitignore` and `.dockerignore` |
| 5.4 | **Dockerfile**: `npm install --legacy-peer-deps` instead of `npm ci`, Node 20 base vs Node 22 in CI, Playwright image 1.58.0 vs `^1.58.1` in `package.json`, `chmod 777 /app/data`, no `HEALTHCHECK`. | Reported | `npm ci`, align versions, `chmod 750`, add healthchecks |
| 5.5 | **Compose**: dev credentials `netjana:netjana`, Postgres and Redis published on all interfaces, Redis without a password, `pgbouncer/userlist.txt` tracked with plain auth, prod publishes 6432 and 4000, images on `:latest` or `main-latest`, obsolete `version:`. | Reported | Bind to `127.0.0.1`, template the userlist, scram auth, pin images. Treat any real credential in `userlist.txt` as exposed and rotate it |
| 5.6 | **CI gaps**: no `npm audit`, no backend ESLint, no Docker build or image scan, actions tag-pinned. | Partly done | `npm audit` (high) and a `docker build` job added; backend lint and SHA-pinned actions remain |
| 5.7 | **Unused dependencies**: root `concurrently`, `clsx`, `tailwind-merge`, `lucide-react`, `langchain`, `@langchain/community`; client `zod`, `clsx`, `tailwind-merge`, `@supabase/supabase-js`; wildcard `robots-txt-parser: "*"`; stale `@types` packages; `.npmrc` hides peer conflicts. | Reported | Prune after a build and test run; pin the wildcard |
| 5.8 | **Server CSP** allows `localhost:3001` in production; `vite.config.ts` proxies to 3001 while the server defaults to 3000. | Done | CSP localhost entries only outside production; Vite proxy points at 3000 |

## 6. Phase 5: docs and repo cleanup

- **Contradicting docs.** README and `architecture.md` still list `src/outreach/`, `OutreachGenerator`, `outreach_worker` and `/api/outreach`; none exist. They and `agents.md` say "Gemini 1.5"; check the model in code first.
- **Delete (owner confirms):** `MERGE_PREP.md`, `go-pusher/build-output.txt`, `go-pusher/test_out.txt`, the two binaries.
- **Archive (move to `docs/archive/`):** `PLAN.md`, `IMPLEMENTATION_PLAN.md`, `INTEL_ENGINE_AUDIT.md`, `PDCA_MASTER.md`, `PDCA_PLAN.md`, `AZURE_DEPLOYMENT.md`, `CONNECTING_APPS.md` (overlaps `docs/CONNECTIONS.md`), `.agents/skills/`.
- **Keep:** `README.md`, `architecture.md`, `agents.md`, `GUARDRAILS.md`, `VAPT_TESTING.md`, `docs/`.
- **Untracked local clutter (not in git):** `startup.log`, `frontend-test-render.png`, `tmp/` (its scratch scripts load the Clerk secret key via dotenv), `*.log`. Delete locally. Add `Claude outputs/` and `handover/` to `.gitignore` or commit them on purpose.
- **Unused tables:** `outreach_log` and `outreach_logs` still in `database.ts` and `rlsPolicies.ts`; drop only on decision 7.
- **Test gaps** (no tests): `src/config`, `core/compliance`, `core/tender-watch`, `core/toon`, `lib/db`, `stealth`, `mcp`, `modes`, `sentinel`, `standalone/middleware`, `utils`, the whole client. Add tests as each area is touched in phases 1 and 2, starting with `lib/db` (RLS policies) and `core/tender-watch`.

## 7. Suggested order and size

| Phase | Contents | PRs | Notes |
|---|---|---|---|
| 0 | Merge #28, #29, #30, #27; owner decisions 1 to 4 | 0 | keys first |
| 1a | 2.1, 2.5, 2.6, 2.9, 2.10, 2.13 | 2 to 3 | small, high value, no schema change |
| 1b | 2.4, 2.11, 2.12, 2.16, 5.1 | 2 | needs decision 5 |
| 1c | 2.2, 2.3, 2.7, 2.8, 2.14, 2.15 | 3 to 4 | larger; 2.2 needs decision 6, 2.3 needs a staging DB role |
| 2a | 3.1, 3.2, 3.3 | 2 | stops silent data loss and runaway cost |
| 2b | 3.4 to 3.9 | 3 | |
| 2c | 3.10 to 3.16 | 3 | |
| 3 | 4.1, 4.2, 4.4 to 4.6 first; rest later | 2 to 3 | |
| 4 | 5.2 to 5.8 | 2 | |
| 5 | docs and cleanup | 1 | after decision 8 |

Estimated 20 to 25 small PRs. Phases 1a, 2a and 4.1 and 4.2 are the ones to do before any new feature work.

## 8. Not done in this effort (so no one assumes)

- Bulk-collection **queue** for website signals (collection is still synchronous, 10 domains per request); the daily refresh is not queue-based.
- No browser run of the new Website Signals page against a live backend.
- None of the reviewer findings marked Reported have been re-checked line by line.
