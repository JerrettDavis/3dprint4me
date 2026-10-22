# Filament Inventory and Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Manage private filament stock, progressively match requested colors within adjustable HSL/RGB bounds, and support audited customer-requested or operator-recorded substitution decisions in the work pane.

**Architecture:** Extend the existing print inventory and its local/PostgreSQL repository adapters. Put color policy, requirement extraction, matching, and proposal operations in `lib/filament-matching/`; compose an independently failing private read model into work detail. Keep UI in focused operator modules, and email delivery in a provider adapter.

**Tech Stack:** Existing JavaScript ES modules, Node test runner, PostgreSQL/PGlite, local JSON storage, vanilla DOM, pytest/Playwright, existing email provider.

**Spec:** `docs/superpowers/specs/2026-10-21-filament-matching-design.md` (approved 2026-10-21).

## Global Constraints

- Only `public/` is storefront static output; private operator UI remains in `operator/`.
- No secrets, private stock costs, or sensitive generator fields enter public assets, matching records, or customer messages.
- Exact material by default; cross-material alternatives require explicitly configured directional rules.
- HSL/RGB hard limits are always measured against the original requested color.
- Recommendations and sending are distinct from acceptance; no automatic purchases or stock consumption.
- Preserve original request data, pricing behavior, all service paths, and useful work detail during matching failure.
- Support keyboard use, light/dark/system themes, reduced motion, and 390-pixel layout.
- Run `npm test`, `npm run screenshots`, and inspect `screenshots/preview-board.png` before completion.

## Review Focus

1. A count such as `colors: "3"` is not three color names; missing hue requirements must remain unresolved (Task 2).
2. A pale teal on the allowed boundary must not admit green through chained widening or hue wrap mistakes (Task 1).
3. Two requirements selecting one stock lot must not each claim its full remaining grams (Task 2).
4. An inventory edit after proposal creation must preserve what was offered while showing current shortages (Tasks 3–4).
5. A send timeout or replaced proposal must never become accepted or silently trigger duplicate customer mail (Tasks 4–5).

## File and Interface Map

- `lib/filament-matching/color.js`: hex parsing, RGB/HSL conversion, CIELAB distance, hard-bound differences.
- `lib/filament-matching/domain.js`: settings/requirement validation, deterministic banded matching, proposal transitions.
- `lib/filament-matching/requirements.js`: explicit print/generator requirement extraction, excluding sensitive schema fields.
- `lib/filament-matching/application.js`: private read model, owner settings and inventory coordination, revisioned work operations, delivery lifecycle.
- `lib/filament-matching/adapters/substitution-email.js`: safe plain/HTML message and existing provider delivery.
- Extend `lib/print-estimation/inventory.js`, `application/filament.js`, both `adapters/*-print-repository.js`: color hex, inventory revision, matching persistence.
- `neon/migrations/010_filament_matching.sql`: additive inventory columns and private singleton settings/per-work matching records.
- Extend `api/operator-print.js`, `api/operator-work.js`, `lib/work-management/service.js`, `runtime.js`, and `scripts/dev-server.mjs`: API and composition seams.
- `operator/assets/filament-inventory.js`, `filament-detail.js`: inventory/settings and request matching/proposal DOM.
- Extend operator `api-client.js`, `operator.js`, `operator.css`, `index.html`, build/service-worker manifests as required.
- Tests: `tests/unit/filament-color.test.mjs`, `filament-requirements.test.mjs`, `filament-proposals.test.mjs`, `operator-filament-api.test.mjs`, `operator-filament-ui.test.mjs`; `tests/contract/filament-matching.contract.test.mjs`, `substitution-email.contract.test.mjs`; `tests/e2e/test_operator_filament.py`.

### Task 1: Color bounds and progressive ranking

**Interfaces:** `parseColor(value) -> { hex, rgb, hsl, lab } | null`; `normalizeMatchingSettings(input) -> settings`; `matchRequirement(requirement, inventory, settings) -> { status, recommendedId, candidates, furtherCandidates, band, warnings }`.

- [x] Write failing color tests for hex normalization, RGB/HSL conversion, circular hue, asymmetric hue, inclusive bounds, near-neutral hue handling, and known Lab reference values.
- [x] Run `node --test tests/unit/filament-color.test.mjs`; confirm failures from missing implementation.
- [x] Implement local numeric color math; use CIE76 distance for ranking, with hard HSL/RGB eligibility independent of that rank.
- [x] Write failing matching tests: one candidate, several candidates with deterministic ID ties, first populated band, further eligible bands, maximum boundary, empty stock, inactive stock, exact material, explicit directional substitutions, and unknown values.
- [x] Implement settings: `mode` (`hsl|rgb|both`), `hueClockwise`/`hueCounterclockwise` (0–180 degrees), `saturation`/`lightness` (0–100 percentage points), `red`/`green`/`blue` (0–255), `closePercent`/`stepPercent` (1–100), `stockBufferGrams` (0–100000), `materialRules` (at most 50 explicit `{ from, to }` pairs). Reject unknown keys and nonfinite values.
- [x] Default to HSL, hue limits 45 degrees each, saturation/lightness 35, RGB limits 80, close/step 25%, buffer 10g, no material rules. Zero tolerances mean exact channel agreement. Achromatic colors require usable RGB bounds or review.
- [x] Rank eligible candidates by exact material first, then CIE76 distance, then stock sufficiency when known, then ID. No transitive search; every widening fraction multiplies the original hard limits. Keep exact candidates distinguishable from substitutions.
- [x] Run the combined color/domain unit file; verify blue/purple/teal versus red/pink/green fixtures using explicit wide HSL settings. Commit this task's files.

