# Contractor release readiness — 2026-11-02

Assessment in progress. Contractor release is **not yet confirmed**. Keep enrollment
and new work disabled until the outstanding evidence below is established.

The owner confirmed on November 2 that actual attorney/CPA approvals have **not**
been obtained. This is an established launch blocker, independent of test results.

## Scope and source

Review partner enrollment/recovery, session separation and revocation, agreements,
voluntary gigs, budget ceilings, consent and referrals, offline retries, materials,
statements/payments, legal review, and corresponding owner administration. Existing
storefront and work-inbox regressions remain part of acceptance.

The starting workspace `<repo-root>/dprint4me` is on older commit `551df3e` and lacks the
portal. Verification runs against the newer existing worktree
`<repo-root>/dprint4me-pumpkin-printability`, commit `b579c11`. Uncommitted screenshots
and UX reports already present there are not treated as fresh acceptance evidence.
Read-only production fingerprints below now connect the tested source to deployed
application files; this does not establish actual contractor activation.

## Fresh evidence

The full-suite results below cover the pre-correction `b579c11` baseline. A later
read-only production audit found a weekly-statement RLS gap; its local correction
and follow-up verification are described below. Do not treat the baseline counts
as proof that the uncommitted correction is fully verified or deployed.

- `npm run test:partner:postgres`: **2 passed**, zero failures/skips. This exercises
  native PostgreSQL permissions, concurrent ceilings, command replay, additive
  restore, disabled HTTP behavior, and detection of privilege drift.
- Full `npm test`: **passed**, including build/asset validation, **1,260
  unit/contract tests**, **383 browser tests**, one platform-specific skip, and
  **241/241 UX checks**. Browser phase took 698.07 seconds.
- `npm run test:partner:browser`: **59 passed** in 583.93 seconds. This explicitly
  selects the maintained native modules; generic directory collection did not
  select these tests. Browser flows exercise the real API and disposable native
  PostgreSQL, including owner-issued recovery, revocation, concurrent budgets,
  offline replay, consent, accounting, legal versions and owner controls.
- Read-only live HTTPS probes: partner `/` and owner `/partners` return 200,
  restrictive CSP, `no-store`, and `nosniff`. Public partner status returns
  invitation-required messaging. Anonymous partner session and owner session
  endpoints return 401 with generic application messages.
- Inspected existing partner visit-entry screenshot and partner/admin regions of
  `screenshots/preview-board.png` (light/dark visits, drafts, counteroffers, finance
  and readiness notices). This is historical visual evidence, not a fresh capture
  or proof of every responsive/keyboard state.

Completed run logs are in the local temporary directory:
`3dprint4me-contractor-native-browser.log`,
`3dprint4me-contractor-release-npm-test.log`, and
`3dprint4me-contractor-postgres.log`.

## Current production observations

- The existing owner session was recognized in Edge. The real work-inbox Partners
  link opened authenticated administration. An initial access-required/transient
  loading state resolved without credential changes or a new OAuth grant.
- The live clearance banner says **No partner program configured**. Programs,
  campaigns, gigs and accounts are empty. Legal has no templates; issued agreements,
  statements and audit history are empty. Finance shows zero obligations/settlements
  and no payables or accounting batches. Leads/referrals and forecasts show their
  appropriate empty states. No console warnings/errors were captured after navigation.
  These are authenticated read checks; populated production writes are not proven.
- Current public status reports storefront, work inbox, API and project requests
  operational, with private uploads, print estimates and request receipts **unknown**.
  Unknown is not a verified provider success or an established outage.
- The existing `3dprint4me-encrypted-backup` scheduled task last completed at
  21:24:35 CST November 2 with result 0. This proves task completion, not a current
  restore drill, independent key custody or replacement-host readiness.
- All **15 partner static files** and **37 owner static files** match committed
  `b579c11` bytes. All **176 checked API/backend/partner-contract/package/server/job
  source files** in the running API container also match that commit. Migration
  source files are deliberately absent from the runtime image per its Dockerfile;
  this fingerprint does not independently inspect applied database migration state.
