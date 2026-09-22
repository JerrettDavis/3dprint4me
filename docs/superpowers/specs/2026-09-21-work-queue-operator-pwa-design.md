# Work Queue and Operator PWA Design

## Purpose

Build the first operational back-office system for 3dprint4.me. Every successfully persisted detailed work request must create durable operational work alongside the existing email path. An authenticated, locally served, installable PWA must let an operator receive OS notifications, inspect requests, triage them, update workflow state and scheduling fields, and add private notes. The data and interfaces must form a stable base for later printer, slicer, and spool-management integrations.

The storefront remains static-first and publicly deployable from `public/`. The operator application is a separate artifact outside `public/` and is not deployed with the storefront unless a future decision explicitly changes that boundary.

## Product scope

The first release includes:

- Atomic creation of one work item for every submitted, database-persisted detailed service request.
- A durable, append-only event feed for work creation and operator changes.
- An authenticated operator API for listing, reading, and updating work.
- GitHub sign-in through Neon Managed Better Auth, with authorization limited to explicitly approved operators.
- A local, installable PWA with an inbox, filters, detail view, operational editing, activity history, connection state, theme controls, and responsive/accessible behavior.
- Encrypted Web Push delivery to subscribed operator devices, including while the PWA is closed.
- A transactional notification outbox, immediate delivery attempt, and scheduled retry worker using Neon Functions and Function Triggers.
- A localhost-only development identity and local persistence path for an end-to-end demonstration without production secrets.
- Unit, API, browser E2E, accessibility, responsive, service-worker, and screenshot verification.

This release does not automate slicing, printer control, spool inventory, quoting, customer messaging, payments, file downloads, or job assignment to a physical printer. It creates explicit interfaces and events those capabilities can consume later.

## Constraints and invariants

All repository invariants in `AGENTS.md` remain in force. In particular:

- Only `public/` is storefront static output. The operator PWA must live outside it.
- No GitHub, Neon Auth, Push, database, or worker secret may enter `public/` or any browser bundle.
- Customer uploads remain private and the first operator release exposes file metadata only, not unsigned public URLs.
- Customer request payloads remain server-normalized and are never overwritten by operational edits.
- Storefront requests remain functional in delivery-only and no-integration modes. A work item is guaranteed only when database persistence succeeds; email remains independent.
- Provider failures return generic errors and never reveal tokens, keys, endpoints containing secrets, raw provider responses, or private payloads.
- The operator UI must support light, dark, and system themes; keyboard use; visible focus; reduced motion; and a 390-pixel viewport.
- Private API responses and customer data must not be stored in the service-worker cache.
- GitHub is the first identity provider, not an application-wide identity contract.
- Browser estimates remain non-binding, and payment state is not inferred from a Stripe return URL.

## Architecture

The existing Vercel storefront API remains responsible for accepting and validating customer requests. Neon Postgres becomes the authoritative operational queue. A request-completion transaction moves the request to `submitted`, creates its corresponding `work_items` row, appends a `work.created` event, and creates a pending Push outbox event. A unique request foreign key makes the operation idempotent.

The operator PWA talks only to authenticated `/api/operator/*` Vercel functions. These functions validate the Neon Auth session, resolve the authenticated user to an approved operator, validate all request data, and call a focused work-store boundary. Browser code never connects directly to Postgres and never receives a database credential.

Neon Managed Better Auth owns OAuth state, GitHub provider integration, sessions, cookies/tokens, and provider switching. Application authorization is separate: a small `operators` table maps a stable Neon Auth user ID to an enabled operator role. This prevents any GitHub-authenticated account from reading customer data.

Web Push delivery uses the standard Push API, a service worker, and VAPID credentials. Subscription endpoints and keys are stored as private operational data. Push payloads contain no customer name, email, project title, description, estimate, or file metadata. They identify only a generic new-work event and a safe application route.

A Neon Function owns Push outbox delivery. The request path asks it to drain newly created work immediately after commit, but this call is best-effort and never changes customer-facing submission success. A Neon schedule trigger runs the same idempotent drain regularly (initial target: once per minute) so failures recover while Neon remains able to scale to zero. Local development runs the same worker contract with a local interval or explicit test trigger.

