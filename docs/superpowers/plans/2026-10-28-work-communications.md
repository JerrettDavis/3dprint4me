# Work communications implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deploy client email conversations, private model revisions and re-estimation in the operator queue.

**Architecture:** Separate work-conversation service/repository/provider adapters from HTTP and DOM. Reuse print session analysis with work-bound authorization, additive attachment operations and operator estimate snapshots.

**Tech Stack:** Existing JavaScript, PostgreSQL, local JSON adapters, private Blob/storage, Resend, Python Playwright.

**Spec:** ../specs/2026-10-28-work-communications-design.md

## Global constraints

Preserve AGENTS.md invariants. No customer data in public output, list/push payloads or browser storage. Do not send a message to the real client while testing. Provider errors are generic; existing notes and immutable estimates remain available.

## Review focus

- Lost responses and concurrent clicks: identical commands produce one message and at most one dispatch claim.
- Wrong-work uploads: a session authorized for A cannot attach to B.
- New revision after slicer completion: old profile results never become the current revision.
- Unconfigured providers: retained, copyable messages and clear storage errors.
- Navigation or expired auth during mutations: drafts/results cannot appear on another customer's sheet.

### Task 1: Conversation persistence and delivery

Files: `lib/work-communications/{service,repository,local-repository,runtime,operator-api}.js`, `neon/migrations/014_work_communications.sql`, message unit/contract/integration tests.

- [ ] Write failing tests for private comments, server-addressed emails, immutable idempotency replay, wrong-work access, claims, failures and retry expiry.
- [ ] Run focused tests and confirm the failures.
- [ ] Implement conversation list/create/retry with bounded plain text, per-work command identity, atomic claims, no network calls inside transactions and existing provider module.
- [ ] Mount `resource=communications` under operator-work and return conversation detail independently of other sections.
- [ ] Run focused tests, PostgreSQL migration and concurrent dispatch checks; commit.

### Task 2: Work-bound models and estimate revisions

Files: `lib/print-estimation/application/operator-models.js`, print repositories, operator print API, operator-view and associated tests.

- [ ] Test work-bound upload creation/attachment, multiple revisions, lost-response replay, malformed files, selected ZIP parts and updated assumptions.
- [ ] Implement authenticated upload/finish/re-estimate actions using existing analysis/session use cases; bind sessions to work server-side.
- [ ] Add atomic operator attachment operations in both adapters and latest-revision selection that preserves original history and current slicer results.
- [ ] Verify current material assumptions feed filament readiness without fabricated color mass.
- [ ] Run focused tests and commit.

### Task 3: Job sheet UI and browser journeys

Files: operator conversation/model modules, API client/controller, CSS, service worker, E2E tests and screenshot capture.

- [ ] Test composer/comment/email status/retry, file upload and revised estimate with both 390px and desktop layouts.
- [ ] Implement labeled composer with separate comment/email actions, explicit recipient and copy/retry controls, in-memory drafts, duplicate-submit prevention and auth/navigation guards.
- [ ] Implement private upload and existing-model re-estimation with print options and pack selection; link filament corrections.
- [ ] Version shell/assets; run focused browser coverage and inspect screenshots; commit.

### Task 4: Verify and release

- [ ] Update operator runbook, print contracts and deployment/migration instructions.
- [ ] Run npm test, native database checks, screenshots and inspect preview-board.png.
- [ ] Review full diff against spec, resolve defects and rerun affected checks.
- [ ] Merge tested changes to main, checkpoint/apply additive migration and deploy following repository runbooks.
- [ ] Verify deployed commit/assets, unauthenticated rejection and synthetic conversation/private-model/re-estimation journey. Record evidence and clean up synthetic data.