- Read-only pinned-host inspection reports API, PostgreSQL and slicer healthy.
  Jobs and tunnel are running. All three partner switches in the API are `0`.
  Running containers are not by themselves proof of successful operational jobs.
- Inspected live 390-pixel system-dark partner sign-in and authenticated owner
  Programs renders. Both report a 375-pixel document width inside the 390-pixel
  viewport, without document overflow. Owner section navigation scrolls within its
  own region. Populated live partner screens and live light-theme states remain
  separate from these entry-screen checks and the synthetic browser coverage.

## Operational follow-up and discovered schema gap

Read-only queries ran inside a read-only transaction against the durable selected
native database; no production records or settings were changed.

- Push, expiry, cleanup, slicer and weekly-statement health records are fresh and
  `ok`. The partner outbox has zero records; own-data exports have zero payloads
  and zero expired/unpurged payloads. These idle states do not establish populated
  production delivery or cleanup.
- The shared notification outbox has **three failed `new_work` records**, created
  between October 3 and October 26. These require operator review. They were not
  replayed, deleted or marked successful. The shared job-health policy treats
  failed notification rows as unhealthy even when worker heartbeats are fresh.
  Follow-up aggregate reads find zero delivery records and no error category for
  all three; there are zero configured push subscriptions. This is consistent
  with the worker's no-recipient failure path, not evidence of provider rejection.
  Do not silently relabel or replay these historical failures. The owner inbox
  remains the verified manual review path; push delivery is unconfigured/unproven.
- Of 41 partner tables, **40 enable RLS**. `partner_weekly_statements` is the
  exception: migration 013 revokes public access and enforces immutable evidence,
  but omits RLS, and the release verifier explicitly exempted it. Existing API
  role/partner checks and anonymous denial remain verified; this finding alone
  is not evidence of a public disclosure.
- Added local migration `016_partner_statement_rls.sql`, preserving migration 013
  and matching the existing backend-role RLS policy. Native-only target checks,
  release archive/rollout wiring and fixtures include it. The verifier no longer
  exempts statements. Production still needs the correction through a reviewed,
  checkpointed disabled rollout.
- Observed native regression failures for missing statement RLS and the verifier
  exemption, then passed **six focused native/contract checks**. They exercise all
  partner RLS, accidental visitor SELECT denial, retained backend access, statement
  generation, immutable records, restore, native-only targeting and drift detection.
  The updated **59-case native browser run passed** in 701.88 seconds; evidence is
  in local temporary log `3dprint4me-statement-rls-browser.log`. Focused evidence is in
  `3dprint4me-statement-rls-native.log`. Independent read-only review found no
  actionable issues in the scoped migration, target guard, archive/rollout wiring,
  verifier and regression checks. That review did not run the full suites.
  The concurrent full run stopped after one archive-test timeout (1,260 of 1,261
  unit/contract checks passed); the separate release run hit the same 120-second
  child limit. Running its Python archive checks alone subsequently passed all
  25 checks in 80.368 seconds. Preserve the timeout and rerun `npm test` without
  overlapping extra suites after the current native browser process completes.
  The subsequent standalone `npm test` **passed**: all **1,261 unit/contract
  tests**, **383 browser tests** (one platform-specific skip), and **241/241 UX
  checks**. Unit/contract time was 151.99 seconds; browser time was 696.06 seconds.
  Its output is `3dprint4me-statement-rls-standalone-npm-test.log`. No timeout was
  increased. Two final test-only assertions additionally exercise migration 016
  against populated legacy statements, repeat application and selected-database
  RLS after guarded rollout; their read-only independent review found no issues.
  The extended native upgrade/restore and schema rehearsal checks passed. Both
  API and slicer images built from Linux-extracted candidate source and passed
  non-root runtime imports. The isolated guarded rollout passed **205 continuity
  probes with zero failures**, selected-database-only migration including statement
  RLS, existing intake preservation, fresh statement-worker evidence and unchanged
  synthetic slicer/tunnel identities. Disposable resources were removed. This
  exercised no production rollout or real checkpoint creation. Logs:
  `3dprint4me-statement-rls-upgrade.log`, `3dprint4me-statement-rls-images.log`, and
  `3dprint4me-statement-rls-rollout.log` in the local temporary directory.

