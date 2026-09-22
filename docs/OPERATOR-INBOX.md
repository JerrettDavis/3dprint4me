# Operator inbox runbook

## What it does

Every successfully completed Neon request is atomically paired with one work item, one immutable `work.created` event, and one notification-outbox entry. The customer request remains the intake record; operational state, private notes, assignments, and history live in the work tables. A notification failure never changes whether the request was accepted.

The operator app is a separate installable PWA in `operator/`. It is intentionally outside `public/`, has its own origin, never stores sessions or customer data in browser storage, and keeps every `/api/` request network-only. Push payloads contain generic text plus opaque work/event IDs; names, contact details, descriptions, estimates, and file names are excluded.

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
3. Set `NEON_AUTH_BASE_URL` and `NEON_AUTH_JWKS_URL` on the API deployment. Set the operator origin in `OPERATOR_ALLOWED_ORIGINS`; do not use a wildcard.
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