### Task 2: Requirements and stock assessment

**Interfaces:** `requirementsForWork(detail, { override = null, estimate = null }) -> { requirements, totalGrams, warnings, applicable }`; each requirement has stable `id`, `label`, `material`, `color`, optional `colorHex`, `brandLine`, and `grams`. `matchWorkRequirements(requirements, inventory, settings) -> assessment`.

- [x] Write tests using actual request-summary keys and generator definitions: normal print requests without estimate assets, explicit names/hexes, numeric color count, multiple generator colors, redacted/sensitive schema entries, missing material, non-print service, and operator override.
- [x] Run `node --test tests/unit/filament-requirements.test.mjs` and confirm failures.
- [x] Implement extraction from allowlisted explicit fields and generator schema color fields only. A print `colors` count is not a color value. Do not infer customer colors or material from arbitrary prose. Retain ambiguity warnings.
- [x] Validate at most 32 overridden requirements, unique stable IDs, bounded labels, material identifiers, valid optional hex, and nonnegative finite optional grams. Overrides never modify request provenance.
- [x] Add stock tests where two requirements use one lot, one known total has no per-color split, and stock falls below required grams plus buffer. Share available grams within a request without reserving across work items; never report sufficiency for unknown per-color demand.
- [x] Implement work assessment with purchase/substitution/review flags and current-stock explanations. Unknown requirements remain reviewable even if no candidate can be ranked.
- [x] Run requirements/matching tests and existing inventory/pricing tests. Commit task files.

### Task 3: Revision-safe persistence with adapter parity

**Interfaces:** repository `getMatchingSettings() -> { revision, settings }`; `saveMatchingSettings({ revision, settings, operatorId }) -> record`; `getWorkMatching(workId) -> { revision, requirementsOverride, proposals, history }`; `saveWorkMatching({ workId, revision, document }) -> record`. Inventory rows gain nullable `colorHex` and integer `revision`.

