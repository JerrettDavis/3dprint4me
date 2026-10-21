# Independent status

Public dashboard: https://status.3dprint4.me (alternate
https://3dprint4me-status.vercel.app). Protected operations:
https://3dprint4me-operations.vercel.app. Neither uses local PostgreSQL or
Authentik for rendering or sign-in. Vercel/Cloudflare remain shared providers;
this is independence from the local host/ISP, not full provider independence.

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
required. Manual recovery is the default; the dashboard has no writer promotion
or invoice dispatch action. Missing alert destination/restore/billing evidence
remains an explicit blocker.

Verification: `node --test tests/unit/status.test.mjs` and
`python -m pytest tests/e2e/test_status.py -q`. Use a local Wrangler scheduled
invocation as well; Node-only mocks do not establish edge-runtime compatibility.