## Current checkpoint recovery proof

The scheduled complete checkpoint from 22:24 CST November 2 was 1,646 seconds old
when selected by exact snapshot identity for the drill. The trusted controller
verified its private configuration ACLs and pinned Restic executable. Both existing
encrypted stores returned database/configuration archives matching the receipt
hash. One identical copy restored into a newly named PostgreSQL 18 container with
network `none`, no published ports and memory-only restore storage. The restored
databases contained 25 and 71 public tables; 14 archive/configuration member hashes
were verified. Runtime DDL, operator-role modification and identity-binding deletion
were denied. The disposable restore container was removed, and production platform
service identities were identical before and after the drill.

Both stores' separate object streams independently verified **four objects** and
their whole-stream receipt hash. No plaintext file or provider object was written.
Logs remain outside Git as `3dprint4me-contractor-live-restore.log` and
`3dprint4me-contractor-live-object-verify.log`. Exact snapshot/configuration/key
references remain private. This establishes current database recovery and object
integrity; it does not establish replacement-host routing, private-object writes to
a replacement provider, signed-out reboot survival, offsite/key custody, or RPO/RTO.

## Evidence required before contractor onboarding

1. Corrected native browser and full regression checks passed. Complete current production
   desktop/mobile, light/dark and keyboard/error/retry acceptance; existing inspected
   screenshots and synthetic test flows do not establish all live states.
2. Application-source fingerprints and authenticated same-site owner reads now
   pass. Confirm production partner enrollment and populated workflows with an
   authorized acceptance account after the real program/review prerequisites.
   There is currently no production program, account or legal template to use.
3. Obtain actual attorney/CPA decisions for the exact published agreement and
   operating-policy versions. Synthetic fixture approvals do not satisfy this.
   Confirm all required persisted scopes, currency of reviews, program dates,
   environment gates and explicit owner activation through the real readiness UI.
4. Job heartbeats, empty partner outbox/export state, current two-store archive
   readback, isolated database restore and object integrity now have fresh evidence.
   Resolve/review historical notification failures and establish remaining host,
   provider, monitoring and custody/recovery requirements before launch acceptance.
5. Verify the actual bookkeeping/payment procedure and account-specific accounting
   import where used. CSV classification is `review_required`; fixture settlement
   and export tests do not establish provider payment or tax-reporting acceptance.

The gate implementation is `lib/partner-outreach/approvals.js`: current published
agreement/policy, recorded professional reviews, three environment switches and
owner activation are independent requirements. `policy.js` also limits new
authorization to December 31, 2026 in America/Chicago. Existing obligations must
remain accessible after pause/sunset.

## Historical evidence

Use [scenario coverage](PARTNER-ACCEPTANCE-GAPS.md),
[traceability](PARTNER-PORTAL-TRACEABILITY.md),
[production rollout](PARTNER-PRODUCTION-RELEASE.md), and
[UI deployment](PARTNER-UI-POLISH.md) as historical evidence. Several older status
paragraphs describe pre-deployment checkpoints; they do not override later rollout
records or substitute for current verification.

No production flags, invitations, approvals, payment records or provider settings
were changed by this assessment.

## Preparing the professional review

Use the owner legal workspace to save the intended agreement and operating-policy
versions, then prepare a scoped signed package for counsel and the accountant.
Follow [the private handoff procedure](PARTNER-REVIEW-HANDOFF.md): inspect/redact
the package, encrypt it locally, and deliver its passphrase and trusted signing-key
fingerprint separately. Obtain decisions covering classification, agreement
language, solicitation policy, and accounting for those exact versions. Returned
comments alone are not approval. Record the verified decisions, resolve conditions,
publish the reviewed versions and bind them to the intended program before checking
readiness again. Do not use synthetic fixture reviews or toggle switches to bypass
the missing approvals.
