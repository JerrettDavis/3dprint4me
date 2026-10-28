# Scheduled weekly payable statements implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, task by task.

**Goal:** Implement packet O-10: the owner can schedule durable weekly payable
statements that each partner can retrieve privately, without sending payments or mail.

**Architecture:** Store opt-in scheduling in program settings and immutable typed
statement snapshots in native PostgreSQL. The existing writer job creates at most
one snapshot per partner/Central Monday, with actual generation time rather than
pretending delayed processing happened earlier. Owner and partner reads reuse the
existing session, origin, CSRF and generation guards.

**Tech stack:** Node ES modules, native PostgreSQL, existing static owner/partner PWAs.

**Spec:** Private packet docs/02-REQUIREMENTS.md O-10 and accounting/
INVOICE-NINJA-AND-LEDGER.md; repository docs/PARTNER-PORTAL.md and AGENTS invariants.

## Global constraints

- Customer uploads and statement records remain private; only static assets are cached.
- Integer-cent payables/adjustments/verified settlements remain independent evidence.
- Gifts, bank references, customer contacts and credentials are absent from snapshots.
- Programs remain opt-in. Disabling new work does not erase debts or existing statements.
- No automatic email, marketing, payment, tax form or professional approval.
- Schedules use America/Chicago Monday dates, including DST transitions.

## Review focus

- Restart, duplicate workers and lost responses create one snapshot and audit event.
- Delayed processing reports actual as-of time; no invented historic balances/backfill.
- Account -> program locks preserve writer order and serialize balance reads.
- Unconfigured schema/jobs and disabled schedules produce no snapshots or network calls.
- Another partner cannot list/download a statement; expiry clears private UI.

### Task 1: Durable private statement model and generation

Files: create neon/migrations/013_partner_weekly_statements.sql and
lib/partner-outreach/statements.js; update scripts/migrate-neon.mjs,
tests/support/partner-fixture.mjs and lib/partner-outreach/application.js.
Tests: tests/contract/partner-statements.contract.test.mjs,
tests/unit/partner-statements.test.mjs and native PostgreSQL integration.

Interfaces:
- statement.schedule owner command: {programId,expectedRevision,enabled:boolean}.
  Preserve other settings. Enable effective next Central Monday; identical enabled
  state preserves existing first-due week. Disable stops future generation only.
- readStatements(tx,actor,input): metadata list scoped by partner or owner program;
  input.id retrieves exact private snapshot CSV after SHA-256 verification.
- generateWeeklyStatements({database,now,batchSize=20}): bounded eligible candidates,
  each processed in an independent transaction with account then program lock.
  Recheck schedule under lock. Unique(partner_id,week_start_local) ensures retries.
- Snapshot header: record_id,work_order_id,amount_due_cents,paid_cents,
  outstanding_cents,currency,status. Balance snapshot includes all recorded payables,
  not only newly earned ones. Metadata labels weekStart, generatedAt, asOf, sha256.

- [x] RED tests: next Monday/DST; no retroactive week invention; zero/partial/reversed
  payments; adjustment; duplicate/restart; scope; exact bytes; no contacts/references.
- [x] Add repeatable native-only migration: UUID PK, composite account/program FK,
  unique partner/week, Monday DATE check, JSON snapshot, SHA-256, generated timestamp.
  PUBLIC denied; backend SELECT/INSERT only; evidence update/delete trigger denies.
- [x] Implement command/read/generator using readPayables and escaped CSV cells.
  Eligible recipients are enrolled accounts or accounts with payables, including
  suspended/revoked accounts for owner retrieval. No new invitations are generated.
  Bound read volume; fail rather than silently omit financial rows.
- [x] Verify PGlite contracts and native role immutability/concurrent generation.
- [ ] Commit model, migration and tests with recorded focused evidence.

### Task 2: Scheduled writer and health integration

Files: lib/platform/jobs.js, scripts/platform-jobs.mjs,
lib/platform/job-health.js as needed; tests/unit/platform-jobs.test.mjs.

Interface: optional statements operation, every 60 seconds with no overlap.
Before migration, table-presence check returns without touching partner records.
Use existing PLATFORM_JOBS_ENABLED/native writer handover. Per-partner transactions
commit independently; generic failure is observable and retries skip prior successes.

- [x] RED no overlap, disabled/no-schema, failure/retry and independent auth-expiry tests.
- [x] Connect bounded generator and job health without adding external delivery.
- [x] Focused tests; verify restart and multiple workers on native PostgreSQL.
- [ ] Commit job integration and evidence.

### Task 3: Owner scheduling and private partner history

Files: new operator/assets/partner-owner-statements.js; owner navigation/client/worker;
partner/public/assets/partner.js, client.js and worker/HTML release markers;
lib/partner-outreach/http.js resource allowlist. Add screenshots and browser tests.

Interfaces: statements read resource; owner #statements[/id], schedule form with
program revision; partner earnings history links to exact snapshot. Downloads verify
SHA-256 and use generated safe UUID filenames. Avoid caching private responses.

- [x] RED scheduling/history UI, partner isolation and expiry/generation race tests.
- [x] Implement accessible forms, timestamps, opt-in explanation and immutable history.
  Existing on-demand CSV remains available. Delayed snapshot copy states actual as-of.
- [x] Update shell versions/precaches; mobile light/dark, keyboard and empty states.
- [x] Native browser journey: owner schedules, advance week, run actual job, partner
  downloads, second partner denied, retry same bytes, payment changes do not rewrite.
- [x] Run npm test, complete native suite and npm run screenshots; inspect new full
  images and preview-board rows. Build owner and restricted API image/source hashes.
- [ ] Update contracts/operations/verification; commit/push/PR/current-head CI.

Deployment remains a separate real same-site staging/native migration/API/domain
rollout. This plan does not turn on invitations, launch flags, payments or email.


## Execution rulings

- Use the existing inline execution workflow; commit this coherent O-10 increment
  after owner/partner UI and the full regression rather than expose a partial UI.
- Capture as-of after financial locks, and recheck the Central week there; a batch
  crossing Monday skips stale candidates and lets the next poll use the new week.
- Review found the original 500-history failure would block stopping a schedule.
  Use 100-row scoped keyset pages with Older/Newest UI and schedule controls on every
  page. A 501-record RED-to-GREEN contract proves complete traversal and controls.
