# Remove the Neon production dependency

Status: proposed; implementation and production cutover await owner review.

## Intent and observed state

The owner wants the previously started migration completed using existing local
infrastructure or a suitable free service, with secure operation, good performance,
and continuity of service. Existing invoices remain drafts until manual dispatch.

The earlier completed phase is PR #43: fewer Neon scheduler/polling wake-ups.
Main now includes draft invoicing in PR #44. Its activation is disabled pending
database availability and a securely configured Invoice Ninja credential.
Both Neon's HTTPS SQL service and native PostgreSQL connections currently reject
reads with a quota-exceeded error (native SQLSTATE 53000). A source export cannot
currently be obtained. No database export was found in the local backup locations
checked; schema migration files are not a data backup.

Read-only inspection confirms the existing Docker host is reachable, has spare
memory/disk, healthy PostgreSQL and Authentik services, and an existing reverse
proxy. The slicer worker is restarting. Do not modify unrelated homelab services.
Host addresses, credentials and database contents belong in private operations
records, never this public repository.

## Recommended architecture (builder's recommendation)

Keep the storefront and separate operator PWA on Vercel. Keep private Vercel Blob
objects and existing email delivery in place. Move the twelve API handlers,
PostgreSQL data, operator authentication, Push outbox processing, scheduled cleanup
and slicer database access off Neon. Reuse the application's existing domain and
repository behavior, not a rewrite of intake or pricing.

- A dedicated application PostgreSQL container and persistent volume run on the
  existing Docker host. The source console reports PostgreSQL 18; use a pinned
  compatible PostgreSQL 18 target and matching dump tools, not an in-place change
  to the unrelated healthy shared PostgreSQL 17 service. No database port is
  published to the LAN or Internet.
- A production Node API container runs the existing API handlers. It has a small,
  bounded native PostgreSQL pool, connection/query timeouts, request limits,
  graceful shutdown and health/readiness checks. It exposes no source directory.
- An outbound Cloudflare Tunnel publishes `api.3dprint4.me` over HTTPS. Its origin
  connects only to the API container on the designated Docker network. No new
  inbound router port or public database listener is needed. Tunnel credentials
  remain private deployment secrets.
- Existing storefront `/api/*` URLs are retained through a server-only Vercel
  forwarding adapter. The origin is fixed by configuration, redirects are refused,
  bodies/responses/time are bounded, and writes are never automatically retried.
  A dedicated server-to-server HMAC proof binds method, exact path/query, request
  body, caller IP, origin, timestamp and nonce. The API checks freshness and replay
  before trusting forwarded identity/rate-limit information. Untrusted forwarded
  headers are discarded. This is an HTTP application boundary, not a SQL gateway.
  Hash the exact bytes sent downstream, including bytes reserialized from a parsed
  Vercel JSON body; never sign one representation and send another. Reject
  duplicate security headers and use a route-specific header allowlist preserving
  content type, origin, authorization, idempotency key and
  `x-print-estimate-token` where required. Preserve `Allow`, `Retry-After` and
  existing private-download responses. Bound replay storage and fail closed if
  replay protection is unavailable.
- The operator PWA calls the API origin directly with exact-origin CORS and
  credentialed requests. Cookies are host-only, Secure, HttpOnly and SameSite=Lax.
  Auth sessions and customer records never enter browser persistent storage.
  The production PWA is `https://work.3dprint4.me`, same-site with the HTTPS API.
  Vercel preview/alias origins do not receive production cookie-auth access.
- Public API access is limited to the intended intake paths through the signed
  storefront proxy, minimal health, and the explicitly authenticated operator,
  machine and authentication paths. Internal readiness and worker routes are not
  accidentally published through arbitrary forwarding.

The application API is the only network-facing service added. Database, migration
and backup credentials are separate. Runtime has only necessary table/sequence
permissions and explicit private RLS policies; it is neither database owner nor
superuser and has no BYPASSRLS or schema-creation permission. Existing immutable
estimate and invoice intent triggers remain effective.
RLS policies grant only the dedicated backend role access; per-operator
authorization remains in the application. Do not imply the SQL adapter propagates
an operator or tenant identity into PostgreSQL sessions.

## Authentication without Neon

Register a dedicated confidential OIDC application with existing Authentik using
an exact callback URL. Use a maintained OIDC client library for authorization-code
exchange, PKCE, state, nonce, issuer, audience and signature verification. No
hand-written token validation and no trust in email/display name for authorization.

Store short-lived login attempts and hashed random session identifiers in private
PostgreSQL tables. Keep provider tokens and client secrets server-side; discard
provider tokens after verifying identity when no longer needed. Bound session and
attempt lifetimes; consume callbacks once; require origin checks for logout and
all cookie-authenticated mutations. Login/return destinations are fixed or strictly
allowlisted. Do not log callback query strings, codes, cookies or tokens.

Bind the exact `(issuer, subject)` to the restored existing operator ID through an
explicit administrative migration. Preserve operator IDs, roles, assignments,
notes and event attribution. A successful Authentik login alone grants no app
access. Disabled/unapproved operators fail closed on every request. Old Neon
sessions expire rather than being converted into trusted new sessions. Preserve
the legacy authentication adapter only as an explicit rollback configuration.

