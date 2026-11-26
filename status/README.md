# Independent status

## Private capacity, daily digest, and thresholds

The protected operations view includes capacity readings and their account/host
scope, units, allowance provenance, accounting window, reset, and observation
time. Its appearance links select system/light/dark without client scripts.
Capacity figures never enter the public snapshot. Browser views read cached
evidence and do not call provider APIs. The protected function response is
bounded to 96 KiB for the fixed metric registry; no provider credentials reach HTML.

Set the Worker variable `CAPACITY_DIGEST_ENABLED=1` to enable one daily digest
after **08:00 America/Chicago**, including daylight-saving changes. It uses the
existing `ALERT_FROM`, `ALERT_TO`, and `ALERT_RESEND_KEY` owner destination. A late
run catches up only today's digest; missed days are not replayed. The private
page shows scheduled/delayed/blocked/delivered state and missed dates. No new
recipient, invoice dispatch, or diagnostic email is introduced.

Warnings start at 70% and critical alerts at 90% of a known finite allowance or
explicit configured budget. Host/container resources require two fresh samples;
recovery requires two fresh samples below the crossed threshold minus five
percentage points. Threshold fingerprints include the metric, window, and severity,
so numeric changes within the same band do not resend. Stale/unknown evidence is
not recovery. Partial provider readings can prove a crossed threshold, but cannot
prove low current usage or recovery. Remaining capacity from partial usage is an
upper bound. Configured budgets are not claims about a provider's included plan.

The durable email queue holds one immutable attempted message. Critical incident
work wins over a new digest; an already attempted message must finish or be
explicitly investigated before it can be replaced. Preserve the same payload/key
on retries. After 23 hours, an uncertain pending event is blocked for intervention.
Legacy pending records missing the original sender/recipient envelope also block
delivery. Verify the original Resend event and envelope before repairing or retiring
one; never guess a new recipient or idempotency key. Upgrades do not resend it.
The existing eight-attempt UTC-day cap and fifteen-minute send spacing apply to
digests and alerts together; the page reports a delayed digest rather than claiming
delivery. A digest does not reset incident/threshold deduplication state.

Provider API collection occurs at most hourly and honors Retry-After without
inline retries. See [provider setup and limitations](../docs/STATUS-PROVIDERS.md)
for exact environment variables, read permissions, reviewed Vercel SKU mapping,
and dated manual allowance versus configured-budget schemas. Unconfigured or
unsupported metrics remain unknown. Provider failures preserve original last-good
timestamps. Provider readings expire after two hours; host/application readings
after twelve minutes; backup counters after two hours. Manual quota verification
expires after 24 hours independently of usage freshness. At most 40 readings and
30 compact daily summaries are retained.

### Dated manual evidence when usage APIs are unavailable

The current Hobby account's authenticated Vercel billing endpoint returns 404.
Hobby has no billing cycle; do not equate a calendar-month FOCUS query with its
rolling usage dashboard, or invent a reset date. A signed manual reading can
record an owner-verified dashboard observation until automatic access is available.
This is a dated fallback, not automatic dashboard scraping.

Create an owner-only JSON array **outside Git**, using the exact fixed metric IDs
and units from the provider guide. Each reading must have `source:"manual"`, an
appropriate account/project/store scope, its actual `observedAt`, and `used`/`limit`
numbers (or null when unavailable). A non-null allowance also needs
`limitSource:"manual"` and its actual `limitVerifiedAt`. Both observations and
allowance checks must be within 24 hours. Use null `periodStart`/`periodEnd` if the
provider has no verified fixed reset; set `windowKind:"rolling-30-days"` or
`"rolling-24-hours"` only when that reporting window is verified. Do not renew an
old observation merely by submitting it again.

Run `python deploy/platform/status-capacity-attest.py --config <private-status-keys.json>
--readings <private-readings.json>` from the repository, with Node available for
the shared schema validator. Input files require the same private ACL/mode checks
as backup custody. It sends only a bounded HMAC-signed `/heartbeat/manual` report
using the existing owner control reporting key. That route has separate replay
ordering and accepts manual capacity only: it cannot update/renew control,
functional checks, billing attestations or recovery claims. No arbitrary provider
URL, new credential, raw provider exception, or customer data is accepted.

The native collector adds fixed host and api/jobs/slicer aggregate resource
readings, runtime-role database size/connections and global estimate/upload rate
buckets. Client caps are configuration only; no client identifiers or individual
buckets are exported. Optional read failures stay unknown. Its service timeout is
100 seconds to accommodate bounded subprocesses; its cadence remains five minutes.
Successful backup heartbeats include only current, complete dual-store readback
counters (downloaded/reused objects and bytes), with no extra Blob reads. Legacy
collectors remain compatible while being rolled forward.

Added steady collection budget: at most 72 provider requests/day across three
configured adapters, reusing the existing 288 scheduled invocations/day and durable
state writes. One extra successful digest/day is within the shared eight-attempt
delivery cap. Telemetry adds less than 16 KiB/report and a bounded current-state
record; verify actual deployed Worker CPU/storage usage and account allowances
before relying on available headroom. No paid tier is activated.

