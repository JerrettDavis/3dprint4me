# Inquiry Work and Project Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make the inquiry/project distinction clear, put received inquiries in the work inbox, and support customer continuation plus operator conversion without duplicate work or fabricated consent.

**Architecture:** Extend existing work items with a typed inquiry source; preserve one work identity through conversion. Existing API functions host narrowly scoped handoff/conversion endpoints. Private native PostgreSQL transactions enforce capability ownership, one canonical project draft and replay-safe completion.

**Tech Stack:** Existing Node22 ES modules, pg/PGlite contracts, PostgreSQL18, static browser JavaScript, existing Blob and Playwright harnesses. No additional services, packages or paid tier.

**Spec:** docs/superpowers/specs/2026-10-21-inquiry-workflow-design.md

## Global constraints

- Only public/ is storefront output; never publish secrets, operator notes or private file URLs.
- Four full-request service paths and customer-recoverable unconfigured mode remain intact.
- Customer invitations expire after seven days; hashes only at rest, fragment transport, JSON-only redemption, no token persistence/logging.
- Request IDs/email are not authority for handoff-bound drafts; expiry/revocation gates uploads and completion too.
- One work item and one canonical project per inquiry; preserve source/history/attachments and idempotency under races.
- Operator conversion creates an explicitly incomplete project draft when required details are absent; no invented consent/estimate.
- All replies/sharing and invoice dispatch remain manual. No customer email, payment or invoice side effects from conversion/backfill.
- Native database only for deployment, no polling or schema changes on fenced Neon.
- Existing linked worktree, inline backend integration with two independently owned UI workstreams and one whole-branch review; standing roll-through authorization persists.

## Review focus

- Revoked/expired links must fail even if the caller already knows a bound draft ID or omits the handoff field.
- An inquiry submitted during rollout or replayed after notification failure must have exactly one inbox item.
- Concurrent customer submission and operator conversion must retain one work item, notes and project identity.
- Inquiry attachments cannot be imported by guessing paths, and customer links cannot read operator notes or unrelated files.
- Incomplete/operator-assisted data cannot appear as customer consent, a final quote, or a completed public submission.

### Task 1: Typed inquiry work and schema contracts

**Files:** neon/migrations/009_inquiry_workflow.sql; tests/contract/inquiry-workflow.contract.test.mjs; tests/contract/inquiry-database.contract.test.mjs; shared test migration setup as required.

- [x] Write failing PostgreSQL/PGlite tests: nullable request/event relationships with kind/source constraints, unique inquiry work, immutable association, submitted-only idempotent backfill, and scoped backend/RLS permissions.
- [x] Run targeted contracts and verify expected missing-migration/constraint failure.
- [x] Add additive kind/inquiry source columns and bounded private handoff table, indexes and explicit privileges. Keep existing request defaults/constraints compatible.
- [x] Provide a bounded, idempotent submitted-inquiry backfill that preserves timestamps/history and does not resend email/push. Rerunnable after deployment.
- [x] Run green contracts and commit.

### Task 2: Atomic acceptance and inquiry-aware work repositories

**Files:** lib/inquiry-store.js; lib/quick-inquiry/{runtime,complete-inquiry}.js; lib/work-management/{work-policy,service,home-assistant-snapshot}.js; adapters/{neon-work-repository,local-work-repository}.js; lib/operator-files.js; relevant work/inquiry/file/HA tests.

- [x] Write red tests for complete/replay/repair atomicity and submitted timestamps; inquiry list/default filters/kind filters/detail/notes/waiting/close; reject project-only states.
- [x] Add inquiry completion + work/event/outbox as one atomic database operation. Already-submitted replay repairs a missing item exactly once.
- [x] Adapt queries to typed sources and preserve existing full-request response contracts where possible. Use kind-aware transition policy in native/local adapters and UI helpers.
- [x] Extend generic event/push/HA handling with neutral inquiry presentation; keep customer details out of push and HA inquiry titles.
- [x] Authorize inquiry/inherited files only through the exact work source and stored file membership; retain path traversal and unrelated-file denial.
- [x] Run focused contracts/unit tests and commit.

### Task 3: Scoped handoff and operator-prepared projects

**Files:** lib/inquiry-workflow/{domain,repository,local-repository,service,runtime,operator-api,public-api}.js; lib/database.js; api/inquiry.js; api/operator-work.js; tests/unit/inquiry-workflow.test.mjs; transaction and SQL contracts.

**Interfaces:** issueHandoff(owner inquiry key or authorized operator), readHandoff(rawToken), prepareProject(operator, workId, revision, service, title), createBoundDraft(rawToken, normalizedRequest), completeBoundDraft(rawToken, draftId, normalizedRequest, newFiles, attachment).

