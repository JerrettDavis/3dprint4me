# Local production platform implementation plan

> **For agentic workers:** Use superpowers:executing-plans task-by-task. Continue the established native execution workflow; a fresh whole-change reviewer checks the result.

**Goal:** Restore usable production intake/operator paths on existing local infrastructure without Neon compute dependence, retaining manual-dispatch invoice drafts.

**Architecture:** Preserve Vercel static output; signed HTTP forwarding delegates the existing API to a private-container Node service. Native PostgreSQL and Authentik-backed HttpOnly sessions replace hosted database/auth; local leased jobs replace Neon scheduling.

**Tech stack:** Node 22, native `pg`, maintained `openid-client`, PostgreSQL 18, Docker Compose, Cloudflare Tunnel, existing Vercel/Blob/Resend integrations.

**Spec:** `docs/superpowers/specs/2026-10-20-self-hosted-platform-design.md`

## Global constraints

- Neon access was restored after the owner upgraded billing. Migrate the recovered records; preserve the source for rollback. The initial encrypted snapshot has passed an isolated PG18 restore. Final cutover still requires writer fencing and a fresh consistent export so writes since that snapshot are retained.
- Only `public/` is storefront output. No secret in source, static assets or logs.
- Database port stays private; runtime is not owner/superuser/BYPASSRLS.
- Four service paths, private uploads, immutable estimates, operation idempotency and owner authorization remain enforced.
- V1 invoices are drafts only; no send, charge, mark-sent or payment write.
- Never automatically retry forwarded writes or ambiguous invoice creation.
- Existing Authentik/shared PostgreSQL/other homelab workloads remain intact.
- `/customize/*` keeps own-origin-only requests and its separate CSP.

## Review focus

- Parsed Vercel bodies must be signed as the exact outgoing bytes; duplicate headers and tampering must fail.
- Cookie authentication requires exact same-site production origins and POST origin checks; disable/email-match shortcuts must fail.
- A target database role must execute real repository SQL with RLS while being denied DDL/unrelated data.
- Installed v7 operator clients must recover sign-in on shell upgrade without persistent tokens.
- Fresh-start approval must not become permission to erase source history or overwrite new work during later recovery.

### Task 1: Provider-neutral SQL

**Files:** create `lib/database.js`, `tests/unit/database.test.mjs`; modify `lib/neon.js`, `scripts/migrate-neon.mjs`, `api/health.js`, migration/health tests as needed.

**Interfaces:** `createNativeDatabase({pool})` returns tagged `query`, atomic `transaction(statements)`, `close`; `getDatabase()` selects `DATABASE_DRIVER=neon|postgres`; `databaseProvider()` reports current provider. Existing `queryNeon` remains a compatibility alias consumed by all SQL repositories.

- [x] Write/observe RED tests for parameter binding, undefined/null, transaction commit/rollback/release and sanitized errors.
- [x] Implement bounded pooled native SQL and preserve Neon default; normalize temporal values consistently.
- [x] Make migration/health select the same database boundary; native mode must not call Neon HTTP.
- [ ] Run affected tests and real repository contracts; commit.

### Task 2: Signed API transport and production listener

**Files:** create `lib/platform/proxy.js`, `lib/platform/api-server.js`, `scripts/platform-server.mjs`, proxy/server unit tests; wrap existing API default exports without changing exported test factories.

**Interfaces:** `maybeProxy(req,res)` returns boolean handled; `verifyProxy(req,body,{secret,consumeNonce})` authenticates forwarded bytes; `createPlatformServer({routes,verify,authHandler})` mounts fixed routes only. `SELF_HOSTED_API_ORIGIN` is server-only; invalid configured forwarding fails closed.

- [ ] Write/observe RED tests for exact host/path/method/body/header shape, tampering/replay, redirects, byte/time bounds, no write retry and generic failure responses.
- [ ] Implement bounded HMAC forwarding with route-specific request/response headers and original-client-IP binding.
- [ ] Implement API-only HTTP listener with safe JSON helpers, private health/readiness, request deadlines and shutdown; no arbitrary file serving or SQL endpoint.
- [ ] Test real handlers over HTTP, origin/auth denial and legacy disabled-forwarding mode; commit.

### Task 3: Authentik OIDC sessions

**Files:** create `lib/operator-identity/` OIDC/session/HTTP modules, `neon/migrations/008_platform.sql`, session/OIDC contract tests; modify operator auth factory call sites and operator config/auth bootstrap/UI/cache.

**Interfaces:** configured identity factory selects legacy Neon or local cookie sessions. Auth HTTP mounts `/api/auth/login`, `/api/auth/callback`, `/api/auth/logout`; callback consumes a one-time flow and creates a hash-only private session. Exact issuer/subject bindings map to existing/new explicitly approved operator IDs.

- [ ] Write/observe RED tests for login/callback success, state/cookie/nonce mismatch, replay, expiry, wrong issuer/audience, unapproved/disabled identities and logout CSRF.
- [ ] Use `openid-client` for protocol verification; keep secrets/provider tokens server-side and cookies host-only Secure/HttpOnly/SameSite=Lax.
- [ ] Preserve legacy auth behind an explicit mode; adapt sign-in bootstrap and advance shell cache; test installed-client upgrade and 390px UI.
- [ ] Test real PostgreSQL constraints and private permissions; commit.

### Task 4: Deployable stack and recoverability

**Files:** create `deploy/platform/` pinned Dockerfile/Compose/examples, `scripts/platform-jobs.mjs`, backup/restore/native verification helpers, `docs/SELF-HOSTING.md`; extend SQL migrations with explicit backend-role policies/grants.

**Interfaces:** app selects native driver; API, jobs, slicer use limited private DB credentials; only tunnel reaches API. Private secrets/config are deployed outside Git. Encrypted off-host backups have restore-verifiable manifests.

- [ ] Test config rejection for public DB ports, missing credentials, unsafe origins and unbounded work; implement resource/health/shutdown settings.
- [ ] Run leases/cleanup locally and inventory exact old/new job producers before handover; preserve VAPID, Blob and capability secrets.
- [ ] Provision an isolated PostgreSQL 18 candidate and dedicated Authentik app/tunnel through authorized secure setup. Bootstrap the exact approved owner subject.
- [ ] Apply 001–008, verify limited-role behavior, capture encrypted off-host backup and restore into a separate test database; commit source and runbook.

### Task 5: Whole-change verification and controlled cutover

**Files:** update deployment/privacy/runbooks/verification records and environment examples; retain private execution ledger without credentials.

- [ ] Run full `npm test`, screenshot generation and visual inspection; test native DB and OIDC/proxy failure contracts.
- [ ] Obtain fresh whole-change review; fix material findings with RED→GREEN regressions.
- [ ] Scan source/history/static output for secrets; build and inspect candidate images; verify source/private paths are denied.
- [ ] Verify candidate intake/upload/work/auth/estimates/jobs and draft-only billing capability without emailing real customers or dispatching invoices.
- [ ] Merge reviewed code to main, configure Production-only forwarding/operator auth and publish tunnel after readiness/backup gates. Pause old schedules and resume only verified local workers.
- [ ] Run live checks, verify an actual owner login, record remaining historical recovery separately, and preserve compatible rollback against the new database.
