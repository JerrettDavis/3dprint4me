# Partner materials implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. Existing worktree: `G:/git/3dprint4me-partner-portal`. Do not start runtime edits while the legal verification sequence is live.

**Goal:** Fulfill packet O-08 by letting the owner record/review supplied and returned materials and letting a partner inspect their own gig's material records.

**Architecture:** Keep `material.record` and its gig lock, validation, immutable event and command receipt. The existing `gig` read already returns `materials`; render that data in each workspace. Keep events separate from visit placement counts, gifts, work completion and financial obligations. Use a focused owner rendering module rather than expanding the large route module.

**Tech stack:** Existing JavaScript modules, native PostgreSQL, Node contract tests and Playwright.

**Spec:** Private packet requirements O-08/B-12; current `lib/partner-outreach/work.js` material command and `lib/partner-outreach/application.js` gig resource. No private packet text or customer records enter Git.

## Constraints and review focus

- Owner-only recording; partner can read only their own gig. No new role grants or migration.
- Supplied materials are optional context, never an automatic wage deduction, deposit or gift repayment.
- Existing forms retain their command key and freeze inputs through uncertain retries.
- Server permits issuance only for accepted/changes-requested work; returns cannot exceed recorded supply. UI must not promise broader permission.
- Labels render as inert text; counts are positive integers; duplicates remain server-rejected.
- Current material query returns the first 200 events. Resolve that incomplete-history behavior explicitly before presenting totals. Prefer bounded newest-history with an explicit limit and no inferred complete balance; preserve complete personal export separately. Do not silently call a partial history complete.

## Task 1: Native recording and private history

- [ ] Add failing contract/native browser assertions for owner issue/return, partner record denial, other-partner read denial, excessive return rollback, same-key replay and unchanged payable/budget values.
- [ ] Resolve bounded history semantics in `lib/partner-outreach/application.js`; test more than 200 events and clear response/view limit messaging. Keep authorization before reading events.
- [ ] Add `operator/assets/partner-owner-materials.js`; mount it from gig detail with existing bind/escape helpers. Add repeatable label/count rows (up to 50), action choice and current-gig scope. Show immutable event history with explicit incomplete-history notice when applicable.
- [ ] Update `partner/public/assets/partner.js` to show its own material events without recording controls. Reuse visual tokens and inert text.
- [ ] Verify focused tests, including lost committed response replay with one persisted event and unchanged compensation.

## Task 2: Accessible release and verification

- [ ] Add 390-dark/320-light fixtures for event history, owner entry and failure/retry. Preserve focus, reduced motion, route-generation guards and sign-out clearing.
- [ ] Bump owner/partner worker releases for changed cached modules and update installed-worker tests.
- [ ] Run npm test, native PostgreSQL and maintained native browser checks; run npm run screenshots and inspect full new states plus exact preview-board rows.
- [ ] Update portal/verification/acceptance docs; review; build and verify exact static/image outputs. Commit only after evidence agrees.
- [ ] Refresh dedicated protected partner Preview only after source passes. Production deployment and activation remain governed by the broader release gates.
