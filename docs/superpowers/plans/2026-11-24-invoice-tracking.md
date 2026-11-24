# Invoice Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver consistent private invoice tracking, reliable invoice activity alerts and confirmed OKTAP reminders in the operator app and Home Assistant, then land and verify production.

**Architecture:** Extend the existing draft-only billing context with a separate read model for provider invoices, payment allocations and billing dispositions. Scheduled reconciliation persists normalized snapshots and durable events; owner and machine projections share that data. A separate outbound Home Assistant adapter delivers alerts without widening the read-only work-feed credential.

**Tech Stack:** Node ES modules, existing private PostgreSQL/API/jobs, vanilla operator UI, node:test, PGlite repository contracts, pytest browser coverage, Home Assistant built-in cards/services.

**Spec:** `docs/superpowers/specs/2026-11-24-invoice-tracking-design.md`

## Global Constraints

- Preserve draft-only creation and all existing intake, payment-verification and private-upload safeguards.
- No secrets in browser assets, repository records, error responses or logs.
- No historical alerts on baseline import; no inferred tax filing frequency.
- Include manual fabrication invoices; exclude unrelated company billing.
- Separate currency totals; distinguish provider-reported email opens from invoice views.
- Retain stale data with explicit sync health; incomplete pagination never proves deletion.

## Review Focus

- A draft may have a zero provider balance without being paid: status remains authoritative.
- Multiple allocations/payments between polls must survive as distinct events.
- Refunds and invoice corrections must not create false payment alerts.
- Date-only due dates use the configured business timezone, including DST boundaries.
- Failure after remote alert success but before acknowledgement can repeat delivery; persistent notification IDs remain stable.

## Execution context

Use managed worktree `C:/Users/jd/.codex/worktrees/0f78/3dprint4me`, based on `origin/main` at `cebdb31a`. The original checkout contains unrelated work and must not be reset or staged wholesale. User's repeated Continue instructions authorize continuing the reviewed design and release objective; execute inline and obtain one fresh review before landing.

### Task 1: Billing read-model domain

**Files:** create `lib/invoicing/tracking-domain.js`, `tests/unit/invoice-tracking-domain.test.mjs`.

**Interfaces:** `normalizeTrackedInvoice(raw)` produces an allowlisted provider snapshot with IDs, number, status, currency, integer amounts, due dates and bounded invitation activity timestamps. `presentInvoiceTracking(invoices, { now, timeZone })` returns counts, separate currency totals and rows with independent overdue/viewed/opened flags. `invoiceTrackingEvents(previous, current)` emits stable first-open/first-view event identities; payment events are added from authoritative allocation records in Task 2.

- [ ] Write tests for sent/partial overdue, due-today boundaries, timezone/DST, paid/draft/cancelled/reversed exclusions, draft zero balance, invalid dates/amounts, currency isolation and sensitive-field exclusion.
- [ ] Run `node --test tests/unit/invoice-tracking-domain.test.mjs`; verify missing functionality fails.
- [ ] Implement the exact interfaces with strict validation, no network/DB dependencies and integer money.
- [ ] Rerun the command; require all passing. Commit only Task 1 files.

### Task 2: Bounded provider reads and payment evidence

**Files:** create `lib/invoicing/tracking-provider.js`, `tests/unit/invoice-tracking-provider.test.mjs`; extend domain and its tests for payment allocations.

**Interfaces:** `createInvoiceTrackingProvider({ token, groupId, fetchImpl, timeoutMs }).readSnapshot()` returns complete normalized fabrication invoices and payment allocations or throws a sanitized failure. `normalizePaymentAllocation(raw)` retains stable allocation/payment/invoice IDs, amount/refund cents, update time and status; compare these records to emit transaction-backed payment/refund events.

- [ ] Verify current official hosted list/include/pagination/filter contracts; pin URLs under `https://invoicing.co/api/v1/` and log source references without credentials.
- [ ] Write failing contract tests for exact GET URL/headers, invitation fields, group exclusion, pagination, allocations/refunds, page-limit exhaustion, redirects, malformed/oversized responses, timeout and unconfigured mode making no calls.
- [ ] Implement bounded read-only access with completeness guarantees; never reuse caller-supplied URLs or follow provider pagination links to arbitrary hosts.
- [ ] Run both tracking test files; require all passing. Commit Task 2.

### Task 3: Private persistence, reconciliation and tax periods

**Files:** create next free migration under `neon/migrations/`, `lib/invoicing/tracking-repository.js`, `lib/invoicing/tracking-service.js`, `lib/invoicing/tax-periods.js`, corresponding unit tests and `tests/contract/invoice-tracking-repository.contract.test.mjs`; update migration/backup inventories.

**Interfaces:** repository provides atomic `claimSync`, `commitSnapshot`, `recordSyncFailure`, `readTracking`, settings/disposition commands and leased notification outbox operations. `createInvoiceTrackingService({ repository, provider, now })` exposes `sync()` and owner/machine projections. Tax functions validate explicitly confirmed periods/schedules and independent submitted/paid acknowledgements.

