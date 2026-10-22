# Operator inbox runbook

## What it does

Every successfully completed Neon request is atomically paired with one work item, one immutable `work.created` event, and one notification-outbox entry. The customer request remains the intake record; operational state, private notes, assignments, and history live in the work tables. A notification failure never changes whether the request was accepted.

The operator app is a separate installable PWA in `operator/`. It is intentionally outside `public/`, has its own origin, never stores sessions or customer data in browser storage, and keeps every `/api/` request network-only. Push payloads contain generic text plus opaque work/event IDs; names, contact details, descriptions, estimates, and file names are excluded.

Server behavior belongs to `lib/work-management/`: `domain.js` owns workflow policy, `service.js` exposes application operations, and `runtime.js` selects the Neon or loopback-local repository adapter. Operator API files authenticate and serialize HTTP only. Both adapters satisfy the same repository contract tests, including minimized lists, private detail, revision conflicts, idempotent commands, and outbox lifecycle.

## Print estimate section

See [Filament inventory and readiness](#filament-inventory-and-readiness) for stock matching and substitutions, which also work without print-estimate assets.

Print requests whose model was uploaded through the estimate flow show a **Print estimate** section in the private job sheet (never in the list, Push payloads, or Home Assistant):

- **Source files** — name, format, size, dimensions, triangle count, volume, warnings, analysis failures with their private diagnostic code, and retention state. **Download** requests a signed link valid for 60 seconds, only after the server verifies the asset belongs to this work item; it is never stored in the page.
- **Latest estimate** — the slicer result for the submitted profile when available, otherwise the submission snapshot: estimator, confidence, engine/version, profile, pricing-model version, customer range, selected price and basis, market price, economic floor, internal cost breakdown (material, passive machine, active labor, finishing), and projected profit/margin at low/target/high.
- **Slicer analysis** — job state, attempts, last error category, and next retry.
- **Estimate history** — every immutable snapshot, newest first.
- **Actual production** — record actual grams, machine hours, labor minutes, failed attempts, and quantity; variance against the linked estimate is shown.

If the print tables are unavailable, the section says so and the rest of the job sheet works. Filament cost basis is managed through `GET|POST /api/operator-print` (owner-only writes); see [PRINT-ESTIMATION.md](PRINT-ESTIMATION.md).

## Filament inventory and readiness

Open **Filament inventory** in the utility dock to record stock lots, including material keys, brand/line, color name, optional `#RRGGBB` swatch, nominal spool grams, current grams, costs in cents, and notes. Edit a lot to deactivate it. Only owners can save stock and shared matching settings; approved operators can inspect stock and preview matching. Stale writes fail with a conflict; reopen inventory to review current data before resubmitting. Drafts remain in memory on a failed save and are not stored in the browser.

Print job sheets show **Filament readiness**, independently of uploaded model/slicer availability. A numerical color count does not identify colors: enter names/hex values under **Review or correct filament requirements**. Generator matching reads only visible, non-sensitive color fields. Corrections retain the original request and supersede earlier proposals. Per-color grams can be entered when known; total slicer grams are never divided into fictional per-color amounts.

HSL thresholds have separate clockwise/counterclockwise hue limits (degrees) and saturation/lightness limits (percentage points). RGB thresholds use per-channel 0–255 differences. Both mode requires both, with RGB used for hue-undefined neutrals. Defaults: HSL; 45° each hue direction, 35 percentage points saturation/lightness; RGB 80 per channel; close band 25%, widening step 25%; stock buffer 10g. Limits can be previewed against selected work and saved explicitly. Material is exact unless the owner configures a directional `requested > offered` pair. Digital swatches approximate physical colors; review finish, translucency and functional material suitability separately.

Matching widens only until it finds a populated search band. Its closest option is preselected; every option in that band is shown, with further eligible matches expandable. Color limits always use the original request as their center. CIE76 distance ranks eligible colors; it never overrides channel/material limits. Unknown colors/demand require review. Purchase alerts remain visible when stock is insufficient. Available grams are unreserved across work; within one work item, selected alternatives share the same stock pool.

Create a proposal for the selected stock. **Accept on customer's behalf** requires a reason/source such as a verbal call. Alternatively preview the server-addressed customer email and explicitly send the request. The customer replies to the business; record acceptance or decline and its source in the work pane. There is no inbound email automation or customer approval portal. Sending never marks a proposal accepted. Reopen a recorded decision with a reason before changing it; history and offered-color snapshots remain available.

Email uses existing `RESEND_API_KEY`, `REQUEST_FROM_EMAIL`, and `REQUEST_TO_EMAIL`. Unconfigured/failed delivery leaves a pending, copyable message. **Uncertain** means verify delivery before retrying; **sending** holds a 30-second claim. Retries reuse the proposal's message and provider idempotency key for at most 23 hours, within [Resend's 24-hour guarantee](https://resend.com/docs/dashboard/emails/idempotency-keys). After that, verify manually and create a new proposal only if another email is needed. Replacing a proposal invalidates old approval actions. No stock is reserved, consumed, or purchased automatically.

Matching tables require migration `010_filament_matching.sql` after 009. Without that migration, filament readiness reports unavailable while the rest of a job sheet remains usable. Inventory costs, approval history, customer addresses, and matching details stay out of work-list summaries, Home Assistant and Push.

## Local use

```bash
npm install
npm run dev:workspace
```

The command starts both origins on loopback and prints their URLs. Development authorization requires all of `LOCAL_DEV=1`, `OPERATOR_DEV_AUTH=1`, loopback binding, and the exact allowed origin; the coordinator owns those flags. Data persists in ignored `data/operator-dev.json`. Delete that file only when you deliberately want to reset local queue state.

## Production setup

1. Apply `neon/migrations/003_work_queue.sql` after migrations 001 and 002:

   ```bash
   node --env-file=.env.production.local scripts/migrate-neon.mjs 003_work_queue.sql
   ```

2. Enable Managed Neon Auth on the production branch and configure GitHub as a social provider. Its callback URL must exactly match the URL Neon supplies for that branch.
3. Set `NEON_AUTH_BASE_URL` and `NEON_AUTH_JWKS_URL` on the API deployment. Set the operator origin in `OPERATOR_ALLOWED_ORIGINS`; do not use a wildcard. The API normally verifies Neon JWTs. It also accepts a bounded opaque Managed Auth session token by resolving it against an unexpired `neon_auth.session` row; this covers managed deployments where the cross-origin browser response does not expose Neon's JWT header. This fallback stays inside the Neon adapter and never bypasses the explicit `operators.auth_user_id` approval check.
4. Build the local browser bundle with `npm run operator:build`, then deploy `operator/` as a separate static app whose non-file routes fall back to `index.html`. Return a non-cacheable `/config.json` containing only `apiBase` and `authBase`. Neither value is a secret.
5. Sign in once, obtain the stable Neon Auth user ID from the managed-auth user record/session, and explicitly approve it:

   ```sql
   INSERT INTO operators (auth_user_id, display_name, role, enabled)
   VALUES ('stable-auth-user-id', 'Owner name', 'owner', true);
   ```

   Authorization never falls back to email, GitHub login, or display name. Disable access with `UPDATE operators SET enabled = false WHERE auth_user_id = '...';`.
6. Generate a VAPID key pair (`npx web-push generate-vapid-keys`), set `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, and server-only `VAPID_PRIVATE_KEY`, then create a separate long random `PUSH_WORKER_SECRET`.
7. Deploy `neon.ts`. It defines the `pushoutbox` Function and a one-minute schedule. Set the resulting HTTPS URL as `PUSH_WORKER_URL` on the storefront/API deployment. The immediate trigger reduces latency; the database schedule is the durable retry path.

## Verification

Submit a harmless synthetic request and verify, in order:

- one `service_requests` row, `work_items` row, `work.created` event, and `notification_outbox` row exist;
- the approved operator can list a minimized summary and open the private detail;
- an unapproved or disabled identity receives 403 and no customer data;
- acknowledge, priority, target date, status, and note changes increment `revision` and append events;
- a stale revision returns `revision_conflict` and does not overwrite the newer change;
- notification permission is requested only after pressing **Manage notifications**;
- the Push payload is generic and the outbox reaches `delivered`, or returns to `pending` after a temporary provider failure;
- expired Push endpoints are disabled without exposing provider response bodies;
- Cache Storage contains shell files only, and local/session storage contain no request or session data.

Run `npm test` and `npm run screenshots` before release. Inspect `screenshots/preview-board.png`, including the desktop and 390-pixel operator states.

## Recovery and rotation

- If the operator app is unavailable, intake still persists and email/webhook delivery remains independent. Query the private database or use the existing owner email while restoring the app.
- If the immediate worker call fails, leave the outbox row intact; the scheduled Function retries it. Do not mark the customer request failed.
- Rotate `PUSH_WORKER_SECRET` on both callers in one maintenance window. Rotate VAPID keys only when necessary: existing browser subscriptions will need to be enabled again.
- To replace GitHub or Managed Neon Auth later, implement the existing identity-provider and browser-auth adapter contracts. Keep `operators.auth_user_id` mapped to the new provider's stable subject and migrate mappings deliberately; never auto-match by email.
- Roll back application code before reversing schema. Migration 003 is additive and can remain during a rollback. Do not drop work/event/outbox tables until every deployed API and Function no longer references them.

## Spoolman inventory integration

See [Spoolman sync operations](SPOOLMAN.md) for private networking, migration 011, source ownership, cost coverage, freshness, operator refresh, and recovery verification. Spoolman stock is imported read-only; printer consumption remains owned by the existing Home Assistant integration.
