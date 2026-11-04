# Infrastructure verification, November 4, 2026

The recurring email combines current telemetry with a manual control record.
The control record was last submitted October 21 and expires after 24 hours;
an expired record causes previously verified controls to appear unverified.
Do not clear those warnings by copying old assertions into a fresh heartbeat.

## Fresh evidence

- The hourly `3dprint4me-encrypted-backup` Windows task uses Password logon,
  rather than an interactive desktop token. The 07:24 CST run returned zero,
  with no missed runs. A signed-out reboot has not been tested today.
- A new complete encrypted checkpoint at 13:48 UTC passed byte/hash readback
  in both configured Restic stores, including the private-object stream.
- Restoring that exact checkpoint initially failed because newer QA policies
  referenced a cluster role absent from database dumps. Recovery now creates
  `partner_qa_auth` as NOLOGIN, non-superuser, with no bypass-RLS or role/database
  creation privilege. Live authentication credentials are not restored into it.
- The corrected isolated drill restored the control database (25 tables) and
  selected live database (71 tables), verified 14 archive members, and confirmed
  runtime privilege denials. Containers had no network, published ports or
  persistent restore volume. The synthetic setup/export/rebuild regression also
  reproduced the failure and passed after the correction.
- A real production GitHub owner sign-in loaded the authenticated work inbox
  and an existing request. No customer records were changed.
- Private Blob listing and authenticated metadata reads succeed; an anonymous
  read of the same private object is denied. Backup private-object readback also
  succeeds. This does not establish a write to a replacement storage provider.
- Neon and its Vercel-managed subscription both show Free. Vercel lists 1 GB
  storage/project, 100 CU-hours/project, up to 2 CU and 100 projects. The prior
  October invoice is marked Paid with $0.00 due; historical total spent is $0.24.
  No plan, payment method or unrelated personal-site database was changed.
- Production selects PostgreSQL. The retired source still has 18 always-enabled
  write fences. The legacy GitHub estimate cleanup workflow remains disabled.
- Push, expiry, retention, statements and slicer workers have fresh successful
  health records. The oldest analysis job is ready; no analysis work is waiting.
  Three historical push outbox records were failed despite having no delivery
  records and no enrolled devices. Migration 017 introduces explicit `skipped`
  state; adapters skip empty delivery sets without claiming delivery, and retain
  actual delivery failures. The guarded production release of commit
  `6023204ad1ef65def0338088ce3fffaf920f206f` passed all checks, including a fresh
  complete checkpoint, API overlap, compatible worker handover and disabled flags.
  The three reviewed records were reconciled transactionally after confirming
  zero subscribers and zero delivery records; no delivery was claimed or sent.
  Fresh production job health is now true.
- A fresh anonymous synthetic STL upload completed both geometry analysis and
  production slicing (`ready`, slicer estimate, better confidence). No customer
  request was created; no email or invoice was sent. The anonymous session uses
  the normal retention policy.
- Billing remains disabled (`INVOICE_NINJA_ENABLED=0`). The authenticated UI
  retains draft-only/manual-dispatch wording. No invoice was dispatched.
- Resend configuration remains present; its domain-list endpoint reports
  `restricted_api_key`, consistent with send-only credentials. This is not proof
  of end-to-end receipt delivery. No customer email was sent by these checks.

Exact snapshot identities, hashes and aggregate restore results are retained in
the owner-only backup reports, not in the public handbook or browser assets.

## Remaining acceptance

Verify independent physical off-site storage and key custody with the owner.
Verify email delivery using an explicitly authorized diagnostic. The signed
control record now includes today's verified backup schedule, restore, owner
sign-in, cutover, source fences and Neon plan; credentials and off-site custody
remain unverified. Recheck the independent collector after the worker fix.
Control evidence currently expires after 24 hours, so an ongoing revalidation
cadence remains necessary; copying old assertions into fresh timestamps is not
a valid way to suppress reminders. A full replacement-host/provider rebuild
and a signed-out reboot remain separate from the successful database drill.

The investigation also found that the 24-hour bundle expiry discarded restore
evidence before its own 30-day deadline. The correction retains restore evidence
for 30 days from its actual verification time, independently of daily controls;
future or expired evidence remains unverified. Clock-based regression tests cover
day two, the 30-day boundary and stale daily checks. Other controls still need
actual daily revalidation. Today's heartbeat alone is not a durable resolution
of every recurring reminder: never renew manual sign-in, billing, delivery or
custody claims merely by copying their old values into a new report.

The monitoring correction is deployed as Worker version
`c3f30cb3-015e-4d23-8ffb-a295b49c7b2d`. Nine targeted status/alert tests, the
status browser regression, deployment dry run and local edge-runtime scheduled
invocation passed. A fresh authenticated read confirms the original restore
timestamp remains intact, jobs are healthy, alert delivery is configured, and
only off-site custody and provider credentials remain open. Existing secrets,
routes, Durable Object binding and five-minute schedule are preserved.

The latest workspace redesign was found uncommitted in the linked QA worktree;
earlier production UI deployments do not prove that redesign reached main. Its
release, current handbook and live checks must be recorded separately.