## Repository layout and component boundaries

Expected new units:

- `operator/` — locally served static PWA source and assets; never part of Vercel `public/` output.
- `operator/index.html` — semantic application shell and sign-in/inbox/detail regions.
- `operator/manifest.webmanifest` — install metadata and icon declarations.
- `operator/service-worker.js` — shell caching only, Push receipt, generic notification display, and click routing.
- `operator/assets/operator.js` — application orchestration and state transitions.
- `operator/assets/api-client.js` — authenticated HTTP boundary and normalized errors.
- `operator/assets/auth-client.js` — Neon Auth client adapter exposing provider-neutral sign-in/session/sign-out behavior.
- `operator/assets/work-state.js` — pure filtering, sorting, formatting, and optimistic-concurrency state helpers.
- `operator/assets/push-client.js` — permission, subscription, unsubscribe, and capability behavior.
- `operator/assets/operator.css` — accessible responsive visual system consuming a small local token set.
- `lib/operator-auth.js` — server-side session verification and operator authorization.
- `lib/work-store.js` — production Neon work queries and mutations.
- `lib/work-validation.js` — query, mutation, transition, note, date, priority, and revision validation.
- `lib/push.js` — subscription validation, VAPID delivery, privacy-safe payload construction, and provider error classification.
- `api/operator-session.js` — current authorized operator identity.
- `api/operator-work.js` — paginated list and detail reads.
- `api/operator-work-update.js` — validated optimistic-concurrency mutations.
- `api/operator-push.js` — subscribe, unsubscribe, and test-notification operations.
- `neon/functions/push-outbox.ts` — immediate/scheduled delivery worker.
- `scripts/operator-server.mjs` — localhost operator host and development adapter wiring.
- `neon/migrations/003_work_queue.sql` — additive queue, event, operator, subscription, and outbox schema.
- `neon.ts` — declarative Neon Auth, Function, and trigger configuration when supported by the linked project.

Exact file names may be adjusted during planning if repository patterns or current Neon tooling require it, but boundaries must remain focused and provider-neutral.

## Data model

### `operators`

- `id`: generated stable identifier.
- `auth_user_id`: unique Neon Auth user identifier.
- `display_name`: operator-facing name.
- `role`: initially `owner` or `operator`.
- `enabled`: immediate access revocation flag.
- `created_at`, `updated_at`, `last_seen_at`: audit and operations timestamps.

Only enabled rows authorize access. Identity-provider login, email, or display name alone never grants access.

### `work_items`

- `id`: generated opaque work identifier.
- `request_id`: unique foreign key to `service_requests.id`.
- `status`: operational workflow state.
- `priority`: `low`, `normal`, `high`, or `urgent`.
- `acknowledged_at`, `acknowledged_by`: first-triage evidence.
- `target_date`: nullable operator-selected date.
- `assigned_operator_id`: nullable operator assignment.
- `revision`: monotonically increasing integer used for optimistic concurrency.
- `created_at`, `updated_at`, `completed_at`: operational timestamps.

The submitted request payload, customer details, and uploaded-file metadata continue to live in `service_requests`; they are joined for authorized reads rather than copied into the work row.

### `work_notes`

- `id`, `work_item_id`, `operator_id`, `body`, `created_at`.

Notes are append-only in the first release. They are private operational content and are never included in customer emails or public APIs.

### `work_events`

- `id`: monotonically sortable event identifier.
- `work_item_id`, `request_id`.
- `event_type`: versioned event name such as `work.created`, `work.acknowledged`, `work.status_changed`, `work.priority_changed`, `work.target_date_changed`, or `work.note_added`.
- `actor_type`: `system` or `operator`.
- `actor_id`: nullable operator identifier.
- `data`: bounded, versioned JSON containing only the fields necessary for that event.
- `occurred_at`.

Events are append-only. Future integrations consume them using a cursor and must be idempotent by event ID.

### `push_subscriptions`

- `id`, `operator_id`, endpoint, key material, user-agent summary, enabled flag, failure count, created/updated/last-success timestamps.

The endpoint is unique. Revoked sessions do not automatically delete a device subscription, but explicit sign-out unregisters it when online, and disabled operators can never use operator APIs.