- [x] Write red tests for fixed actions/methods, exact owner scope, hash-only storage, expiry/revocation, no read access by ID/email, output projection and safe errors.
- [x] Add native callback transactions on a checked-out client with rollback/release and preserved safe domain errors; legacy HTTP provider fails closed for unsupported new transactional actions. Test transaction shape/failures.
- [x] Implement canonical draft binding and conversion under row locks/unique constraints; preserve work ID/history and reject stale revisions/terminal source states.
- [x] Implement seven-day scoped invites, regeneration, submission-key issuance and native/local ports with bounded records. Never log raw capability values.
- [x] Expose operator actions behind existing session/origin/owner authorization and public actions through the existing inquiry function; no additional Vercel functions.
- [x] Prove concurrent conversion/draft creation, expiry, rollback and response-loss replay with native SQL contracts; commit.

### Task 4: Full-request continuation with strict attachment authority

**Files:** lib/project-request/{create-project-request,complete-project-request,runtime}.js; lib/upload-authorization/* or existing upload handler; lib/work-management/adapters/neon-work-repository.js; public/assets/js/order/{inquiry-handoff,client,controller,model,validation,files}.js; public/assets/js/order.js; public/order.html; request/upload/browser tests.

- [x] Write red tests for all four services from an inquiry, missing service/terms/details, inherited attachment membership/head verification, arbitrary-path denial and omitted-token bypass.
- [x] Route handoff-bound create/complete/upload through the workflow service; reject bypass even when a known bound ID is used via ordinary endpoints. Ordinary unrelated full requests retain existing behavior.
- [x] Merge only trusted server-side inherited files, separately from newly normalized request uploads. Preserve estimate ownership rules and generator-sensitive-field constraints.
- [x] Add fragment capture/clearing and in-memory token transport, safe prefill/review, attachment display and expiry/recovery states. Never serialize the capability into local drafts or receipts.
- [x] Consume completion atomically, reuse an operator-prepared draft and retain the same work item. Replays recover the original receipt without creating a second project or replaying notifications.
- [x] Run request/upload/checkout/customizer regressions plus focused browser tests and commit.

### Task 5: Operator inquiry detail and conversion UI

**Files:** operator/assets/{operator,api-client,work-state,inquiry-detail}.js; operator/index.html; operator/assets/operator.css; operator/service-worker.js; operator unit/E2E tests.

- [x] Write red UI tests for default inquiry visibility, kind filters, needs-response labels, message/contact/attachments, note preservation and follow-up controls.
- [x] Add inquiry-specific rendering and manual response affordances; suppress inappropriate print/invoice/project status controls while kind=inquiry.
- [x] Add copy-private-link and explicit service/title conversion form, stale-revision handling, incomplete-draft badges/missing-field explanations, and source inquiry history after conversion.
- [x] Bump shell cache and test installed-client upgrade, 390px, dark/light/system themes, keyboard/focus and reduced motion.
- [x] Run focused operator tests/screenshots and commit.

### Task 6: Clear customer entry and inquiry continuation

**Files:** public/index.html; public/assets/evolution/{app,inquiry-core,inquiry-client,evolution.css}; public/order.html; tests/e2e/test_inquiry.py; inquiry client/model tests.

- [x] Write red tests for visible Ask a question versus Start a project request explanations and received/unconfirmed continuation paths.
- [x] Update entry/success copy and CTAs in the existing visual system. Live continuation uses the original capability; offline/recovered copies may prefill text but cannot claim private receipt or forge a source association.
- [x] Preserve all inquiry upload/receipt/recovery behavior and no binding estimate/order/payment claims.
- [x] Run version-assets, validate and focused browser tests; inspect changed screens and commit.

### Task 7: Whole-change verification, documented rollout and production proof

**Files:** docs/QUICK-INQUIRY.md; docs/ARCHITECTURE.md; deployment/recovery runbooks; deploy/platform inquiry backfill/rolling deployment helpers; private execution ledger.

- [x] Document models, manual communications, capability expiry/revocation/recovery, native migration/backfill and privacy deletion responsibilities.
- [x] Run full npm test, screenshots and visual inspection; secret scans; independent whole-branch code review. Fix Important/Critical findings with regressions.
- [x] Rehearse migration/conversion/rollback and API overlap deployment against scratch PostgreSQL18 with no customer messages; preserve native least privileges.
- [ ] Apply additive schema to selected live database only; deploy reviewed API with overlap and unchanged database writer; deploy static apps; rerun bounded backfill.
- [ ] Verify today's existing inquiry appears as Needs response, old full requests remain accessible, private files stay protected, and no customer email/invoice was sent by rollout. Verify fresh backup/isolated restore.
- [ ] Merge/deploy main, record actual evidence and remaining limitations, and complete handover without enabling paid services.
