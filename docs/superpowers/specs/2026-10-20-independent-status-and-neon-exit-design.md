# Independent status and Neon exit

Status: owner authorized execution (“roll through to completion”); implementation and deployment in progress.

Owner decision2026-10-20: downgrade Neon to Free once fully offloaded. This
authorizes the downgrade after the migration/backup/dependency gates pass;
it does not authorize cancelling access while production still depends on Neon.
The subsequent execution instruction approves the dashboard recommendation.
Recovery-point requirements remain unspecified: manual recovery and no automatic
promotion are the safe default, without a promised data-loss tolerance.

Owner steering2026-10-20: land secure, detailed, secret-free operational information
in GitHub and automate repeatable scaffolding/recovery wherever practical.
Source must include declarative deployment, monitoring, backup and restore
procedures, private configuration templates, pinned artifacts and acceptance
checks. State remaining external credentials/key-custody prerequisites explicitly.

## Intent

The owner wants a dashboard hosted separately from the main stack that exposes
availability and blockers before they cause another Neon-style outage. Normal
operations must be able to run without Neon and its paid subscription. Neon may
be an optional recovery destination, provided its cost and data freshness are
explicit. Existing authorization to finish the local migration remains valid.
Invoices remain drafts with manual dispatch only.

## Current evidence and gaps

Production still uses Neon. Billing upgrade restored access; the public schema
was exported into two encrypted off-host repositories and restored successfully.
The private PG18/API candidate is healthy. A scratch PG18 handover rehearsal
verified all 18 source-table counts, broad-role write fencing, safe rollback
before activation, and durable target selection after a new target write/restart.
These prove migration mechanics, not production cutover or failover readiness.

Known blockers: sending credentials are unresolved, periodic backup scheduling
and independent freshness checks are unfinished, public routing/owner sign-in
are not verified, and final writer handover has not run. A fresh code review
identified anonymous sign-in flow exhaustion; the fix passed regression tests
and independent review and must be included in the deployed candidate. The
existing local backup copies are off the Docker host,
but physical site independence and key custody remain unverified.

## Proposed architecture (builder recommendations)

Use a small separately deployable status application, with static UI on a
dedicated Vercel project and bounded scheduled probes/storage on Cloudflare
Workers. The UI must also be exportable to another static host. This splits
the display from the local host/ISP and the probe runtime from Vercel. Both
Vercel and Cloudflare remain shared dependencies with production; state that
explicitly. Provide the Vercel deployment URL as an alternate to the custom
status hostname if Cloudflare DNS is affected. Do not claim full provider
independence or high availability.

Keep status storage independent of PostgreSQL and Neon. A single scheduled
collector writes small validated snapshots into bounded Worker storage. The
dashboard reads snapshots rather than probing services on every page view.
Use one five-minute schedule, fixed allowlisted URLs, parallel probes with
strict deadlines, no redirects, limited response sizes and no write retries.
Retain 30 days of compact probe summaries, with explicit pruning and quota
accounting. Calculate the proposed schedule/storage request budget against the
actual account's free-tier limits before deployment; do not enable paid tiers
or upgrades to make this work silently.

The baseline dashboard is public but intentionally coarse: named customer
capabilities, operational/degraded/unavailable/unknown/maintenance states,
checked-at times, incidents and recovery progress. Never publish customer
records, amounts, queue payloads, internal hostnames/IPs, secret names/values,
raw provider exceptions, backup repository identifiers or detailed security
blockers. Detailed blockers and telemetry require independently hosted access
control. Prefer existing Vercel deployment protection if available; otherwise
select a free independent identity service during implementation and fail
closed until configured. Local Authentik must not be the only way to read
outage details. Do not implement custom password authentication.

## Signals and truthful states

Probe storefront, operator shell, fixed API readiness, auth discovery, and
private-upload/estimate dependencies without creating customer requests,
sending email, or dispatching invoices. Readiness must query the selected
business database and identify its provider; a static HTTP200 is insufficient.
Separate shell availability from successful sign-in and usable application API.
Periodic real owner sign-in and synthetic private-upload lifecycle drills are
recorded evidence, not inferred from provider status pages.

A local least-privilege collector reports only an allowlisted aggregate schema:
API/database health, worker last-success and oldest pending job age, disk free,
memory pressure, container restarts, deployment generation, selected database
provider, auth capacity, and whether billing is still draft-only. No arbitrary
SQL/command endpoint, Docker socket, database URL or administrator credential
is exposed to the external collector. Add a distinct read-only status credential;
never reuse the proxy/handover secret. A signed timestamped heartbeat is limited
in size, replay-resistant, and cannot change deployment or billing state.

Backup runner evidence is separate from application health: latest encrypted
backup time, result, completed restore-drill time, copied-off-host result and
recovery-location verification. The receiver records arrival time; reject
future/old/out-of-order evidence. Stopped hosts/runners must become stale even
if their last report was green. Backup success never implies successful restore.

