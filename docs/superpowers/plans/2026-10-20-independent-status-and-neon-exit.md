# Independent status and Neon exit implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Independently display trustworthy service, recovery, blocker and cost evidence, then complete the already approved local migration and conditional Neon Free downgrade.

**Architecture:** Dedicated Vercel static status project, Cloudflare scheduled collector and bounded snapshot/history storage; separate signed local telemetry and read-only probes. Public projections omit operational detail; private details require independently hosted access protection. The dashboard never changes the writer or automatically promotes a recovery database.

**Tech stack:** Existing Node22/ES modules and Node tests, plain HTML/CSS/browser JavaScript, Cloudflare Workers/SQLite-backed Durable Objects and Vercel static hosting.

**Spec:** docs/superpowers/specs/2026-10-20-independent-status-and-neon-exit-design.md

Production execution evidence and remaining recovery limitations are recorded in
[the cutover record](../../PLATFORM-CUTOVER-2026-10-20.md). The original planned
KV storage was replaced by a Free-tier SQLite Durable Object. Unproven offsite
custody and historical notification failures remain explicit dashboard blockers.

## Global constraints

- No secrets/customer data in static output, probe logs or public status.
- Keep normal production independent of Neon; never poll standby SQL for status.
- Stale/missing evidence is unknown, never healthy; no automatic writer promotion.
- Fixed URLs, bounded bodies/deadlines/history, five-minute probes and twelve-minute freshness.
- Preserve all original AGENTS invariants and draft-only/manual-dispatch invoicing.
- Owner's “roll through to completion” authorizes inline execution of the reviewed dashboard recommendation and migration; no additional plan handoff is required.
- Default recovery is manual and fail-closed with no promised data-loss tolerance; no automatic failover until separately proven.

## Review focus

- Stale evidence during a collector/local outage must expire on the client as well as the server.
- Signed telemetry must reject replay, future timestamps, unknown fields and oversized messages.
- Public rendering must omit private blocker text and malicious strings must render as text.
- Free-tier quotas/provider failures must not cause uncontrolled probes or fabricated zero billing.
- A legacy writer or auth dependency must block Neon downgrade even when the new API returns200.

### Task1: Evidence model and collector

**Files:** status/lib/model.js, status/worker.js, status/wrangler.jsonc, tests/unit/status.test.mjs.
**Interfaces:** publicSnapshot(state,now) emits allowlisted capabilities/freshness; privateSnapshot includes validated blockers; scheduled collector updates storage with bounded history; signed POST heartbeat and fixed GET snapshot routes only.

- [x] Write RED tests for stale/public projections, quota-bounded probes, signature tamper/replay/time/size rejection, and unavailable provider/cost signals.
- [x] Implement model, exact-origin CORS, separate read/write credentials, constant-time verification and bounded Worker collector/storage.
- [x] Run affected tests and commit.

### Task2: Independent status UI and deployment

**Files:** status/public/index.html, assets/status.js, assets/status.css, status/vercel.json, status/README.md; tests/e2e/test_status.py.
**Interfaces:** static UI reads public snapshots; operational details are protected and never embedded in public assets.

- [x] Write RED browser coverage for operational/stale/offline states, text escaping and390px nooverflow.
- [x] Build accessible light/dark/system dashboard using existing brand; freshness recalculates without reload, failures retain dated stale evidence.
- [x] Run browser tests/screenshots and inspect images; verify account free-tier quotas and deploy independent app/collector without paid upgrades.
- [x] Verify dashboard remains readable without local API/Auth; record any credential/protection gaps as blockers rather than publishing details.

### Task3: Operational evidence and recoverability

**Files:** lib/platform/status.js, scripts/platform-status.mjs, deploy/platform/compose.yml, deploy/platform/backup-controller.py, status/README.md, tests/unit/platform-status.test.mjs.
**Interfaces:** local collector emits aggregate signed heartbeat; protected workstation backup selects actual durable database generation, captures business/control databases and private config only into encrypted off-host storage; backup timestamps are independent of application heartbeat.

- [x] Test selected database vs candidate, no secrets/PII in telemetry, backup manifests and failure evidence.
- [x] Implement minimum-privilege health/job/capacity telemetry; schedule encrypted backups with lock/timeout and bounded retained evidence; run actual isolated restore.
- [x] Configure probe/status credentials outside source and verify fail/stale states.

### Task4: Reviewed production cutover and billing exit

**Files:** existing migration plan/runbook and reviewed platform code, deployment evidence; status blocker records.

- [x] Finish provider credentials without exposing secrets; preserve Home Assistant and email paths.
- [x] Run required npm test/screenshots/security scans and fresh whole-change review; fix Important/Critical findings.
- [x] Merge main/deploy compatibility code with forwarding unset, publish verified candidate tunnel, and smoke native handlers without customer email.
- [x] Inventory/pause exact old writers, bridge source traffic, bounded drain/fence/final export/restore/newgeneration activation, resume only target workers.
- [x] Verify real owner login/intake/private files/estimates/draft-only billing; encrypt final backup and restore drill; measure source quietness.
- [x] Remove active Neon dependencies, verify account downgrade eligibility and retained data, downgrade to Free; record actual plan/result/residual final charges.
- [x] Publish status evidence honestly; unresolved external credential requirements remain explicit blockers, never reported complete.
