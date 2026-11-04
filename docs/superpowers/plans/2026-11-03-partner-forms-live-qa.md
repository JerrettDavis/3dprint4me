# Representative Forms and Production Portal QA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver fifteen representative forms, isolated QA in the production portals, and complete BDD documentation with reproducible screenshots.

**Architecture:** Keep the existing partner domain commands and legal gates. Fixed QA routes select a dedicated database/runtime; a narrowly restricted adapter validates the real owner session while QA business transactions run only in the QA store. Existing browser journeys generate documented synthetic evidence.

**Tech Stack:** Node 22 ESM, PostgreSQL/pg, existing vanilla JavaScript portals, Python pytest/Playwright, Markdown/Gherkin and PNG evidence. No new public service or tracking dependency.

**Spec:** `docs/superpowers/specs/2026-11-03-partner-forms-live-qa-design.md` (approved November 3, 2026).

## Global Constraints

- Owner selected **test in the production portal**; retain existing origins and GitHub owner login.
- All canonical forms are `issuable:false` and `legallyApproved:false` with **REPRESENTATIVE STUB — DRAFT — UNREVIEWED — QA/DISCUSSION ONLY**.
- Workflow samples say **QA SAMPLE — NO LEGAL EFFECT — NOT FOR REAL SIGNING OR WORK**; simulated reviews never count as professional approval.
- Real program launch flags remain off. QA business connections cannot access production business data.
- Credentials, real contact data, government tax identifiers and active invitation/recovery codes never enter docs/screenshots.
- Preserve all AGENTS.md invariants, private intake, provider-unconfigured behavior, accessibility and 390-pixel layouts.
- Preserve unrelated pre-existing screenshot/UX-audit modifications; stage named task files only.

## Review Focus

1. Same-browser live/QA switching must never replay a draft or queued command into the other realm (Task 4).
2. Owner revocation during a QA mutation must serialize against the shared auth lock without deadlock or partial QA commit (Task 2).
3. Misconfigured QA credentials targeting the selected real database must fail before migrations or writes (Tasks 2 and 7).
4. A stale screenshot or passing mocked state must never appear as current native/hosted BDD evidence (Task 6).
5. Repeated seeding/reset/retry must preserve owner edits, frozen terms and live business records (Tasks 1, 3 and 5).

---

### Task 1: Complete the representative form packet

**Files:** Modify `contracts/partner/manifest.json`, its seven existing Markdown sources, `lib/partner-outreach/legal.js`, `tests/contract/partner-template-seed.contract.test.mjs`; create eight Markdown sources using the keys in the spec and `docs/partner-qa/forms/README.md` plus one catalog page per form.

**Interfaces:** Keep `legal.seed_templates` additive. Extend `minimumScopes(key)` for finance/accounting and outreach/privacy forms; use existing renderer types and global variable-schema limit of 80. Catalog records canonical source, purpose, fields, fictional filled example, unresolved decisions, reviewer scopes and actual supported operations; informational checklists do not claim automated enforcement.

- [ ] Add failing contract assertions for exactly 15 stable keys, disclaimer on every source, nonissuability, valid typed placeholders, accounting review on settlement/gift forms, repeat-seed zero creations and preserved owner edits.
- [ ] Run `node --test tests/contract/partner-template-seed.contract.test.mjs`; confirm new assertions fail.
- [ ] Write eight forms and catalog, preserve original clause IDs, correct gift variable, $200/$400 hard limits and December 31, 2026 cutoff, replace speculative bookkeeping with CPA decision fields. Add only needed typed fields; no real tax identifiers or invented professional decisions.
- [ ] Rerun the seed test and `node --test tests/unit/partner-legal-content.test.mjs tests/unit/partner-docx.test.mjs tests/contract/partner-legal.contract.test.mjs`; verify private exports and draft issuance denial.
- [ ] Commit only packet, catalog, scope and related test changes.

### Task 2: Isolate the QA runtime and real owner authorization

**Files:** Create `lib/partner-outreach/qa-runtime.js`, `qa-owner-auth.js`, `tests/contract/partner-qa-runtime.contract.test.mjs`; modify `runtime.js`, `application.js`, `owner-identity.js` only at dependency injection boundaries. Create `deploy/platform/provision-partner-qa.py` and identity/preflight checks.

**Interfaces:** `createPartnerQaRuntime({qaDatabase,ownerAuthDatabase,env,now})` returns the ordinary `{database,app,auth}` runtime shape plus fixed realm `qa`. `withQaOwnerAuthorization(actor, operation)` verifies the real owner and holds production auth row locks while awaiting `operation()` against the QA database. Inject an owner-authorized execution boundary, never `allowSyntheticOwner`. `assertQaIsolation({qaDatabase,ownerAuthDatabase,selectedProductionIdentity})` fails on absent sentinel, shared DB identity, excessive grants or configured real providers.

