# Invoice Ninja Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Create private, recoverable Invoice Ninja drafts from confirmed operator billing data, with manual dispatch only.

**Architecture:** A separate invoicing context owns validation, provider access and billing persistence. The existing authenticated operator app calls a thin API boundary; public intake remains independent.

**Tech Stack:** Node 22 ES modules, Neon Postgres, existing vanilla operator UI, node:test and pytest E2E.

**Spec:** `docs/superpowers/specs/2026-10-20-invoice-ninja-design.md`

## Global Constraints

- Never send, mark sent, charge, or mark paid through the integration.
- Only `public/` is static output; credentials remain server-only.
- Customer uploads and sensitive generator fields never enter billing data.
- Browser estimates remain non-binding; an owner explicitly confirms billing.
- Provider timeouts after dispatch require reconciliation, never blind POST retry.
- No remote requests from customizer pages; preserve all four intake paths.

## Review Focus

- Fractional quantities and 8.517% tax retain precision through server/provider comparison.
- Identical browser retries and concurrent commands create one durable operation.
- A timeout after successful remote creation never leads to automatic duplicate creation.
- Provider HTML/errors/redirects do not leak credentials or raw internal messages.
- Session expiry, stale work revision and navigation cannot associate an invoice with another job.

### Task 1: Billing validation and calculation

**Files:** Create `lib/invoicing/domain.js`, `tests/unit/invoicing-domain.test.mjs`.
**Interfaces:** `normalizeBilling(input)` returns an allowlisted immutable billing snapshot; `calculateBilling(snapshot)` returns integer subtotal/tax/total cents. Quantities are integer thousandths; tax rates integer thousandths of a percent. Dates are real ISO dates; tax evidence and receipt location are mandatory. An unresolved prior deposit blocks creation.

- [ ] Write tests for a $140 subtotal at 8.517%, mixed line rates, fractional quantities, invalid dates, oversized values, unknown/sensitive fields and unresolved deposits.
- [ ] Run `node --test tests/unit/invoicing-domain.test.mjs`, observe missing module failure.
- [ ] Implement bounded strict validation and integer rounding; rerun to PASS.

### Task 2: Draft-only provider adapter

**Files:** Create `lib/invoicing/invoice-ninja.js`, `tests/unit/invoice-ninja.test.mjs`.
**Interfaces:** `createInvoiceNinja({token,groupId,fetchImpl,timeoutMs})` exposes client lookup, draft creation, invoice refresh and exact-reference reconciliation only. Never accept caller-supplied URLs or send flags.

- [ ] Verify create/read/client/tax contracts in official documentation and source; record limitations in the runbook.
- [ ] Test exact host/path/method/headers, absent send/paid flags, group membership, tax payload, bounded responses, timeouts, redirects and sanitized failures.
- [ ] Run tests RED; implement minimal adapter; rerun PASS.
- [ ] Refuse provider totals/status/client mismatches; retain the provider ID for recovery.

### Task 3: Durable billing operations

**Files:** Create `neon/migrations/007_invoicing.sql` (006 already contains model packs), `lib/invoicing/repository.js`, `lib/invoicing/local-repository.js`, `lib/invoicing/service.js`, and repository/service unit or contract tests.
**Interfaces:** Repository claims immutable work/revision billing operations atomically and records outcomes; service coordinates preview/create/refresh/reconcile against Task 1 and Task 2. Return status plus a validated editor link; never expose provider payloads.

- [ ] Load Postgres skill before schema work. Test local and Postgres contracts, concurrent claims, stale revisions, key/payload conflicts and interrupted operations.
- [ ] Run RED, implement additive schema and adapters, run PASS.
- [ ] Test accepted-but-timed-out creation: one POST, durable needs-reconciliation, exact remote match on owner reconciliation, no automatic recreate.
- [ ] Enforce owner role and brand/client checks before dispatch; store no upload/request snapshot.

### Task 4: Operator API and UI

**Files:** Create `lib/invoicing/operator-api.js`, `lib/invoicing/runtime.js`, `operator/assets/invoice-detail.js`; modify `api/operator-work.js`, `operator/assets/api-client.js`, `operator/assets/operator.js`, `operator/assets/operator.css`, `scripts/dev-server.mjs` and relevant API/E2E tests. Route billing through the existing work endpoint to preserve the twelve-function deployment limit.
**Interfaces:** Owner-only preview/create/refresh/reconcile actions use existing origin/auth handling. A separate job-detail panel accepts confirmed client, dates, address, tax evidence, deposits and line items; preview totals precedes explicit Create draft confirmation. Manual dispatch link opens Invoice Ninja.

- [ ] Test unconfigured mode, authorization, origin, malformed actions and data isolation RED; implement API and rerun PASS.
- [ ] Test controller/form behavior including session expiry, rapid duplicate clicks and navigation to another work item; implement UI.
- [ ] Add desktop/390px E2E coverage for preview/create/recovery/refresh; no send button or customer email action.

### Task 5: Verification, docs and secure activation

**Files:** Update `docs/INVOICING.md`, `docs/DEPLOYMENT.md`, relevant privacy copy and screenshot tooling.

- [ ] Document environment names, migration, manual send policy, ambiguous timeout recovery, tax review and prior deposits.
- [ ] Run `npm test` and `npm run screenshots`; inspect `screenshots/preview-board.png`.
- [ ] Obtain one fresh whole-change review, fix material findings with regression coverage, rerun affected checks.
- [ ] Configure production token through a secure approved setup flow; deploy only after code/checks are concrete and reviewable.
- [ ] Verify one non-sent draft from deployed operator UI, provider totals, PDF and payment refresh. Complete remaining account logo/preview verification. Never dispatch a test or customer invoice automatically.