- [ ] Load Postgres best-practices before authoring schema. Write failing contracts for exclusive sync claim, first-import baseline, partial-read rollback, duplicate events, multiple payments, deleted/reversed records, lease expiry, stale freshness, owner-only revisioned settings/dispositions and tax acknowledgements.
- [ ] Implement additive private RLS schema and native/local test adapters following existing repository conventions; retain prior good snapshot on failure. Add backup/restore coverage.
- [ ] Add tax-date tests against current official Oklahoma rules; reject an unconfirmed schedule and keep submitted/payment state independent. Persist schedule evidence/effective date and audit changes.
- [ ] Run all tracking/tax/repository tests; require all passing. Commit Task 3.

### Task 4: API, jobs and recoverable Home Assistant delivery

**Files:** create `lib/invoicing/tracking-api.js`, `lib/invoicing/tracking-runtime.js`, `lib/invoicing/home-assistant-delivery.js`; modify `api/operator-work.js`, `api/home-assistant-work.js`, `lib/platform/jobs.js`, `scripts/platform-jobs.mjs`, relevant unit/contract tests.

**Interfaces:** owner-only billing resource exposes read/reconcile/settings/disposition/tax acknowledgement commands. Machine billing projection is explicitly versioned/minimized. Scheduled task syncs and drains a durable outbox. Outbound adapter uses a distinct server-only HA credential, fixed HTTPS origin and allowlisted services.

- [ ] Write failing tests for owner/origin isolation, strict payload limits, machine inability to run owner commands, sanitized errors, scheduling/non-overlap, disabled mode and safe delivery retry/lease/acknowledgement.
- [ ] Implement runtime composition and jobs; stable persistent notification IDs replace repeat deliveries. Keep phone destinations separate and disclose possible repeats on ambiguous timeout.
- [ ] Run focused API/jobs/delivery and existing HA/invoice regression tests; require all passing. Commit Task 4.

### Task 5: Operator Billing and Home Assistant visuals

**Files:** create `operator/assets/billing.js`; modify operator shell/API client/styles/service-worker build as needed, `integrations/home-assistant/package.yaml`, `dashboard.yaml`, `README.md`, screenshot tooling; add `tests/e2e/test_invoice_tracking.py` and UI/controller tests.

- [ ] Read relevant UI design skill and established operator components. Add failing tests for filters/counts/currency, stale/provider-failure display, needs-invoicing/no-charge disposition, settings, tax acknowledgements and navigation/session expiry.
- [ ] Implement owner Billing, Billing settings and Tax periods views with fixed provider links; preserve current per-job draft controls. Add built-in HA cards and minimized feed attributes without replacing unrelated dashboards.
- [ ] Run desktop/390px light/dark keyboard/reduced-motion browser coverage. Run screenshots and inspect preview board plus billing states. Commit Task 5.

### Task 6: Review, release and live acceptance

**Files:** update `docs/INVOICING.md`, `docs/DEPLOYMENT.md`, privacy/process documentation and timestamped private-safe verification record.

- [ ] Reconcile stale runbook claims with implemented behavior. Document exact secrets, scope, baseline/alerts, tax schedule, failure recovery and rollback.
- [ ] Run `npm test`, `npm run screenshots`, documentation build/checks and inspect `screenshots/preview-board.png`. Obtain fresh whole-change review; fix material findings with regression tests.
- [ ] Open PR, require green CI, land, deploy additive private migration/API/jobs/operator and HA configuration using current deployment runbook; verify provider and HA credentials without exposing them. Ask at action-time only for new security-sensitive credential/access grants if needed.
- [ ] Verify real fabrication invoice counts/status against Invoice Ninja, both rendered dashboards, periodic freshness, a labelled synthetic delivery alert, provider failure behavior, confirmed OKTAP dates and zero historical alert replay. Do not send/change real invoices or submit/pay taxes as smoke tests.
- [ ] Verify production smoke, intake paths and offline customizers; mark goal complete only when every requested outcome has current authoritative evidence.

## Ledger

- 2026-11-24: authenticated Edge access recovered through Browser extension; original Windows helper was the wrong control path. Existing fabrication-number filter returned one paid and one draft invoice. Existing HA work dashboard is live and queue-only. Do not commit customer-specific invoice details or portal links.
- Task 1: implementation and eight focused tests added; observed missing-module RED, implemented GREEN, then strengthened malformed status/time checks with a second RED→GREEN cycle. Broad baseline unit run remains live in session 18167; no whole-suite completion claim yet.
- Baseline unit run 18167 completed: 1,579 tests, 1,578 passed, one skipped, zero failed. The run began before tracking tests were added; focused tracking/legacy billing regression run subsequently passed 41/41.
- Task 2: bounded group-scoped reads and transaction allocation normalization implemented. Seventeen tracking tests pass, including pagination/duplicate/incomplete reads, currency inheritance, timeout, sanitized failures, refunds/reversals and first-import suppression. Sources verified against official `ClientFilters`, invoice/payment/paymentable transformers, `StaticController`, `Statics`, `Currency`, `Payment` and `config/app.php` at `v5-stable`. Hosted API response shape and its UTC server-time convention still require live contract verification before activation.