Public dashboard: https://status.3dprint4.me (alternate
https://3dprint4me-status.vercel.app). Protected operations:
https://3dprint4me-operations.vercel.app. Neither uses local PostgreSQL or
Authentik for rendering or sign-in. Vercel/Cloudflare remain shared providers;
this is independence from the local host/ISP, not full provider independence.

Both documented public origins are explicitly allowed to read the Worker's
public snapshot through CORS. Unrecognized origins receive no CORS grant;
private operations still requires its independent authentication boundary.

The separate Vercel status project publishes only `status/public/`. The separate
operations project publishes only `status/operations/public/` plus its fixed
server function. Protect **all deployments** of the operations project using
Vercel Authentication before setting `OPERATIONS_PROTECTION_VERIFIED=1` and
installing its reader key. Test anonymous access to `/`, `/api/index`, aliases,
and generated URLs after each deployment. Do not create public bypass links.

Cloudflare Worker `3dprint4me-status` stores bounded evidence in one SQLite-backed
Durable Object. Serialization provides atomic timestamp/replay ordering across
isolates. Scheduled checks run every five minutes; page views only read stored
snapshots and never probe providers or Neon SQL. Worker redirects use `manual`
and reject non-success statuses; Workers does not implement `redirect: error`.
No raw response bodies/provider errors enter evidence or public output.

Four fixed external probes check the storefront shell, operator shell, production
health contract and GitHub-reported API service status. The fixed published
[GitHub status feed](https://www.githubstatus.com/api) checks only API Requests,
not unrelated Actions/Pages incidents. The feed needs no credentials and avoids
[shared-IP anonymous REST quotas](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).
This is provider-reported status, not proof of full owner sign-in. Application capabilities require fresh local evidence whose
database provider matches production's health response; candidate health alone
cannot turn production green. Two failures open incidents; two successes clear
them. Twelve-minute staleness is calculated both server-side and in an open tab.

Configured capabilities remain unknown until functional evidence exists. Signed
control reports may contain `verifiedProvider` (`postgres` or `neon`) and actual
`filesVerifiedAt`, `estimatesVerifiedAt`, `emailVerifiedAt` timestamps. These name
a successful private upload/read, completed model/slicer check, and confirmed
receipt delivery respectively. They expire after 24 hours from the actual check,
not arrival of a later heartbeat. Public status shows the check's date and scope.
Fresh platform/database and production API evidence must still agree on the
verified provider; failed prerequisites are never overridden. Estimates also need
healthy jobs. Open tabs expire both current telemetry and functional acceptance.
Never populate these fields from configuration alone or renew them without
repeating the functional check. Automated collection does not send diagnostic
emails; new manual diagnostic delivery still requires owner authorization.

`POST /heartbeat/platform`, `/backup` and `/control` each use a separate secret.
Send JSON `{observedAt,nonce,details}` with an HMAC-SHA256 hex
`x-status-signature` over the exact UTF-8 `pathname + '\n' + body`.
The timestamp must be within90seconds past/30seconds future and newer than the
last accepted report of its kind. Reports are capped at16KiB and one/minute;
unknown fields are rejected. Only allowlisted aggregates are accepted. Never
put URLs, credentials, customer information or raw errors into reports.

`GET /operations-reader` requires a separate server-only reader secret and
time-bound HMAC. It cannot write evidence or control the stack. Only the protected
Vercel operations function holds it; browser code receives no credential. Direct
Worker `/operations` access is denied. Cloudflare Access was not activated:
its onboarding required billing authorization. Existing Vercel Authentication
provides the independent access boundary without that additional subscription.

Use `wrangler secret bulk` via protected stdin for
`STATUS_PLATFORM_SECRET`, `STATUS_BACKUP_SECRET`, `STATUS_CONTROL_SECRET` and
`STATUS_READER_SECRET`. Never pass values as shell arguments or commit `.dev.vars`.
Wrangler OAuth is stored encrypted with its key in Windows Credential Manager;
scopes are limited to account/user reads, Workers script/deployment and routes.

The verified Cloudflare account is on Workers Free. Budget:288scheduled runs/day,
four bounded probes/run,288platform reports/day plus hourly backup and daily
control evidence; fewer than1,000 routine writes/day and under1MiB retained state.
Thirty daily summaries and20incidents are retained, not unbounded raw events.
Public traffic also consumes the Free request allowance; quota failures produce
unknown/stale evidence rather than paid overages. No paid tier is enabled.
An independent second watchdog is required before claiming guaranteed alerts.

Backup and cost evidence have different expiry windows. Successful backup
transfer does not prove restore, independent location or key custody. Billing
is not inferred from zero SQL traffic: an explicit dated account-plan check is
required. Control evidence expires after 24 hours, except a restore drill remains
valid for 30 days from its actual `restoreVerifiedAt` timestamp. Its control report
must also be within 30 days; neither timestamp may exceed the current time by more
than the 30-second clock allowance. Daily control reports must follow real checks,
not replay old assertions with a new timestamp. Manual recovery is the default; the dashboard has no writer promotion
or invoice dispatch action. Missing alert destination/restore/billing evidence
remains an explicit blocker.

Verification: `node --test tests/unit/status.test.mjs` and
`python -m pytest tests/e2e/test_status.py -q`. Use a local Wrangler scheduled
invocation as well; Node-only mocks do not establish edge-runtime compatibility.