- [x] Load PostgreSQL authoring skill before writing migration or SQL; inspect existing query/transaction patterns and migration contract harness.
- [x] Write adapter contract tests for empty defaults, legacy inventory rows, hex round-trip, inventory compare-and-swap, settings compare-and-swap, first per-work save, stale work saves, append-only proposal history, and independent work IDs. Run to confirm failure.
- [x] Add migration 010 (following current main's 007–009): inventory hex and revision columns with constraints; private singleton settings and work matching tables with JSONB document, revision, timestamps and work-item FK. No new public grants; use existing private DB access pattern.
- [x] Implement local persistence in the existing atomic JSON mutation queue, backward-compatible empty-state defaults. Implement PostgreSQL insert/update compare-and-swap with parameterized SQL. Conflicts return safe HTTP 409; nonexistent inventory IDs return 404. Require revision for edited inventory; update old tests/callers to send it.
- [x] Extend inventory normalization and presentation without changing effective material cost selection. Keep bounded reads explicit: matching must detect truncated inventory rather than report stock absent from an incomplete result.
- [x] Run `node --test tests/contract/filament-matching.contract.test.mjs tests/unit/print-filament-inventory.test.mjs` against local and PGlite adapters. Commit migration, repository changes, and contracts.

### Task 4: Work read model and audited proposal state

**Interfaces:** `createFilamentMatchingUseCases({ repository, now, delivery })` exposes `forWork(detail)`, `preview(detail, settings)`, `saveSettings(input, operator)`, and `command(detail, input, operator)`; commands are `save-requirements`, `propose`, `accept-on-behalf`, `record-customer-response`, and `reopen` with required matching revision.

- [x] Write tests for authoritative candidate lookup, unknown inventory IDs, out-of-bounds candidate rejection, original/offered snapshots, required acceptance reason, accepted/declined customer response with source, stale revisions, and edit/reopen history.
- [x] Write integration tests proving work detail matching does not depend on `printEstimation.assets`, never appears in minimized lists/HA/Push, and fails independently while request detail remains usable. Run to confirm failure.
- [x] Implement proposals with opaque IDs and immutable offered/requested snapshots, inventory ID/revision, settings snapshot, per-requirement identity, actor/time, and explicit pending/accepted/declined/superseded states. Operator-recorded decisions distinguish on-behalf acceptance from recorded customer response. Keep history through replacement/reopening.
- [x] On requirement changes, supersede pending proposals. On inventory/settings changes, preserve old offers but reassess current stock; accepting stale work revisions is rejected. Candidate recommendation never counts as acceptance.
- [x] Compose `filamentMatching` into detail through an optional port in work service/runtime, with `{ available: false }` on failure and no raw errors. Reuse latest estimate only for defensible demand facts; total-only quantities remain unsplit.
- [x] Run proposal/service/privacy tests and existing work-management tests. Commit task files.

### Task 5: Operator API and recoverable approval email

**Interfaces:** extend `/api/operator-print` GET resources `filament`, `filament-settings`, `filament-matching`; POST actions `save-filament`, `save-filament-settings`, `preview-filament-matching`, `filament-command`, `preview-substitution-email`, `send-substitution-email`. Work-specific operations require authorized lookup of `workId`; request bodies have exact bounded fields.

- [x] Consult official email provider docs for idempotency header/retention and retry behavior before implementing the adapter.
- [x] Write API tests for owner-only stock/settings writes, operator work actions, origin/auth rejection, forged work/proposal references, stale revisions, invalid thresholds, preview without mutation, and bounded payloads. Confirm failing tests.
- [x] Write delivery contracts asserting provider URL/method/auth/idempotency headers, timeout, escaped message, server-derived customer recipient, and exclusion of cost/notes/model links/sensitive params. Include unconfigured provider, failures, timeouts, duplicate sends, and concurrent sends.
- [x] Implement server-generated preview `{ recipient, subject, text, proposalId, revision }`. Sending must refer to the persisted proposal revision and preview; do not accept caller-supplied recipients or arbitrary message bodies.
- [x] Persist a delivery claim before the provider call using compare-and-swap. Stable proposal/revision delivery keys prevent duplicate concurrent or retried sends within documented provider guarantees. Persist sent/failed/unconfigured/uncertain outcomes separately from approval. Never automatically resend an uncertain delivery outside the provider's idempotency window; return a reviewable recovery state and copyable message.
- [x] Preserve a pending, copyable proposal if delivery is absent or fails. A recorded decline stays actionable. Use a 10-second provider timeout and sanitized errors.
- [x] Wire production and loopback development composition; maintain current existing APIs. Run API/delivery contracts plus operator print tests. Commit task files.

### Task 6: Inventory, matching controls, and substitution UI

**Interfaces:** `renderFilamentInventory(data, { role, onSave, onSettingsPreview, onSettingsSave })`; `renderFilamentMatching(data, { onCommand, onPreviewEmail, onSendEmail })`; API-client methods mirror Task 5 resources/actions.

- [x] Load applicable UI skill. Add browser tests for an owner adding/editing/deactivating a stock lot, nullable hex, gram/cost inputs, stale edit recovery, non-owner read-only controls, settings preview and explicit save.
- [x] Add browser tests for single/multiple candidates, recommended selection, further bands, no match, unknown demand, manual requirements, accepted/declined status, required verbal reason, email preview/send/failure/copy, and response recording. Confirm failures before UI implementation.
- [x] Implement inventory entry point available even when no work is selected, backed only by authenticated APIs. Keep drafts in memory, never customer/proposal data in local/session storage or service-worker caches.
- [x] Implement labeled HSL/RGB mode and numeric controls with units, swatches, hard bounds, search bands, and preview. Preserve unsaved form drafts on recoverable errors; refresh/review conflicts explicitly.
- [x] Add work-pane stock alerts and per-requirement candidates with radio selection, details for further candidates, stock/distance explanations, requirement corrections, and proposal actions. Scope approval buttons to the selected persisted proposal/revision; disable duplicate submits and preserve server errors as safe actionable messages.
- [x] Show exact customer message before sending, delivery state, copyable fallback, operator acceptance reason/source, customer reply decision/source, and proposal history. Label swatches approximate and grams unreserved.
- [x] Integrate focused modules through operator controller/client, update shell/build/service-worker file lists, preserve themes/focus/motion. Run new browser tests and existing operator tests. Commit task files.

### Task 7: Full verification, documentation, and review

- [x] Update `docs/ARCHITECTURE.md`, `OPERATOR-INBOX.md`, `PRINT-ESTIMATION.md`, `DEPLOYMENT.md`, and `VERIFICATION.md` with migration order, default settings/units, proposal/email semantics, permissions, stock limitations, and provider recovery. Do not imply an unrun production migration or live email verification.
- [x] Regenerate required bundles and asset versions; do not modify generator network policy or sensitive-field behavior.
- [x] Run `npm test` and fix regressions. Run `npm run screenshots`; add inventory/matching/proposal captures to screenshot coverage and inspect `screenshots/preview-board.png` plus new focused captures at desktop/390px and themes.
- [x] Inspect diff for public/private boundaries and secret exposure; run `git diff --check`. Request a whole-change review and resolve findings with targeted tests.
- [x] Audit every approved spec requirement against actual source, passing tests, and rendered screens. Keep goal active if anything is incomplete. Commit final feature changes without unrelated untracked files; report deployment/migration needs accurately.