Recommended initial thresholds: probe every5min, stale after12min; incidents
after two consecutive failures and recovery after two consecutive successes;
show individual failures immediately as warnings. Initial backup warning2h,
critical6h and restore-drill overdue30days are provisional operating defaults,
not an agreed recovery-point guarantee. Each status includes the evidence time,
source, threshold and next action. Missing/disabled/unverified evidence is
unknown or blocked, never green. Distinguish intentionally disabled invoices
from an invoice outage. Incident annotations cannot override failed probes.

Private blocker records have stable IDs, impact, severity, evidence, owner,
next action and last verified time. Include migration, credentials, capacity,
backups, restore readiness and cost exposure. Track changes in reviewed source
or authenticated storage; no anonymous edit route. Public projection contains
only reviewed customer-safe text. Dashboard refresh must never wake Neon SQL.

Alert delivery requires a destination independent of the local host and
Authentik. Implement deduplicated open/recovery events and a visible delivery
failure state. No real external notifications until the owner specifies the
destination and authorizes sending there. Until then show alerts as unconfigured,
not complete. Alert/probe runtime failure is detected through snapshot staleness;
a second independent watchdog is needed before claiming guaranteed notifications.

## Neon exit and cost verification

The definition of done is: no production database/auth dependency on Neon,
no source workers/pollers/schedules, no preview/old-deployment path that can
write old data, current verified off-host backups, actual target owner login,
and an observed quiet Neon source after cutover. Include old environment values,
GitHub schedules, dev processes, slicer jobs and integrations in the inventory.
Preserve provider-neutral SQL for recovery; do not remove compatibility code
merely to claim exit. Retained credentials must not make Neon an implicit fallback.

Read billing/usage metadata through a narrowly scoped management credential if
the provider supports one. Otherwise use a manually verified billing attestation
with an expiry and link to the console. Never claim spend is zero from zero SQL
requests. Show plan, storage, compute use, quota remaining, observed spend,
projection confidence and verification time; unavailable/stale cost data is unknown.
No database health polling on a sleeping standby. Near-zero and exactly-zero are
separate states: paid storage can remain chargeable after compute suspends.

After migration, compare the actual account/project against Free eligibility and
verify downgrade timing, retained resources and any final accrued charges.
Other projects in the same organization must not be disrupted to reduce this
project's bill. Keep an encrypted final source archive and successful restore
evidence before retiring the old source. No destructive source deletion is
required by this design. A paid-plan downgrade is a concrete final operation
after the migration/backup gates, not a prerequisite for accessing source data.

## Recovery: zero-cost default, optional Neon destination

Recommend local primary plus encrypted off-site backups and a rehearsed manual
recovery destination. A sleeping/free Neon project can be an optional cold
destination; it is not a current replica or automatic failover simply because
an old database exists there. Snapshot time and achievable recovery time must be
visible. Exact data-loss tolerance and capabilities needed during a local outage
are awaiting the owner's answer. Do not select an RPO/RTO or enable automatic
promotion without it.

Recovering the database alone is insufficient: local API, Authentik, jobs,
credentials and connectivity must also be available outside the failed host.
The recovery drill must prove those paths and preserve owner identity mappings,
private uploads, idempotency and draft-only invoicing. Never silently switch
from local Authentik to an unrelated Neon identity or grant by email.

Write failover requires proof that the old primary is fenced or a previously
implemented externally enforced writer lease; an unreachable host is not proof.
A timeout/DNS failure must never activate a second writer. If fencing or data
freshness cannot be proved, show degraded/recoverable-request behavior rather
than acknowledge conflicting writes. Failback is another fenced reconciliation,
not changing a URL back. V1 status infrastructure has no promotion/write controls.

Do not open the local PostgreSQL port to the Internet to satisfy an optional
Neon subscriber. Continuous replication, managed writer leases, independently
hosted authentication/API recovery and any external durable intake queue require
a separately described design and cost/security review. Neon documentation says
publisher replication prevents suspension; its subscriber behavior differs.
Measure any proposed local-to-Neon approach rather than assuming either zero
cost or always-on billing. A free standby can exhaust quotas during an outage;
surface that capacity risk before declaring recovery ready.

## Acceptance

1. Dashboard remains readable with the Docker host and local Authentik stopped.
2. Stale collector, probe runtime, backup runner and cost evidence visibly expire.
3. Failed database/auth/jobs or exhausted disk create specific private blockers;
   public output contains only safe capability status.
4. No secrets or customer data in UI/static output/history; no visitor-triggered
   provider probes; unauthorized telemetry and edit requests are rejected.
5. Quota simulation stays bounded and no paid tier is enabled implicitly.
6. Production runs without Neon database/auth and a verified billing exit record
   explains any residual charges. Never cancel access before final data capture.
7. Any recovery claim is backed by a dated full-path drill with measured recovery
   point/time and single-writer proof; missing work stays visibly blocked.
8. Keyboard, reduced motion, light/dark/system themes and390px layout work.

## Primary references (verified2026-10-20)

- https://neon.com/pricing
- https://neon.com/docs/introduction/plans
- https://neon.com/docs/introduction/scale-to-zero
- https://neon.com/docs/guides/logical-replication-neon
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/

Plan/account-specific limits must be checked at implementation and downgrade;
these sources do not prove the current signed-in account's eligibility.