- [ ] Write failing tests for real-session-only owner access, session expiry/revocation, restricted auth grants, distinct database identities, no production business queries, disabled-provider environment and denied arbitrary runtime selection.
- [ ] Run `node --test tests/contract/partner-qa-runtime.contract.test.mjs`; observe failures.
- [ ] Implement fixed runtime wiring and auth-first/QA-second transaction order, bounded timeouts and rollback on either-store failure. Provision a fresh dedicated DB/role with normal migrations/RLS and an explicit QA identity sentinel; validate identity before any migration. Keep it outside the control-store selection and deny real business access to the auth role.
- [ ] Add native PostgreSQL concurrency cases to the same suite/support: revocation waits for an authorized in-flight command; subsequent commands deny; failed QA work rolls back and releases locks; no auth mutation occurs. Verify existing production auth/command tests still pass.
- [ ] Commit isolated runtime, provisioning and tests.

### Task 3: Add fixed QA HTTP routes and synthetic scenario lifecycle

**Files:** Modify `lib/partner-outreach/http.js`, `auth.js`, `scripts/platform-server.mjs`; create `qa-scenarios.js`, `tests/contract/partner-qa-http.contract.test.mjs` and `tests/contract/partner-qa-scenarios.contract.test.mjs`.

**Interfaces:** Parameterize `createPartnerHandlers` with a server-owned route/cookie/CSRF namespace. QA partner prefix `/api/partner-qa/v1`, owner endpoint `/api/operator-partner-qa`; real routes retain defaults. `provisionQaScenario({runtime,actor,scenarioKey,commandId})` and `resetQaScenario(...)` accept fixed scenario keys and audited owner commands only. Return scenario/run identifiers, synthetic record IDs and transient private enrollment results; do not log codes. Persist run history in QA, with reset scoped to its scenario.

- [ ] Add failing tests: live cookies/CSRF fail on QA and vice versa, foreign origin denied, anonymous provisioning/reset denied, missing QA config returns safe unavailable, caller DB/mode parameters rejected, and real routes remain unchanged.
- [ ] Run the two new suites and observe intended failures.
- [ ] Wire exact direct API paths and realm cookie names; keep secure host cookies, rate limits, no-store and sanitized errors. Provision repeatable sample programs/partners through domain transitions; create separately hashed workflow samples and explicit simulated review evidence solely in QA. Keep canonical discussion drafts unissuable.
- [ ] Verify retries produce one scenario, reset never touches live data, synthetic settlement cannot become real verification, and all outbound provider operations fail closed or return sanitized simulation receipts. Test with an outbound-request observer rather than fictional recipients alone.
- [ ] Run new suites plus `tests/contract/partner-http.contract.test.mjs` and auth/approval tests; commit.

### Task 4: Expose QA in the existing portals

**Files:** Modify `operator/partners.html`, `operator/assets/partner-owner*.js`, `operator/assets/partner-owner.css`, `operator/sw.js`, `operator/vercel.json`; modify `partner/public/index.html`, `assets/client.js`, `assets/partner.js`, `assets/drafts.js`, `assets/offline-workspace.js`, `assets/pwa.js`, `assets/partner.css`, `sw.js` and `partner/vercel.json`. Add `tests/unit/partner-qa-client.test.mjs` and `tests/e2e/test_partner_qa_ui.py`.

**Interfaces:** Owner QA page `/partners/qa`; partner QA page `/qa`. Mode is selected by exact path and immutable client configuration, not a free-form database selector. QA API clients use Task 3 namespaces. Draft keys, IndexedDB databases, service-worker caches, queued command records and session state include realm and account identity. Downloads/exports and simulation receipts include QA labels.

- [ ] Add failing tests for persistent QA banner/return link, explicit owner provisioning/reset, partner enrollment, mode-specific requests and storage, cold reopen/offline replay, mode switches, sign-out and live UI regression.
- [ ] Run targeted unit/UI tests; confirm failures.
- [ ] Implement minimal controls in existing visual system with keyboard focus, light/dark/system theme, reduced motion and 390-pixel layout. Preserve existing owner login; never cache private responses or QA credentials.
- [ ] Test wrong-realm queued commands, stale service-worker caches and two-tab live/QA use; deny rather than silently redirect a mutation.
- [ ] Run targeted tests, `npm run assets:version`, `npm run screenshots`; inspect `screenshots/preview-board.png` and QA state captures. Commit only intended UI/assets and tests.

### Task 5: Document every BDD journey and fill coverage gaps

**Files:** Create `docs/partner-qa/README.md`, `docs/partner-qa/features/*.feature`, `docs/partner-qa/scenarios.json`, `tests/integration/test_partner_qa_browser.py`; extend existing `test_partner_*_browser.py`, `tests/support/partner_budget.py`, `tests/support/partner-native-server.mjs` only as necessary.

**Interfaces:** `scenarios.json` maps stable scenario/step IDs to descriptions, actor, prerequisites, synthetic input, Gherkin file/line-independent scenario name, pytest node IDs, expected persisted effects, retries, cleanup and evidence references. Every one of the existing 59 native cases has a mapping; do not inflate coverage by treating a screenshot or mock as a test.

