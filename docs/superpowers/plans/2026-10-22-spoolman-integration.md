# Spoolman Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically reflect Spoolman's physical spools in private filament management, stock matching, and honest estimate costs, with verified live syncing and recoverable failures.

**Architecture:** Add a server-only Spoolman bounded context with an HTTP adapter, pure mapping rules, snapshot sync service, and local/PostgreSQL persistence. The existing jobs worker owns scheduled imports; owner-triggered refresh queues the same job so the API needs no Spoolman network access. Existing inventory, matching, and operator UI consume source metadata and freshness consistently.

**Tech Stack:** Existing Node 22 ES modules, native fetch, PostgreSQL, local JSON development adapter, vanilla operator UI, node:test, pytest/Playwright, Docker Compose. No new runtime package.

**Spec:** `docs/superpowers/specs/2026-10-22-spoolman-integration-design.md` (owner approved 2026-10-22 at 12:36 CDT).

## Global Constraints

- Spoolman requests originate only from server-side jobs or authenticated server operations, never the storefront, customizer, or browser.
- Preserve manual inventory, stable imported identities, customer requirements, historical proposals, and source-owned versus local-only fields.
- Pull every minute; stale after five minutes without a complete success. A failed fetch never means empty inventory.
- Spoolman owns stock; never write back or deduct printer consumption twice.
- Missing cost is unknown, never zero. Preserve fractional source weights; conservatively floor available grams for matching.
- Multicolor, transparent, unknown material, unknown weight, or stale imported stock cannot produce a confident ready result through candidates or proposal acceptance.
- Preserve existing Authentik and Home Assistant endpoint restrictions. Private jobs network connects to Spoolman's application only, never its database network.
- Run `npm test`, `npm run screenshots`, and inspect `screenshots/preview-board.png`. Update versioned assets and operational documentation.

## Review Focus

- The source changes between paginated reads: reject inconsistent IDs/totals, and never deactivate stock from an incomplete snapshot (Task 1/2).
- A sync succeeds without changing any spool: refresh freshness without incrementing every stock revision or invalidating approvals (Task 2).
- An accepted proposal points at stock that later becomes stale or multicolor: retain history but require review before production (Task 3).
- A source price disappears or changes currency: clear usable source cost, retain local override, report uncovered grams, and use fallback rather than zero (Task 1/3).
- A manual inventory edit races a sync: preserve local fields, reject stale saves, and never replace newer source data (Task 2/4).

## Task 1: Bounded provider and source normalization

**Files:** Create `lib/spoolman/adapters/http-spoolman.js`, `lib/spoolman/domain.js`, `tests/unit/spoolman-provider.test.mjs`, `tests/unit/spoolman-domain.test.mjs`.

**Interfaces:**
- `createSpoolmanProvider({baseUrl, hostHeader, fetchImpl = fetch})` exposes `snapshot({signal}) -> {currency, spools}`; unset base URL yields explicit unconfigured capability.
- `normalizeSpoolmanSnapshot({instanceId, currency, spools}) -> {instanceId, currency, items}`. Each item has stable source spool ID, raw labels, mapped material, appearance flags/colors, source weights, optional source price cents, and source fingerprint. Local fields are absent from the source document.
- `importedEligibility(row, {now, lastSuccessAt}) -> {eligible, reasons}` is a pure reusable freshness/material/appearance/weight gate.

- [ ] Read official Spoolman 0.27.0 source and live OpenAPI to verify spool-vs-filament price fallback, nominal-weight cost denominator, settings JSON encoding, archive selection, pagination totals, material/finish fields, and Host restrictions. Record supported semantics in `docs/SPOOLMAN.md`.
- [ ] Write failing provider tests asserting GET `/api/v1/spool?allow_archived=true&limit=...&offset=...`, the currency request, explicit Host/Accept headers, redirects rejected, bounded timeout/bytes/pages/count, and sanitized errors. Verify the tests fail before implementation with `node --test tests/unit/spoolman-provider.test.mjs`.
- [ ] Implement a total snapshot deadline of 30 seconds, page size 200, maximum 5,000 spools and 16 MiB total JSON. Reject malformed/duplicate IDs, inconsistent totals, count truncation, wrong content type, unknown currency shape, and incomplete pages. If the deployed API cannot establish safe pagination completeness, use one bounded unlimited response (supported by the verified API) rather than pretending paginated reads are atomic. No partial return value is publishable.
- [ ] Write failing mapping tests for the six observed material labels; keep `pla-plus` distinct and unknown labels ineligible. Test missing versus explicit zero prices, non-USD costs, invalid/out-of-range numbers, initial-weight/filament-weight semantics, fractional weights, multicolor label fallback, transparent finish, and source text bounds.
- [ ] Implement pure mapping with original labels and source precision preserved; use an explicit TPU alias table, conservative stock rounding, and no guessed color/material/cost. Do not pass imported nullable values through manual-input validation. Run both test files until passing.
- [ ] Commit provider, domain, tests, and verified semantics documentation.

## Task 2: Atomic snapshot persistence and synchronization