### `notification_outbox`

- `id`, `event_id`, `kind`, privacy-safe payload, state, attempt count, next-attempt time, lease timestamps, delivered timestamp, and last-error category.

`event_id` plus `kind` is unique. Workers claim bounded batches with row locking and skip locked rows. Transient failures use bounded exponential backoff. Permanent endpoint failures disable the subscription. Delivery is at-least-once; consumer-visible behavior must tolerate duplicate generic alerts.

## Workflow and mutation rules

Initial statuses are:

```text
submitted -> triage -> quoted -> approved -> scheduled -> in_progress -> completed
```

Alternate states are `waiting_customer`, `declined`, and `cancelled`.

Rules:

- New work starts in `submitted`, priority `normal`, unacknowledged, revision `1`.
- Acknowledgment is explicit and records its first operator and timestamp. Repeated acknowledgment is idempotent.
- Normal forward movement follows the primary sequence.
- `submitted`, `triage`, or `quoted` may move to `waiting_customer`; `waiting_customer` may return to the immediately recorded prior active state.
- `submitted`, `triage`, or `quoted` may be declined.
- Any non-completed, non-declined work may be cancelled.
- Terminal states are immutable in the first release except through a future deliberate reopen feature.
- Setting `scheduled` requires a target date.
- `completed` sets `completed_at` server-side.
- Priority and target date changes are allowed on non-terminal work.
- Every mutation supplies the expected revision. A mismatch returns `409 Conflict` with enough safe metadata for the client to refresh, never silently overwrites.
- Note creation is append-only, length-bounded, plain text, and subject to the same authorization checks.

The existing `service_requests.status` continues to support the storefront and current operational vocabulary. Work-item mutations update it only through an explicit mapping where equivalent states exist; richer work-only states remain in `work_items`. The work item is the authoritative future automation state.

## Operator API

All endpoints use JSON, `Cache-Control: no-store`, generic provider errors, strict method checks, bounded bodies, and an allowlist of trusted operator origins. Unauthorized and disabled identities receive no customer-data existence clues.

The API surface provides:

- Current session and authorization state.
- Cursor-paginated work summaries with status, acknowledgment, service, priority, and date filters.
- One work detail with normalized request data, file metadata, notes, and recent events.
- One mutation command per request for acknowledgment, status, priority, target date, assignment, or note creation, all carrying expected revision/idempotency data.
- Push public-key/config discovery without secrets.
- Push subscribe, unsubscribe, and generic test-notification commands.
- An incremental event feed after a cursor for future adapters; the first UI may use it for efficient refresh.

The API returns explicit stable error codes alongside human-readable messages so the PWA can distinguish sign-in required, forbidden, validation failure, conflict, temporary provider failure, and offline/network failure.

## Authentication and authorization

Neon Managed Better Auth is the initial auth service. GitHub is enabled as the first provider. The operator browser uses the official Neon Auth/Better Auth client interface and requests only identity access required for sign-in; repository permissions are not requested.

The PWA exposes an internal auth adapter with operations equivalent to `signIn(provider)`, `getSession()`, `signOut()`, and session-change observation. No work component imports a GitHub SDK or depends on GitHub login names. A future provider change is therefore auth configuration plus adapter-level work, not a queue/API rewrite.

The production operator API validates sessions with the supported Neon server-side mechanism and then queries `operators.auth_user_id`. A valid Neon Auth session without an enabled operator row receives `403 Forbidden`.

Trusted origins include the explicit local operator origin and any future hosted operator origin. Wildcard origins and reflected arbitrary origins are forbidden. Local development auth bypass is accepted only when all of these are true: `LOCAL_DEV=1`, an explicit operator-development flag is set, the server is bound to loopback, and the request originates from the configured loopback application. Production deployment validation rejects the development flag.

## PWA behavior

The default view is an operational inbox, not an analytics dashboard. It prioritizes what needs attention.

### Inbox

- Shows an unacknowledged count and connection freshness.
- Provides `Unacknowledged`, `Active`, `Waiting`, `Completed`, and `All` views.
- Filters by service and priority.
- Sorts urgent/high priority first and then oldest actionable submission first; completed/all views can sort newest first.
- Uses accessible status text in addition to color.
- Supports keyboard navigation without turning the list into a custom inaccessible grid.

