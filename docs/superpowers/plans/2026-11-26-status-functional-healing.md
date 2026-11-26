# Functional status verification and recovery implementation plan

> Execution: native implementation in this session, followed by independent review.

**Goal:** Restore the three public functional checks using recurring real evidence and recover safely from the diagnosed idle-worker condition.
**Architecture:** A bounded host runner invokes existing public capabilities, persists synthetic ownership/retry state privately, and reports signed aggregates through the existing platform collector. An independently hosted signed delivery webhook correlates a daily owner-only production-transport verification email. Queue reconciliation supplies explicit recovery proof.
**Tech Stack:** Node.js, Python, PostgreSQL, Cloudflare Worker/Durable Object, current protected Vercel operations proxy.
**Spec:** `docs/superpowers/specs/2026-11-26-status-functional-healing-design.md`

## Global constraints

- Six-hour upload/slicing cadence, 24-hour evidence lifetime, at most one owner-only email per day, no customer messages.
- No renewal of manual control assertions, automatic failover, customer record deletion/retry, provider permission expansion, or invoice dispatch.
- Preserve exact synthetic ownership, provider alignment, bounded concurrency/backoff, cleanup debt, private paths/ACLs, and existing cron.
- Run full tests, screenshots and independent review, pass CI before merge, and deploy exact tested source.

## Review focus

- Signed delivery events arriving before their signed correlation report must be bounded and cannot renew old delivery evidence.
- An idle worker is recoverable only with authoritative absence of relevant unresolved debt.
- Unsupported customer input must remain visible while healthy ready assets do not imply worker outage.
- A timed-out upload/slice must retain the exact synthetic ownership and avoid starting unlimited new probes.
- Recovery actions must respect active leases, deployment/handover guards, and persisted cooldowns.

## Task 1: Queue-backed idle recovery

Files: `lib/platform/job-health.js`, `lib/platform/status.js`, `lib/push-delivery.js`, `lib/partner-outreach/statements.js`, worker call sites and focused unit tests.

- [ ] Write failing regression tests for idle-with-proof recovery, idle-without-proof latching, relevant queue failure preservation, and historical unsupported jobs on ready assets.
- [ ] Run `node --test tests/unit/platform-status.test.mjs tests/unit/push-delivery.test.mjs tests/unit/partner-statements.test.mjs`; confirm new assertions fail.
- [ ] Supply explicit queue-verified recovery proof after fresh successful scans; retain failure counts and real debt. Keep historical records untouched.
- [ ] Run focused tests and commit the coherent fix.

## Task 2: Functional evidence and delivered-event boundary

Files: `status/lib/functional.js` (new), `status/lib/model.js`, `status/worker.js`, `status/lib/operations-page.js`, heartbeat and Worker tests.

Interfaces: platform `functional` contains fixed upload/estimate result times and stages, expected receipt ID/time, repair/backoff aggregates; signed delivery events contain only allowlisted IDs/types/times after signature verification. `functionalSnapshot(state, now)` produces private stage summaries and scoped capability acceptance.

- [ ] Write failing tests for expiry, provider mismatch, failed/new attempts, denied/replayed signatures, out-of-order delivery/correlation, and privacy.
- [ ] Extend strict heartbeat validation without weakening existing fields; integrate bounded independent delivery-event storage and verified event correlation.
- [ ] Project real verification into the public model and stage/repair detail into the protected operations page; preserve manual control evidence.
- [ ] Run focused status and browser privacy regressions and commit.

## Task 3: Scheduled real probes and bounded recovery

Files: `lib/platform/functional-probe.js` (new), `scripts/platform-functional-probe.mjs` (new), `deploy/platform/status-functional.py` (new), existing collector, native receipt transport, host-runner/unit tests.

Interfaces: runner reads/writes owner-only JSON state in the private platform root, uses fixed production origin and fixed service allowlist, invokes native code with synthetic capability ownership, and emits schema-validated aggregates. It does not expose configuration values.

- [ ] Write failing tests for six-hour cadence, daily immutable mail envelope, ambiguous delivery, stage resume, cleanup debt, Retry-After, timeouts, parallel execution, guarded restart and capped cooldown.
- [ ] Implement fixed tiny STL upload/read/deny/analyze/slicer workflow and exact-owned cleanup; persist after each stage.
- [ ] Add owner-only verification through the same native receipt transport with stable daily idempotency and delivery correlation.
- [ ] Integrate periodic runner into the existing cron invocation with a nonoverlap lock; permit only bounded recovery of the existing jobs/slicer services after safety preconditions.
- [ ] Run focused host/runtime tests and commit.

## Task 4: Documentation, complete verification and rollout

Files: status and platform runbooks, provider contract documentation, operations screenshots and tests.

- [ ] Document the delivery-webhook setup, signing secret, cadence, evidence semantics, recovery caps and unresolved manual controls.
- [ ] Run `npm test`, generate screenshots, and inspect preview board plus 390px light/dark captures.
- [ ] Request independent whole-branch review and fix confirmed findings.
- [ ] Open a PR, wait for CI success, verify tested head, merge, and compare Git trees.
- [ ] Deploy Worker/protected proxy before compatible native/collector changes; preserve secrets, private ACLs and cron.
- [ ] Register the isolated delivery webhook through existing account access without broadening working credentials. Run genuine bounded probes and verify all three checks against actual evidence.
- [ ] Check public capacity isolation, all protected routes, live smoke, and recurring scheduling. Record any account-access blocker honestly.
