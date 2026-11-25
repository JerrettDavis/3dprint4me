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
- Fresh whole-branch reviewer found four P2 issues (pending tax alerts after disable, correction generation dedupe, owner boundary accepting unconfirmed rules, missing payment-evidence warning). Each was reproduced/covered and fixed. Follow-up reviewer independently passed focused tests and confirmed all four addressed with no concrete remaining defects in those fixes. Monthly API enforces day 20/business-day adjustment; generic date library remains reusable.
- Handbook built and checked: 116 HTML pages, 714 search entries, all local links/assets and documented BDD references passed. Updated reviewed public manifest for the two edited public docs and the new privacy-safe billing runbook. Generated handbook output was moved to private local data after checks because its independent assets change the storefront-wide version hash; no storefront asset-version churn is needed.
- Final full suite live: session 95134, log data/invoice-full-test-2.log. Screenshot rerun live: session 99029, log data/invoice-screenshots-2.log. Earlier screenshot run 82028 terminated with an existing selector becoming ambiguous because the new disposition panel nested a second invoice-sheet; changed the inner panel to billing-disposition, then reran. Earlier full test stopped at validation while generated handbook was present; current run passed build/static validation and is running unit tests.
- Ruling: current production scope remains the verified fabrication client group. Explicit mixed-brand invoice overrides are not activated in this release because the live group already contains the expected invoices; adding cross-group access without an actual scoped use case would broaden private billing access. The design's future override requirement remains a documented extension, not an implemented capability.
- Task 3/4/5 continuation: added owner/machine service composition, persistent local PGlite development adapter, private billing API resource, independent native reconcile/tax/delivery schedules, HTTPS Home Assistant delivery with stable IDs and bounded retries, audited failed-alert retry, overdue-boundary events, and cancellation of queued reminders after acknowledgement/disable. Initial targeted RED failures were observed for each domain/API/schedule/delivery/local/retry behavior before GREEN implementations.
- Owner Billing/settings/tax view and per-work billing dispositions implemented using existing operator styles. Desktop/390px Edge UI tests pass with independent filing/payment actions, filtering, stale state, keyboard return focus and reduced motion. Service-worker shell advanced to v38. Full screenshot run is live in session 82028; unit session 35119 completed 1,628/1,628, but predates the last overdue/retry/cancellation additions and final full verification remains required.
- Read-only live provider contract passed using the existing native jobs credential without exporting it: two scoped invoices, one paid, one draft, one allocation, USD only. Native API environment contains group/enable flag and inbound HA token; jobs environment holds the existing Invoice Ninja token but lacks tracking group/enable settings. Prepare a deliberate private rollout projection, not a redundant provider credential.
- First unacknowledged monthly reporting period was requested asynchronously; do not infer that an invoice date proves a reporting period was filed or paid. No production tracking migration/UI/jobs deployment has occurred yet.
- 2026-11-24 continuation: release/rollout support suite completed 36/36; repaired migration inventory E2E completed 4/4. Official OTC Businesses Help Center confirms the 20th of the following month and next-business-day adjustment for weekends/observed state holidays. Monthly frequency is owner-confirmed; first period and holiday calendar remain to verify before activation.
- Task 3: independently callable transactional tax advancement now generates monthly periods and deduplicates durable filing/payment reminders even when the invoice provider fails. Observed missing-method RED, then native PGlite contracts GREEN (10/10). Existing acknowledgements and unchanged revisions survive repeated ticks.

- 2026-11-24 17:47 CST: owner explicitly confirmed OKTAP filing frequency is monthly. Monthly is now a product requirement, not a guessed default. Due-day/holiday rules, effective reporting period and activation still require validation.
- Full suite 99910 is terminal: builds/static validation and 1,596 unit tests passed; browser run finished with 621 passed, seven skipped, one failure in the reviewed migration inventory guard (19 expected vs new migration 020). Audit did not run because the pipeline stopped. Reproduced the guard failure before updating reviewed release inventories; do not restart the old session.

- 2026-11-24: authenticated Edge access recovered through Browser extension; original Windows helper was the wrong control path. Existing fabrication-number filter returned one paid and one draft invoice. Existing HA work dashboard is live and queue-only. Do not commit customer-specific invoice details or portal links.
- Task 1: implementation and eight focused tests added; observed missing-module RED, implemented GREEN, then strengthened malformed status/time checks with a second RED→GREEN cycle. Broad baseline unit run remains live in session 18167; no whole-suite completion claim yet.
- Baseline unit run 18167 completed: 1,579 tests, 1,578 passed, one skipped, zero failed. The run began before tracking tests were added; focused tracking/legacy billing regression run subsequently passed 41/41.
- Task 2: bounded group-scoped reads and transaction allocation normalization implemented. Seventeen tracking tests pass, including pagination/duplicate/incomplete reads, currency inheritance, timeout, sanitized failures, refunds/reversals and first-import suppression. Sources verified against official `ClientFilters`, invoice/payment/paymentable transformers, `StaticController`, `Statics`, `Currency`, `Payment` and `config/app.php` at `v5-stable`. Hosted API response shape and its UTC server-time convention still require live contract verification before activation.
- Task 3 (in progress): migration 020, native transactional snapshot/event/command repository, sync coordinator and owner-confirmed tax-period domain added. Eight real PostgreSQL contracts and seven tax tests pass; current combined tracking/tax/migration verification is 35/35. Schema is not applied to production. Remaining Task 3 work: owner command/projection composition, work-revision checks, local dev adapter, tax schedule/account/official-rule verification, release/recovery wiring and review.
- Task 3: Ruling: require an explicit confirmed due day and holiday calendar rather than hard-code unverified OKTAP defaults. The account's filing frequency question remains pending. Tax schedule activation still requires official/account validation; an incorrect confirmed rule would produce incorrect reminders and must be caught before activation.
- Task 3: provider snapshots now carry verified current-company/group identity; a changed source cannot overwrite an existing read model. The current-company lookup is the documented read-only POST already used by the draft adapter.
- Full `npm test` started in session 99910 after Task 2: build/static checks passed, 1,596 unit/contract tests passed, browser suite is still running (last observed 22%, two skips). That run predates the new Task 3 tests; it does not replace the fresh 35-test focused run or final whole-change verification. Poll the same live session; do not restart it merely because output is delayed.
- Worktree: `C:/Users/jd/.codex/worktrees/0f78/3dprint4me`, branch `feat/invoice-tracking-ha`. Browser handles remain `edge`, `invoiceTab`, `haTab`, `workTab` in the persistent browser session; reuse the Edge binding and obtain fresh tabs if necessary. Auth is working after the owner disabled the blocking extension. Never use the failed Windows helper as evidence Edge is unavailable.
- Task 3 continued: `tracking-commands.js` now implements owner-only settings/disposition/tax acknowledgement/correction commands and minimized owner/machine projections. Native commands atomically recheck work revisions and store actionable audit metadata, including correction reasons. Current combined focus suite is 42/42 passing. Source/domain/DB/tax code remains disconnected from production UI/API/jobs until Task 4/5. Remaining: service read/command composition, automatic tax-period advancement, local adapter, native release/recovery inventories, official/account schedule validation.
- Credential discovery: root checkout `.env.local` and `.env.production.local` contain no Invoice Ninja or Home Assistant integration variable names. No credential values were printed. Existing provider configuration may reside on the native host; use its documented private deployment controller rather than extracting browser session tokens or creating redundant keys.
- Full suite session 99910 remains live: browser suite last observed at 34% with capability skips, after the 1,596/1,596 unit run. Do not claim the full suite passed or assume this earlier run covers Task 3 additions.
