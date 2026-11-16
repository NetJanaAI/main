# Row-level security rollout

## What the policy does
`initDb` (see `src/lib/db/rlsPolicies.ts`) gives each tenant table one policy, `tenant_isolation`:
rows are visible and writable only when the table's tenant column equals
`app.current_organization_id`, or `app.bypass_rls = 'true'` (set by `queryAsSystem`).
A connection with no tenant context sees nothing. The same SQL is exercised by
`src/lib/__tests__/rls.jest.test.ts` against a real Postgres (PGlite).

## Two ways RLS silently does nothing
1. **The app connects as the table owner, a superuser, or a role with `BYPASSRLS`.**
   Owners skip policies unless the table is `FORCE`d; superusers and `BYPASSRLS` roles skip them always.
   Check the role in production:
   ```sql
   SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
   SELECT relname, relforcerowsecurity FROM pg_class WHERE relname IN ('lead_cards','scrape_results');
   ```
   Supabase's default `postgres` role has `BYPASSRLS`; if `DATABASE_URL` uses it, RLS has never applied.
   Run the app as a dedicated role:
   ```sql
   CREATE ROLE netjana_app LOGIN PASSWORD '<from your secret store>' NOSUPERUSER NOBYPASSRLS;
   GRANT USAGE ON SCHEMA public TO netjana_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO netjana_app;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO netjana_app;
   ```
   Keep the owner role for migrations only (`initDb` needs DDL rights).
2. **The tenant setting did not reach the statement.** `queryWithOrg` and `queryAsSystem` previously issued
   `set_config(..., true)` outside a transaction, so the setting vanished before the real query. They now wrap
   `BEGIN` / `set_config` / query / `COMMIT` on one client (also required behind pgbouncer transaction pooling).

## Turning on FORCE
`RLS_FORCE=true` makes `initDb` run `FORCE ROW LEVEL SECURITY` (default is `NO FORCE`, so deploying this change
alone does not change what existing code can read). Before enabling it, every query on a tenant table must go
through `queryWithOrg`, `withOrgTransaction` or `queryAsSystem`. Direct `query`/`db.query` calls on tenant tables
(found by grep at the time of writing) are:

| File | Calls |
|---|---|
| src/core/rag/VanishProtocol.ts | 19 |
| src/routes/admin.ts | 5 |
| src/lib/DeadLetterQueue.ts | 4 |
| src/routes/dlq.ts | 3 |
| src/dispatcher.ts | 3 |
| src/routes/leads.ts, enterprise.ts, src/lib/scheduler.ts | 2 each |
| influenceMapWorker, ShareService, campaigns, analytics, ingestAuth, mcp/index, SovereignFirewall, tender-watch/matcher, TenantRAGStore, outreach, entity-resolver | 1 each |

Re-run the grep, convert these (tenant-scoped routes to `queryWithOrg`, cross-tenant workers to `queryAsSystem`),
then enable `RLS_FORCE` in staging first.

## Not covered
`org_registry`, `entity_merge_log` and `canonical_entity_cache` are shared reference data with no tenant column.
`app.bypass_rls` is a plain session setting: any SQL injection that can run `set_config` can lift isolation, which is
why `SEC-PARAMETERIZED-SQL` in `scripts/verify-security.ts` matters.
