# Functional status verification and bounded recovery

Status: owner approved on November 26, including at most one owner-only verification email daily. Broader failover and changes to customer records are outside scope.

## Intent and observed condition

Keep Private uploads, Print estimates, and Request receipts backed by current functional evidence, and recover automatically from the present monitoring/worker condition where safe.

Live diagnosis on November 26 found all three public checks unknown. Their configuration prerequisites exist, but the old manual functional timestamps are beyond their 24-hour lifetime. The private page has eight blockers because separate manual controls also expired. Those controls are not proof of an application failure and must not be copied into new timestamps.

The platform collector is fresh and the database is reachable. Push and statement workers have fresh idle polls but retain an old failure indefinitely. The notification outbox contains three skipped records and no active records. Two analysis jobs have historical terminal category `unsupported`; their assets are ready and attached. They must remain recorded, without automatic requeue, deletion, or a claim that those jobs succeeded. Slicer, expiry, and retention workers have current successful observations.

## Approaches

1. Renew manual attestations: quick but does not prevent recurrence, and an assertion without repeating the check would be false evidence. Rejected.
2. Observe customer traffic only: avoids synthetic operations, but quiet periods cannot establish current upload/slicing/delivery capability. Supported as evidence, insufficient on its own for the requested recurring verification.
3. Scheduled bounded functional probes and evidence-based job recovery: recommended. Exercise the existing paths with a tiny synthetic model, retain dated results, and clear failures only after authoritative verification. Receipt verification requires the explicit email-mode choice below.

## Upload and estimate verification

- Use the existing public production health and capability-owned print-estimate API. Check the reported production database provider rather than trusting a local candidate.
- Upload a fixed tiny non-sensitive STL privately, confirm anonymous access is denied, verify authenticated byte readback and server geometry analysis, then require a completed slicer estimate from the real worker.
- Do not create a customer request, work item, invoice, or customer notification. Use a dedicated synthetic session with private ownership and cleanup limited to that exact session and its objects. Persist cleanup debt and retry it; never delete unrelated sessions or customer assets.
- Run on a six-hour cadence. One execution at a time, fixed timeouts, persisted progress, and bounded retries/backoff prevent creating new sessions repeatedly while the original slice is pending. A provider throttle honors Retry-After. No unbounded provider polling or extra backup downloads.
- Record actual stage success times, provider, safe reason codes, and cleanup state. Unknown, failed, pending, and stale remain distinct. A failed stage cannot renew its verification timestamp.
- Report signed functional evidence independently of the manual control bundle. Retain the 24-hour acceptance limit and all existing API/database-provider and worker prerequisites. No secret, capability token, object path, customer data, or raw provider error enters public status or email.

## Receipt verification: owner decision

Recommended for a reliably current check in quiet periods: at most one owner-only verification email per day, sent through the production receipt transport and its existing sender/owner destination. Use a stable idempotency key, persist the exact envelope before sending, and never blindly resend an ambiguous attempt. Verify the provider's signed delivered event for that exact message. Provider acceptance is reported separately from recipient-server delivery; neither means the owner read the email.

Alternative: collect signed delivered events from ordinary production receipt emails only. No additional emails, but the check will correctly return to unknown after 24 hours without qualifying traffic. Existing status digests alone cannot prove that the application's receipt path works.

Use official Resend webhook documentation and signature validation, bounded event payloads, exact tracked message correlation, and replay/idempotency protection. Keep message identities and addresses private. No broadening of the working send-only API key is needed. A new isolated webhook-signing secret may be stored privately; existing credentials are preserved. If webhook registration/account access is unavailable, expose that missing prerequisite rather than asserting delivery.

## Recovery of the present jobs condition

- Allow a fresh successful push or statement poll to clear a prior failure only when its underlying queue/schedule has been authoritatively checked and has no unresolved relevant failure or due backlog. A zero-claimed result alone remains insufficient. Query failure or missing schema cannot establish recovery.
- Separate historical terminal input rejection from worker availability. Ignore `unsupported` as a service-outage blocker only where the current asset state proves analysis is ready; retain the failed job and all other operational failures. Explicit regression tests must preserve blocking for real active failures, retries, expired leases, and unfinished assets.
- A stale/unresponsive worker may receive a bounded restart of the existing jobs or slicer service only after confirming the live PostgreSQL selection, no handover/deployment guard, and no healthy active lease that would be interrupted. Persist a cooldown, cap attempts, then re-run functional verification. A restart is not success evidence.
- Never automatically retry a terminal customer job, resend customer messages, switch databases/providers, restore a backup, change routing/quotas/credentials, or dispatch an invoice. Escalate conditions outside these bounded repairs through existing alerts.

## Reporting and manual controls

The private view shows each functional stage, last successful check, next check/backoff, safe failure reason, last repair, and outstanding cleanup. Public status shows only scoped dated capability evidence. Existing capacity reporting and deduplicated alerts remain intact.

Expired owner sign-in, billing, off-site custody, cutover, and backup-scheduler assertions remain separate. Do not renew them through functional probes. Automatic routine repair does not establish disaster-recovery readiness or automatic failover.

## Release acceptance

- Reproduce the three stale public checks and both idle-worker latches in regression tests before changing behavior.
- Test failed stages, stale/future timestamps, mismatched providers, rejected signatures/replays, ambiguous email attempts, Retry-After, concurrent runs, cooldown/restart caps, guarded deployments, and cleanup failure.
- Provider contract tests assert fixed URL shape, methods, headers, and safe failure handling using official primary documentation.
- Run the full repository test suite and screenshots; inspect the preview board and 390px light/dark functional-status captures.
- Review the changes, pass CI before merge, deploy the exact tested source, preserve private files/ACLs and cron schedules, and verify production functional results and anonymous access denial. No status-only timestamp refresh counts as acceptance.

## Remaining implementation choices

Reuse the current native collector, server-side provider modules, signed heartbeat boundary, independent Worker, and protected Vercel view. Keep synthetic ownership and retry state in the existing private platform root. Do not add a public scheduler or a dependency on an owner desktop session. Exact probe intervals can be reduced if measured provider costs require it, while leaving stale evidence honest.