### Detail

- Shows service, customer contact, description, submitted estimate, specifications, deadline, and uploaded-file metadata.
- Clearly labels the browser estimate as non-binding.
- Separates customer-submitted information from private operations fields.
- Allows acknowledgment, valid status transitions, priority, target date, assignment, and new notes.
- Shows an ordered event/note history with actor and timestamp.
- On `409`, preserves any unsent note text, reloads current state, and explains that newer work was not overwritten.

### Connectivity and offline behavior

- The service worker precaches only the application shell, icons, manifest, and versioned static assets.
- API routes use network-only fetch and never enter Cache Storage.
- The application does not persist request details, customer data, notes, or auth material in local storage.
- Offline startup shows the shell, sign-in/session uncertainty, and a reconnect action. It does not show stale private request data.
- Mutations are never queued offline; the operator receives a clear not-saved message.

### Theme and accessibility

- Light, dark, and system modes are available and theme storage failure is non-fatal.
- Focus is visible, dialogs/drawers manage focus correctly, and all controls have accessible names.
- Motion respects `prefers-reduced-motion`.
- Layout is fully usable at 390 CSS pixels and at desktop widths.
- Status, error, connection, and Push-permission changes use appropriate live-region behavior without excessive announcements.

## Web Push and notifications

The PWA asks for notification permission only after an explicit operator action and explains why it is useful. Denial or unsupported Push never blocks inbox use. The client registers the service worker, obtains the server's VAPID public key, creates a Push subscription, and submits it through the authenticated API.

Notification content is deliberately generic:

- Title: `New 3dprint4.me work request`
- Body: `Open the work inbox to review it.`
- Data: a same-origin application route and opaque event/work identifier only.

The service worker calls `showNotification` for Push events. Clicking focuses an existing operator window or opens the inbox and routes to the work item after normal authentication. It never embeds customer PII in lock-screen-visible text.

Immediate and scheduled delivery use the same outbox-drain implementation. A successful provider response marks the per-subscription delivery complete. HTTP `404` or `410` disables the subscription; throttling and server failures retry; malformed subscription data is permanent failure. Logs include safe IDs and categories, not endpoint URLs, key material, customer data, or raw provider bodies.

## Local operational demonstration

The repository provides one command that starts the storefront/API and operator PWA on loopback, using explicit development adapters. A seeded or newly submitted request can be completed through the real storefront UI and must appear in the operator inbox without restarting either server. The operator can acknowledge it, update fields, add a note, and observe the activity history.

The local persistence adapter survives page reload and server restart for demonstration purposes, uses a repository-ignored data path, and mirrors production interfaces. It is never selected in production. Local Push uses real browser service-worker APIs when supported; automated tests use a controlled Push transport boundary and browser permission contexts rather than contacting an external Push service.

At the end of implementation, the local applications are opened for human inspection after automated verification passes.

## Failure behavior

| Failure | Required behavior |
|---|---|
| Work transaction fails | Request completion returns a generic storage failure; no email or Push claims accepted operational work. |
| Email fails after persistence | Work remains queued; customer response reports accepted persistence according to existing behavior; safe delivery outcome is logged. |
| Immediate Push invocation fails | Request remains queued; outbox remains pending for scheduled retry. |
| Scheduled worker runs twice | Row leases and idempotency prevent corrupt or duplicate state; duplicate generic Push remains harmless. |
| Push endpoint expires | Subscription is disabled without affecting work or other devices. |
| Neon Auth unavailable | Operator UI shows temporary sign-in/session failure; no private data is returned. |
| Valid identity is not an operator | API returns forbidden without leaking queue contents. |
| Session expires while open | Private view is cleared from memory and sign-in is requested. |
| Operator update conflicts | Server returns 409; UI refreshes and does not overwrite the newer revision. |
| Operator goes offline during edit | No mutation is queued or claimed saved; typed note remains in memory for retry. |
| Provider returns a raw error | Server/worker logs only safe category/status; browser receives a generic stable error. |

## Testing strategy and acceptance criteria

