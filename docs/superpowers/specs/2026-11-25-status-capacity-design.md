# Capacity reporting, daily digest, and threshold alerts

Status: proposed design; owner selected daily digest plus threshold alerts. Implementation awaits design approval.

## Intent and scope

Expose impending provider quota, local resource, and application rate-limit pressure before it interrupts the storefront. Reuse the independent status system, its approved owner email destination, and its separately protected operations view. The public page already links to that view. Keep all numerical capacity/account details private.

Required initial coverage: Vercel Blob transfer/storage/operations; other Vercel usage returned by the supported billing interface; Cloudflare status Worker/Durable Object usage; Resend daily/monthly email quotas and reported API rate limits; native host disk/memory/CPU and container resource caps; database size/connections where accessible with the existing runtime role; application estimate/upload rate-limit configuration and aggregate utilization; backup downloaded/reused bytes from completed receipts. Report unsupported or unavailable metrics explicitly rather than claiming coverage. GitHub API rate information may be included when obtainable with an existing appropriately scoped credential. Preserve existing Neon retirement/billing attestations.

This adds reporting, not new enforcement, automatic upgrades, paid subscriptions, quota changes, destructive cleanup, or additional model downloads. Existing business and security limits continue to apply.

## Approaches

1. **Extend independent status (recommended):** scheduled provider collection and signed local aggregates feed one capacity model used by the protected page, digest, and alerts. Preserves outage independence and existing authentication/email boundaries.
2. Extend the main operator dashboard: convenient, but ties operational visibility to the stack being monitored and introduces duplicate status/auth behavior.
3. Rely on provider dashboards and their email alerts: low implementation cost, but cannot combine local resources, application limits, and backup transfer evidence or give a consistent daily report.

Call: use approach 1. The owner has delegated implementation choices; the approved cadence is daily digest plus threshold alerts.

## Evidence and collection

Each allowlisted metric has a stable ID, fixed display label, provider/service, scope (account/team/project/store/host), unit, used/limit/remaining when known, period start/end/reset when known, measured-at time, receipt time, maximum age, source kind, and availability state. Labels and console links come from reviewed code, never raw provider text. Scope must be visible: account totals must not be presented as project-only usage.

Separate provider-authoritative readings, application-observed counters, and dated manual attestations. A configured limit is not measured usage. Null limits mean unknown/unlimited only as explicitly reported by that provider; zero is never coerced into a positive denominator. Retain last successful values with their original time through failures, alongside a sanitized failure state. Never refresh their evidence age merely because collection failed. Validate finite nonnegative numbers, bounded arrays/strings, units, IDs, scope, windows, and future timestamps. Reject malformed/replayed signed reports atomically.

Provider adapters use documented read-only APIs, fixed HTTPS origins/paths, bounded bodies, deadlines, no redirects, and sanitized failures. Verify actual API schemas, permissions, account/plan applicability, and units against official documentation before implementing each adapter. Vercel supports billing usage through API/CLI; confirm the account's supported query and whether limits are separately sourced. Resend documents GET /usage but requires full-access credentials: do not silently broaden the sending key. An unavailable credential or unsupported plan produces an explicit unavailable metric and setup guidance. Do not scrape dashboards or infer billable Blob transfer from object sizes.

Keep provider credentials server-only in the independent Worker when available; provider reads must not depend on the native host. Existing local collector sends only allowlisted host/database/application aggregates through its signed heartbeat. Extend its strict validation and body bounds deliberately. It must not export customer identifiers, per-client buckets, SQL, process command lines, container environment, customer paths, raw exceptions, or secrets. Use existing least-privilege database access. A failed optional metric cannot fabricate success or erase other valid metrics.

Use the current five-minute scheduler for local evidence and alert evaluation; collect provider usage at most hourly (24 scheduled collections/day/provider), honoring Retry-After without tight retries. Browser views only read cached snapshots. Provider readings expire after two hours unless their documented latency requires an explicitly displayed longer age; local readings retain the existing twelve-minute expiry. No database migration is expected; any necessary database change requires separate schema review before implementation.

Retain only the current metric set and at most 30 compact daily summaries, with explicit record/byte bounds and pruning. Measure the added Worker request, CPU, storage, email, and provider-operation budget before deployment; keep it within the existing free plans. No separate analytics service.

## Private view and emails

Add a Capacity & limits section to the existing protected operations view. Show service, metric/scope, used versus limit, remaining, reset/window, status, source, and evidence age. Include a compact group for local resources, rate limits, and backup transfer savings. Unknown/stale/manual evidence is visibly labeled and cannot render green. Support light/dark/system, keyboard focus, reduced motion, and 390px without horizontal page overflow. Reuse the public page's existing operations link with clearer capacity wording if helpful.