**Files:** Create `neon/migrations/011_spoolman_inventory.sql`, `lib/spoolman/application.js`, `lib/spoolman/adapters/postgres-spoolman.js`, `lib/spoolman/runtime.js`, `tests/unit/spoolman-sync.test.mjs`, `tests/contract/spoolman-repository.contract.test.mjs`. Modify `scripts/migrate-neon.mjs`, both `lib/print-estimation/adapters/*-print-repository.js` repository implementations, and relevant migration/recovery table catalogs identified by `git grep`.

**Interfaces:**
- `createSpoolmanSync({provider, repository, instanceId, now})` exposes `run()` and `status()`; `run()` claims a database lease before reading the source, then atomically applies a complete snapshot and success metadata under that same lease token.
- Repository methods: `claimSpoolmanSync({instanceId, token, leaseUntil})`, `applySpoolmanSnapshot({instanceId, token, snapshot, completedAt})`, `failSpoolmanSync({instanceId, token, code, attemptedAt})`, `getSpoolmanStatus()`, and `requestSpoolmanSync({operatorId})`. Local adapter serializes equivalent operations through its existing exclusive mutation queue.
- Inventory rows expose nullable `source` metadata (instance/spool identity, raw fields, currency/cost provenance, last complete success, eligibility flags). Manual rows have no source metadata. Sync status is separate from per-spool meaningful revisions.

- [ ] Load `supabase:supabase-postgres-best-practices` before authoring database changes. Read existing inventory constraints, RLS, native role grants, migration tests, and recovery table catalogs.
- [ ] Write failing sync/repository tests for first import, repeat unchanged import, changed stock, source price removal, archive/deletion/reactivation, empty valid snapshot, failed fetch retention, expired lease, concurrent run, stale publisher rejection, and local-field edit racing import. Run the new tests and confirm expected failures.
- [ ] Add source metadata and nullable imported cost/weight representation without weakening manual input rules. Add uniqueness for `(source instance, spool ID)`, durable sync state/refresh requests, backend-only grants/RLS, and check constraints distinguishing manual and imported records. Preserve old IDs/history and make migrations rerunnable. Register migration and new tables in verification/recovery tools.
- [ ] Implement PostgreSQL transaction/lease-token checks and local atomic mutation. Deactivate only missing source-owned rows from a complete snapshot. Compare fingerprints before incrementing revisions; update overall freshness separately on unchanged syncs. Never overwrite local notes, override cost, freight, or estimate-default flag.
- [ ] Implement safe failure codes and unconfigured status; a failed run updates attempt/failure state and releases its own lease without deleting previous success. A refresh request only queues work and is coalesced with the next run.
- [ ] Run meaningful contract tests against both adapters, including restricted-role denials on new tables and migration reruns. Commit persistence, application, and tests.

## Task 3: Accurate pricing and readiness from imported stock

**Files:** Modify `lib/print-estimation/inventory.js`, `lib/print-estimation/application/filament.js`, `lib/filament-matching/domain.js`, `lib/filament-matching/application.js`, and inventory row projection/query methods. Extend `tests/unit/print-filament-inventory.test.mjs`, `tests/unit/filament-proposals.test.mjs`, and create `tests/unit/spoolman-pricing-matching.test.mjs`.

**Interfaces:** Existing material-cost result remains compatible and adds cost coverage/provenance/freshness metadata; manual results remain unchanged. Matching consumes `importedEligibility` using an injected clock and current sync success. Owner import overrides use a separate validated local-fields command rather than resubmitting source fields.

- [ ] Write failing tests showing an imported missing cost cannot lower a weighted average to zero; a known-cost subset reports uncovered grams; no usable cost triggers documented material fallback; a local override survives currency/price changes; stale source cost is visibly dated. Run those tests before changing pricing.
- [ ] Implement precedence local override, usable source cost, fallback. Use the verified nominal/initial-weight denominator for source prices; exclude unknown costs from known-cost averages. Preserve explicit zero only when the source actually records zero. Remove the existing material lookup's 200-row truncation so estimates cover all supported inventory rows consistently with the 5,000-record bound.
- [ ] Write failing tests for freshness at the five-minute boundary, unknown weights/materials, multicolor with a familiar color name, transparency, manual inventory during provider downtime, accepted offers turning stale, and stale proposal acceptance rejected. Test unchanged-sync freshness renewal without new revisions.
- [ ] Apply the same eligibility gate to candidates, selected-stock readiness, proposal creation, `verifyOffer`, email-send eligibility, and accepted proposal status. Preserve audit history and show review/unavailable reasons; never let an accepted status bypass current eligibility. Continue to allow qualifying manual inventory.
- [ ] Run related inventory, matching, and proposal suites; verify manual legacy behavior and exact-material defaults. Commit pricing and readiness changes.

## Task 4: Scheduled sync, operator controls, and imported inventory UI

**Files:** Modify `scripts/platform-jobs.mjs`, `lib/platform/jobs.js`, `api/operator-print.js`, `operator/assets/filament-inventory.js`, its API/controller call sites, and operator CSS only as necessary. Extend `tests/unit/operator-filament-api.test.mjs`, scheduler tests, `tests/unit/operator-filament-ui.test.mjs`, and `tests/e2e/test_operator_filament.py`.