- [ ] Add a failing mapping validator asserting all existing native test node IDs are represented exactly and no references name nonexistent tests/scenarios.
- [ ] Write the ten feature areas in the approved spec, including offline/cold reopen, lost committed responses, explicit replay, legal version conflicts, denial paths, optional activity, immutable statements, original bonus promise and materials.
- [ ] Identify requirements with no meaningful native coverage; write failing native tests before implementation fixes. Extend the loopback-only disposable harness for separate QA/auth stores without weakening its host checks.
- [ ] Run `npm run test:partner:browser` plus the new QA suite; record actual passed/failed/blocked status, not assumed results. Verify state via API/PG assertions alongside browser transitions.
- [ ] Commit mapped features, coverage and guide.

### Task 6: Generate reproducible screenshot evidence inside docs

**Files:** Create `tests/support/partner_qa_evidence.py`, `scripts/validate-partner-qa-evidence.mjs`, `tests/unit/partner-qa-evidence.test.mjs`, `docs/partner-qa/screenshots/`, `docs/partner-qa/evidence/`; integrate Task 5 scenario steps and `package.json` validation script.

**Interfaces:** `capture_partner_qa_step(page, *, scenario_id, step_id, theme, viewport, run)` captures only the documented current state after masking sensitive controls. A run manifest stores source commit, run ID, environment, scenario/step, observed result, relative PNG path and checksum. Validator distinguishes `mock`, `native` and `hosted` evidence and verifies images, mappings and source/run metadata.

- [ ] Write failing validator tests for missing image, wrong checksum, obsolete source/run, unknown step, fabricated pass, unsafe path and secret/cookie/invitation markers in metadata.
- [ ] Implement capture helper and validator. Include desktop light and 390-pixel dark captures for documented UI states, with focus/error/denied/retry/success transitions where applicable. Nonvisual steps link persisted-state evidence instead of unrelated screenshots.
- [ ] Run native journeys with evidence enabled; inspect representative images and every newly introduced layout, mask codes before pixels are captured, link each image next to its step description.
- [ ] Validate documentation and images; regenerate after source changes. Keep hosted observations separate from automated fixture evidence and explicitly mark manual/not-run items.
- [ ] Commit evidence tooling, images, metadata and updated docs together.

### Task 7: Prepare and verify production-portal QA deployment

**Files:** Modify `deploy/platform/compose.yml`, `api.env.example`, `partner-release-host.py`, `partner-rollout-host.py`, `release-partner.py`, migration/archive registries and matching release tests as required; update `docs/PARTNER-DEPLOYMENT.md`, `docs/CONTRACTOR-RELEASE-READINESS.md` and QA guide.

**Interfaces:** Provisioner from Task 2 runs a preflight-only phase before apply; release tooling verifies fresh backup, immutable release image, QA/auth role grants, DB sentinels, real feature flags still off, exact route registrations and existing service continuity. No new public DNS/OAuth resources. Credentials remain private configuration.

- [ ] Add failing deployment tests for overlapping selected DB, provider credentials, absent QA store, excessive auth privileges, misrouted QA commands and QA jobs using real runtime.
- [ ] Implement private configuration and exact archive/image inclusion. Run a disposable two-store deployment rehearsal including API/jobs, owner-session revocation, QA provisioning/reset, route isolation and live storefront/intake continuity.
- [ ] Prepare the exact reviewed commit/image, backup and rollback steps; verify no unrelated service/container replacement. Keep real production programs/accounts/reviews unchanged.
- [ ] After Task 8 review passes, deploy the authorized QA feature to the existing portals. Verify HTTPS/CORS/secure cookies, actual owner login, synthetic partner enrollment and representative lifecycle; record aggregate before/after live business counts and launch flags without personal data.
- [ ] Save redacted hosted evidence and clearly document access, reset, provider simulation and parallel real-form review. Commit deployment evidence.

### Task 8: Whole-change verification and review

**Files:** Update plan checkboxes and readiness/evidence docs; no unrelated changes.

- [ ] Run `npm test`, `npm run test:partner:postgres`, complete native browser suite including QA, QA evidence validator, and deployment/isolation rehearsal. Confirm exact command exit results; fix causes before repeating only relevant failed checks.
- [ ] Run `npm run screenshots`; inspect preview board and actual docs screenshots. If DOCX rendering changes, render and inspect generated pages with the document workflow.
- [ ] Request a fresh independent whole-branch code review (requesting-code-review skill), emphasizing cross-realm writes, auth locking, canonical draft guard, exports/provider leakage and evidence integrity. Resolve material findings and rerun affected checks.
- [ ] Execute Task 7 hosted deployment checks, then report exact shipped behavior, test evidence and remaining actual professional approvals. Never report contractor legal readiness from simulated QA results.

## Self-review

Packet, professional-review boundary, production portal selection, auth/data isolation,
complete BDD coverage, screenshots, private exports, provider failure behavior and
hosted verification each have an owning task. The five review-focus risks are pinned
to tests above. Task 7 prepares deployment before Task 8; deployment itself occurs
only after Task 8's automated checks and independent review. Existing native execution
is the recommended method because the runtime, routes and evidence share interfaces.