Public /api/public and static output never include capacity metrics, plan/spend details, provider account identifiers, or resource figures. Keep Vercel Authentication on every operations deployment and the server-only HMAC reader boundary. Anonymous direct-reader, alias, preview, and generated-deployment access must fail closed. No new authentication system and no new public operations JSON endpoint.

Owner email uses the same normalized private snapshot. Add capacity summaries to incident/recovery emails and a daily digest with current service health, attention items, usage/limits/remaining/reset, freshness/source, backup transfer counters, and a protected-page link. Missing provider credentials appear as unavailable coverage, not zero usage. Preserve manual invoice dispatch and existing recipients.

## Scheduling and alert policy

Proposed defaults (implementation calls for approval): digest at 08:00 America/Chicago, keyed by local calendar date and DST-aware. The first scheduled run after that time sends once for that date, without replaying a backlog of missed days. A deployment or retry does not create a second event for the same date.

Warn at 70% and mark critical at 90% of a known finite limit. A hard-exhausted metric is critical. For local resource utilization require two fresh consecutive five-minute observations; percentage recovery requires two fresh observations below the crossed threshold minus five percentage points. Provider quota crossings use a fresh authoritative reading; a reset starts a new period. Rate windows are shown exactly as observed; do not infer sustained request rates from sparse samples. Recent explicit throttling can be a separate bounded warning with a defined expiry. Final details for unavailable telemetry and per-metric exceptions must be documented in the implementation plan.

Send on warning/critical/recovery transitions, not every numeric change. Fingerprints include metric ID, severity, and accounting period. The digest includes ongoing warnings without triggering another threshold email. Unknown or stale evidence is a distinct telemetry problem, never a recovery. Preserve existing operational alerts and avoid duplicate disk alerts by consolidating the shared condition. Existing stricter safety blockers remain effective.

Persist the exact immutable email payload and stable idempotency key before sending. Retry the same event within Resend's current safe retry window; never reuse a key with changed content or silently replace an uncertain pending message. Pending expired/ambiguous sends remain visible for intervention. Prioritize critical incident/threshold events over a digest; keep a bounded pending queue and the existing eight-attempt daily delivery cap and fifteen-minute minimum spacing. A digest delayed by this budget must be visible as delayed/missed, not falsely delivered. No synthetic test email to a new recipient.

## Verification and acceptance

- Unit/contract coverage: provider URL/method/auth/permissions assumptions, redirects/timeouts/bounds/429 handling; malformed/partial/missing data; scope, units and periods; unknown/unlimited/zero limits; staleness and replay; threshold transitions/hysteresis/resets; DST/calendar-day digest deduplication; persisted payload retry/idempotency and delivery budget/priority.
- Projection/auth coverage: capacity data absent from public responses and assets; signed reports/readers fail closed; no secrets in HTML/logs; unconfigured providers remain explicit. Independently test anonymous operations deployments after rollout.
- Browser coverage/screenshots: authenticated capacity render, unavailable/stale states, themes, keyboard navigation, 390px, public page unchanged except reviewed link text. Run npm test, npm run screenshots, and inspect screenshots/preview-board.png. Update public documentation review receipts if changed documents require them.
- Production: deploy only tested exact main artifacts, independently verify current supported provider readings and their scopes without customer Blob downloads; verify local signed aggregates and protected access; observe one actual scheduled digest to the existing owner destination and a safe threshold/deduplication rehearsal without changing real provider quotas. Record delivery evidence without private figures/identifiers in public PR notes.
- Update status README and stack operations docs for all environment variables, credential requirements, collection budgets, unavailable coverage, schedule, thresholds, retry behavior, retention, and recovery. No claim that all quotas are monitored when any required source remains unavailable.

## Official references

- https://vercel.com/changelog/access-billing-usage-cost-data-api
- https://vercel.com/docs/cli/usage
- https://vercel.com/docs/vercel-blob/usage-and-pricing
- https://resend.com/docs/api-reference/usage/retrieve-usage
- https://resend.com/changelog/account-usage-api
- https://developers.cloudflare.com/analytics/graphql-api/
- https://developers.cloudflare.com/workers/platform/limits/

## Left to the builder

Module/file decomposition, fixed metric registry details based on verified provider schemas, private credential plumbing, responsive markup, compact storage representation, exact CPU sampling implementation, and test fixtures. Do not expand permissions, change public privacy boundaries, or enable paid features to make a provider metric appear available.