Implementation follows test-driven development. New production behavior is preceded by a failing focused test.

### Unit and API coverage

- Migration invariants, unique request-to-work relation, indexes, checks, foreign keys, and additive compatibility.
- Request completion creates request state, work item, event, and outbox atomically and idempotently.
- All valid and invalid workflow transitions.
- Priority, date, note, assignment, body-size, cursor, identifier, and revision validation.
- Authentication success, missing session, expired session, non-operator identity, disabled operator, and provider outage.
- Trusted-origin allowlisting and denied arbitrary origins/preflight behavior.
- List pagination/filtering and detail data minimization.
- Optimistic-concurrency conflicts and mutation idempotency.
- Push subscription validation, privacy-safe payloads, success, expiry, throttling, transient failure, backoff, leases, and duplicate worker execution.
- No secrets or raw provider errors in responses or captured logs.
- Local adapters implement the same observable contracts as production adapters.

### Browser E2E coverage

- Signed-out screen, GitHub sign-in initiation boundary, authorized local-development sign-in, forbidden identity, and sign-out clearing private state.
- Empty, loading, populated, offline, API-error, and expired-session states.
- A real local storefront submission appears in the inbox with exactly one work item.
- Acknowledgment, priority, target date, every allowed status path, invalid transition rejection, and private note history.
- Two-page revision conflict preserves newer server state and explains recovery.
- Filters, ordering, incremental refresh, and push-triggered refresh.
- Push unsupported, default permission, denied permission, granted/subscribed, unsubscribe, generic notification content, and notification-click routing.
- Service-worker shell caching and proof that private API responses/customer data are absent from Cache Storage and local/session storage.
- Keyboard-only operation, focus return, accessible names/statuses/live regions, reduced motion, light/dark/system themes, and no horizontal overflow at 390 pixels.
- All four storefront service paths still submit only their relevant normalized fields and create work successfully when persistence is configured.
- No-integration storefront fallback remains customer-recoverable and does not claim a durable work item.

### Verification gates

- `npm test` passes, including all existing storefront tests.
- Any new provider contract test asserts method, URL shape, headers, request body privacy, timeout, signature/session verification, and failure behavior against official documentation.
- `npm run screenshots` regenerates storefront and operator views.
- `screenshots/preview-board.png` and operator screenshot artifacts are visually inspected.
- The local end-to-end command is run, a request is created through the storefront, the work item is modified through the PWA, and the application is opened for user inspection.
- Production deployment documentation lists Neon Auth/GitHub, VAPID, Neon Function/trigger, migration, operator provisioning, rotation/revocation, and smoke-test steps.

## Deployment and operations

Production setup requires:

1. Apply the additive work-queue migration.
2. Enable Neon Managed Better Auth on the production branch.
3. Configure GitHub as a social provider and register only explicit trusted origins/callbacks.
4. Complete one owner sign-in, then provision that stable Auth user ID into `operators`; do not authorize by mutable username alone.
5. Generate VAPID keys and store the private key only in the Push worker environment. The public key may be returned by the authenticated configuration endpoint.
6. Deploy the Neon Push function and enable its schedule trigger.
7. Configure the Vercel function to invoke immediate delivery using the documented Neon Function authentication mechanism.
8. Run provider contract checks and a production smoke request using labeled synthetic data, then delete the synthetic customer/work records and Push subscription.

Operational documentation must cover disabling an operator, revoking sessions, removing a device subscription, rotating GitHub/VAPID credentials, inspecting outbox failures, replaying safe events, and falling back to the durable inbox when notifications are unavailable.

## Cost and evolution

The first pass uses existing Vercel and Neon services plus standards-based Web Push. Neon Managed Better Auth and scheduled Functions are selected because current Neon Free allowances are ample for a single-operator storefront and avoid another queue/auth vendor. Usage and limits must be monitored rather than assumed permanent.

Future printer, slicer, and spool integrations consume `work_events` through the authenticated cursor API or a purpose-built worker credential. They must not scrape the PWA, read customer tables directly from desktop software, or overload work status with machine execution details. Later schemas can add print jobs, artifacts, machines, slicer runs, material reservations, and job-specific events while keeping the original request and work-item contracts stable.