## Data and jobs

Add a provider-neutral tagged SQL boundary supporting the existing Neon adapter
and native `pg` during transition. Keep parameters separate from SQL, normalize
date/JSON/bigint behavior to the existing repository contract, and preserve atomic
CTEs, leases, uniqueness, idempotency and revision checks. Test the real SQL against
PostgreSQL, including private roles/RLS and failure behavior.

Export the source with a consistent native dump when access becomes available, or
admit a verified existing backup. Include application schemas, sequences, keys,
indexes, triggers and all operational history. Retain necessary identity metadata
privately for explicit operator mapping. Do not blindly import managed service
roles/extensions or overwrite an unrelated database. Record counts, stable IDs,
sequence positions, constraints and private file references; verify them after
restore. Apply pending additive migrations, including 007 invoicing, to the target.

Run Push/outbox and retention jobs locally with the existing atomic leases and
bounded concurrency. Retire Neon/GitHub schedules only after replacement jobs are
verified, avoiding two independent writers during migration. Update the slicer to
use the local database while retaining existing private Blob access and isolation.
Do not reset or recreate submitted work to make migration appear successful.
Preserve the current VAPID public/private key pair and PWA origin, as well as
restored subscriptions. Explicitly inventory the immediate HTTP Push trigger,
Neon scheduled Push sweep, GitHub cleanup schedule, any host cleanup schedule and
the slicer loop, then prove their replacement invocation and writer handover.
Leases in separate source/target databases cannot coordinate simultaneous writers.

Local containers require a private Blob token; they cannot assume Vercel runtime
OIDC is available. Verify signing, private reads/writes/deletion from the local
runtime. Preserve existing capability-signing, rate-salt and other data-dependent
secrets where required, without recording their values in evidence.

## Continuity and rollback

There can be no claim of zero downtime while the source database already rejects
queries. Restore service without introducing an empty-database replacement or
silently abandoning existing records. Do not point production at an unverified
target. Source data access or a verified backup is a hard prerequisite for the
final data cutover; another free-tier account is not a substitute for recovering
the existing data.

1. Build and test the alternate stack alongside production, with billing disabled.
2. Obtain/admit the source export, restore to a new isolated database, and compare
   counts, stable IDs, constraints, sequences and private object references.
3. Take an encrypted target backup and restore it into a separate test database.
   Require an off-host copy and record its actual failure domain; a second volume
   on the same physical host is not independent high availability.
4. Verify sign-in, owner/operator denial, all four intake services, private upload
   and download, work revisions/history, estimates, Push/cleanup and draft-only
   billing in a controlled candidate. Synthetic notifications require explicit
   test-recipient handling; never email real customers as a smoke test.
5. Quiesce source writers, reconcile final changes, and perform one controlled
   switch. Preserve the old deployment and source data. Cached public assets and
   API paths remain compatible during the switch.
6. Once target writes are accepted, rollback the application version against the
   same new database where compatible. Never revert writers to an older database
   snapshot and lose newly accepted requests. A database failback needs a separate
   verified catch-up/export and writer handover.
7. Observe real reads/writes and job completion before retiring old schedules or
   changing unrelated provider configuration. Keep invoicing in manual-dispatch
   draft mode throughout.

## Availability limits and operations

One local Docker host is a single failure domain. This plan removes Neon quota and
inactivity dependence; it does not promise survival of a host/power/ISP outage.
Define a tested restore, off-host encrypted backups, external reachability checks,
disk/backup-age monitoring and bounded resource limits before cutover. A second
live database replica/failover host can be added only after identifying an actual
independent host and testing fencing and replication; do not label an untested
standby highly available. Public static pages remain on the CDN during API failure.

All secrets stay in private environment/secret files or provider secret settings,
not tracked Compose, public output, logs or screenshots. Scan source/history and
both built static outputs. Keep all `/customize/*` requests on its own origin and
retain current CSP and generator protections.

## Completion evidence

Run full project validation, unit/contract/E2E and UX checks. Add native database,
OIDC login/replay/CSRF/expiry, signed forwarding, lifecycle, backup/restore and
deployment failure tests. Capture and inspect desktop/390px screenshots for the
sign-in change. Review the complete change independently before deployment.
Advance the operator shell cache from v7 and test an already-installed PWA
upgrading to OIDC without manual cache clearing or retention of old credentials.
Record actual production checks and any uncompleted cutover dependency. An API
configuration flag or HTTP 200 health response alone is not proof of reachable
storage or successful migration.

## Outstanding prerequisites

- Confirm whether another migration branch/export exists beyond Phase 1.
- Recover source data access or identify a verified database export.
- Owner approval of this concrete architecture, including the dedicated
  Authentik application and Cloudflare Tunnel; neither has been created yet.
- Confirm a backup copy outside the Docker host's physical failure domain.
- Invoice Ninja's credential remains a separate pending secure setup; no send or
  charge functionality is added by this infrastructure migration.

## Primary references

- [node-postgres pooling](https://node-postgres.com/features/pooling)
- [Authentik OIDC and OAuth2](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)
- [PostgreSQL backup and restore](https://www.postgresql.org/docs/current/backup.html)
