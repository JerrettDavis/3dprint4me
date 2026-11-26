# Status capacity implementation plan

> **For agentic workers:** use test-driven development; independent review before release. Owner approved implementation of the linked design.

**Goal:** deliver private capacity reporting, a daily 08:00 America/Chicago digest, and 70%/90% threshold alerts.
**Architecture:** bounded provider/local readings feed one normalized private capacity model; the existing independent Worker stores snapshots and sends immutable idempotent emails. Public projection remains capacity-free.
**Tech stack:** existing JavaScript ES modules, Cloudflare Worker/Durable Object, Python collectors, Vercel protected operations.
**Spec:** ../specs/2026-11-25-status-capacity-design.md

## Global constraints

No new paid feature, permission escalation, public capacity data, customer data, model downloads, or enforcement changes. Provider calls fixed/read-only/bounded/hourly; local evidence twelve-minute expiry, provider evidence two hours. Daily digest 08:00 America/Chicago; warning70%, critical90%; existing eight-attempt/day and fifteen-minute spacing preserved. Same immutable payload/key on retries; ambiguous expiry cannot be silently overwritten. Use existing owner destination. Only public/ is static within each deployment root.

## Interfaces and file ownership

- `status/lib/capacity.js`: registry, strict `validateCapacity(records)` and `capacitySnapshot(state,now)`, `updateCapacity(state,records,now)`; up to40 fixed IDs. Records `{id,used:number|null,limit:number|null,observedAt,periodStart:number|null,periodEnd:number|null,source,scope,unlimited?:boolean}`. Registry owns display label/unit/service; source enum provider/local/application/backup/manual; scope enum account/project/store/host/application. Unknown metrics rejected. No raw provider/account text.
- `status/lib/capacity-providers.js`: `collectProviderCapacity({env,now,fetchImpl}) -> records[]`; fixed provider read APIs, absent access yields no fresh record; `providerCoverage(env)` returns fixed provider configuration states. No dependency on model/UI modules.
- `lib/platform/capacity.js`: `collectLocalCapacity({query,env,now}) -> records[]`, existing runtime-role database reads and aggregate rate-limit facts. `deploy/platform/status-collector.py` adds bounded host records to existing signed details.capacity. `scripts/platform-status.mjs` composes database/application metrics. Root integrates existing platform collector/model schema.
- `status/lib/alerts.js`: existing incident delivery plus capacity transitions and date-keyed digest; bounded pending events, immutable retry payloads, priority, delivery status. Export same `deliverStatusAlert` interface.
- `status/worker.js`, `status/lib/model.js`: compose hourly provider refresh, strict signed local metrics, private snapshot, protected responsive capacity page. Root owns these integration files.
- `deploy/platform/backup-controller.py`: extend aggregate backup report from successful verified receipt, without extra Blob reads; root owns.
- Tests follow `tests/unit/status-capacity*.test.mjs`, `tests/unit/platform-capacity.test.mjs`, existing status tests, Python collector tests and `tests/e2e/test_status.py`.

## Review focus

- Unknown or unsupported provider fields cannot turn missing coverage into zero usage.
- A failed refresh retains the last original observation time and becomes stale rather than renewing it.
- An uncertain pending incident cannot be replaced by a new digest or threshold event.
- DST, local day boundaries and restart/retry cannot send a second digest for the same day.
- Public JSON, unauthenticated reader routes and static bundles cannot expose private capacity or credentials.

## Task 1: Normalize readings and threshold state

- [x] Write failing tests for unknown IDs, finite bounds, duplicate IDs, period/clock validation, missing/unlimited/zero limits, scope/source/unit projection, stale last-good values, threshold70/90, two local samples, five-point recovery hysteresis, and period resets.
- [x] Run `node --test tests/unit/status-capacity.test.mjs` to establish failure.
- [x] Implement capacity registry/validation/snapshot/update interfaces; retain at most40 readings and30 compact daily summaries, validate stored shape before projection. Expose fixed unavailable rows for required coverage.
- [x] Re-run focused tests to pass; commit.

## Task 2: Provider adapters

- [x] Verify official Vercel billing usage/schema and quotas, Resend GET /usage permissions/schema, Cloudflare account analytics query and plan limits. Record references and actual availability constraints. Do not scrape or guess undocumented usage endpoints.
- [x] Write failing contract tests for fixed URL/method/headers, account scope, bounds, timeout/redirect/429 handling, null limits, malformed data, unconfigured credentials, partial failures and no secret/raw-error output.
- [x] Implement provider collector with fixed registry IDs; unsupported metrics stay unavailable. Honor Retry-After on the shared hourly collector schedule; no tight retries. Add environment setup and permissions docs.
- [x] Pass `node --test tests/unit/status-capacity-providers.test.mjs`; independent review and commit.

## Task 3: Local and backup aggregates

- [x] Write failing Node/Python tests for runtime-only database size/connections, application rate config and aggregate buckets, bounded host disk/memory/CPU/container caps, and missing/failed samples; no customer/client identifiers.
- [x] Implement local module and host collector; compose in platform-status script and strict heartbeat validation. CPU uses a defined bounded interval/delta, not an invented instantaneous percentage. Database permission failures remain unknown; no grants/migration.
- [x] Extend successful backup heartbeat with only receipt-verified downloaded/reused counts/bytes. Failures cannot reuse a success timestamp; old controllers remain accepted. No new file/model reads.
- [x] Run focused Node/Python tests; independent review and commit.

## Task 4: Reliable digest and threshold emails

- [x] Add failing tests for08:00 Chicago/DST once-per-local-date, late same-day catchup without backlog, reset/threshold/recovery deduplication, stale-not-recovery, ongoing warning in digest, existing incident compatibility, immutable idempotent retries, critical-before-digest, eight daily attempts/fifteen-minute spacing and visible delayed/expired events.
- [x] Implement shared capacity email rendering and bounded persistent events. Preserve legacy pending events during upgrade. Capacity data only goes to configured existing owner destination; no test send to another recipient.
- [x] Run status alert/capacity tests and commit.

## Task 5: Private UI and Worker integration

- [x] Add failing integration/browser tests: hourly cache provider reads, page views never probe, capacity absent public JSON, invalid signed report rejection, unavailable/stale UI, escaped fixed labels, authenticated view, light/dark/system, keyboard/390px.
- [x] Integrate private capacity snapshot and responsive cards/table in protected operations page. Preserve existing secret boundaries and anonymous denials; update existing public link wording if useful. Bound server HTML below its response limit and explicitly test40 metrics.
- [ ] Update screenshots harness with protected capacity fixture; run focused tests/screenshots and inspect preview-board.png.
- [x] Document providers/permissions, collection and storage budgets, thresholds/schedule, unknown/manual scope and delivery recovery. Update handbook hashes where required.

## Task 6: Full verification and rollout

- [ ] Run npm test, screenshots, docs build/check, native/Worker-specific rehearsals and independent whole-change review. Inspect all results; fix causes rather than weakening coverage.
- [ ] Commit/push PR with exact final scope; verify green CI, merge main and deploy only exact tested source to independent Worker/status/operations and local collector/native runtime as required. Preserve all existing private config and unrelated services.
- [ ] Verify anonymous access denied on protected root/API/aliases/generated deployments, public JSON capacity-free, fresh supported provider readings/scopes, signed local/backup aggregates, email event persistence and scheduled digest delivery to existing owner. Use controlled-clock threshold rehearsal without changing real quotas; no unsolicited diagnostic messages.
- [ ] Record completion evidence and explicit unavailable provider coverage without private values or IDs. Preserve original dirty checkout.
