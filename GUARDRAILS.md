# ConvoSpan Intel — Code Cleanliness and PDCA Guardrails

This document establishes immutable code-quality rules and operational guardrails to prevent AI slop, maintain multi-tenant security integrity, and enforce PDCA lifecycle steps.

---

## 🚫 1. Anti-AI Slop Guardrails
*   **No Refusal Artifacts**: Avoid writing placeholders, templates, or system logs containing AI boilerplate (e.g. "As a large language model...").
*   **Focused and Rational Comments**: Comments must explain the *design intent* (why) of custom business/system rules, not the *syntactic operation* (what) of standard JavaScript APIs.
*   **Compile-Safe Code**: No unused variables, missing interfaces, or debug logs must remain in production files. Strict TypeScript checking must pass on all build phases.

---

## 🛡️ 2. Multi-Tenancy & RLS Integrity
*   **Explicit Session Context**: Standard database queries on RLS-active tables must use the scoped connection wrapper `db.queryWithOrg(text, params, orgId)` to ensure the PostgreSQL session setting `app.current_organization_id` is set.
*   **Worker/Background Task Context**: Background worker methods that perform database queries must accept `orgId` as an argument and wrap queries with `queryWithOrg` to carry context. Direct `db.query` is forbidden on RLS tables.
*   **Explicit Administrative Bypass**: Any system-level maintenance script or GDPR purge routine that deletes across RLS boundaries must explicitly run `SET LOCAL app.bypass_rls = 'true'` inside the database transaction to prevent security policy failures.

---

## 🔄 3. PDCA Git Integration Guidelines
*   **Stage-by-Stage Commits**: Do not bundle multiple cycles or phases into a single commit.
*   **Verify Before Commit**: Every change must be verified with backend builds, frontend builds, and the Jest test suite before committing to GitHub.
*   **Pull Request Alignment**: Every completed PDCA cycle must be committed and pushed to remote origin immediately after successful test execution to create clear audit trails.
*   **Persistence**: These guardrails are immutable and must not be altered throughout the duration of the PDCA remediation stages.