**Interfaces:** GET `resource=filament` adds sync status alongside `items` and `effective`. POST `{action:'refresh-spoolman'}` queues owner-only refresh. POST `{action:'save-imported-filament', id, revision, local:{estimateDefault,freightFeeCents,notes,costOverrideCents}}` updates only validated local fields; null override clears it. Both use existing auth, exact-field checks, allowed-origin policy, and optimistic revisions.

- [ ] Write failing scheduler/API tests for one-minute imports, no overlapping lease holders, queued refresh coalescing, unconfigured mode, safe failures, unauthorized operator refresh/edit, wrong origin, and attempts to change imported source fields through either save route.
- [ ] Add the scheduled operation with independent error handling and existing job-health integration. The jobs process alone constructs the provider; the API only reads sync state and queues refreshes. Manual refresh must not falsely report completion before the worker runs.
- [ ] Implement status presentation: unconfigured, queued/running, healthy, failed-with-last-success, and stale. Show source spool identity/link, exact remaining weight and conservative available grams, mapped/raw material, multicolor description, unknown-cost/fallback/coverage labels, and missing data warnings.
- [ ] Separate imported edit controls from manual stock-lot controls. Render source-owned fields read-only and link to the configured human UI through a validated origin; local fields remain owner-editable. Server enforcement must reject bypasses independently of disabled UI controls. Preserve ordinary operator read access.
- [ ] Add browser coverage for refresh lifecycle, stale/failed status, imported local override save, source-field lock, manual inventory, multicolor review, accepted stale proposal, keyboard focus, 390-pixel layout, and themes/reduced motion. Run targeted API, scheduler, and browser tests. Regenerate `?v=` references with `npm run assets:version` and commit.

## Task 5: Private deployment, complete verification, and live activation

**Files:** Modify `deploy/platform/compose.yml` and `deploy/platform/api.env.example` or add jobs-only configuration example; add private-network deployment fragment as needed. Update `docs/SPOOLMAN.md`, `docs/SELF-HOSTING.md`, `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md`, `docs/PRINT-ESTIMATION.md`, `docs/OPERATOR-INBOX.md`, and `docs/VERIFICATION.md`. Record production evidence in `docs/SPOOLMAN.md` without credentials or raw private inventory dumps.

- [ ] Add contract tests asserting only jobs joins the dedicated Spoolman application network, no published ports or database network membership are added, source configuration stays server-only, API refresh queues rather than fetching, and the existing human/HA endpoint restrictions remain unchanged.
- [ ] Configure a dedicated shared Docker network between jobs and Spoolman application via an idempotent deployment fragment maintained with the existing homelab deployment. Verify restart/redeploy persistence, exact private DNS alias, and allowed Host behavior. Keep source instance ID, base URL, Host header, and human UI origin in private configuration. Keep credentials out of rendered Compose output and Git.
- [ ] Run `npm test` and resolve relevant failures. Run `npm run screenshots`, open `screenshots/preview-board.png`, inspect imported inventory and matching views at desktop/mobile in light/dark, and fix any visible issues. Run production build and inspect generated assets for server-only configuration leakage. Obtain a fresh whole-change review, fix findings, and rerun affected checks.
- [ ] Recheck source currency, complete spool count, and destination inventory immediately before activation. If new manual rows can duplicate physical spools, resolve with the owner before enabling import. Verify current deployment/PR state and deploy through the repository's established release procedure; preserve unrelated invoice edits.
- [ ] Back up the target database and verify recoverability; apply migration 011 with the owner/migrator role, verify runtime grants/denials, and deploy API/jobs/operator consistently. Enable jobs-only source configuration. No changes to physical source spool records are required.
- [ ] Compare every imported source ID and mapped field against a fresh complete Spoolman response; prove all source records accounted for, including archived state. Verify all 80 observed spools if the source count remains 80; use actual count otherwise. Confirm a second scheduled sync refreshes success without duplicates or unnecessary revision changes.
- [ ] Verify actual missing-cost fallback/coverage, representative material/color matching, multicolor exclusion, local-only override behavior, authenticated refresh completion, unconfigured manual mode, and safe production failure/stale behavior using an isolated reversible worker/provider failure without modifying physical spool data or interrupting unrelated jobs. Restore healthy syncing and verify the next successful snapshot.
- [ ] Document actual test counts, deployment commit, migration, sync timestamps/counts, reconciliation results, failure recovery, and physical onboarding limits. Audit every spec requirement against current evidence before marking the goal complete. Commit final evidence and versioned screenshots.

## Plan self-review

The five tasks cover all approved spec sections: live API semantics and mapping (1), stable atomic storage and recovery catalogs (2), cost/readiness/proposal behavior (3), automatic/manual sync and UI permissions (4), private networking, documentation, full checks, and production verification (5). Interfaces keep imported nullable data separate from manual inputs and route refresh through the worker to avoid broadening API network access. The review-focus failures are assigned explicit regression coverage above. No feature code has been changed while preparing this plan.
