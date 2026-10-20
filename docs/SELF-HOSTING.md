# Local platform operations

The storefront and operator application remain static Vercel deployments. The
local platform runs the existing API handlers, private PostgreSQL 18, and bounded
background work. Invoicing remains draft-only; this migration does not enable
Invoice Ninja or authorize invoice dispatch.

## Deployment boundary

`deploy/platform/compose.yml` uses a dedicated Compose project and database volume.
It publishes no host ports. PostgreSQL belongs only to an internal Docker network;
the API and jobs also have outbound access for Blob, authentication and delivery.
Cloudflare Tunnel shares the API network, without database-network membership.
The API serves fixed handlers and authenticated readiness, with no static-file or
SQL gateway. The existing shared PostgreSQL and Authentik databases are unrelated.

Images are pinned to reviewed digests. PostgreSQL runs as UID 999 with a read-only
root filesystem and a volume mounted at `/var/lib/postgresql`, the PostgreSQL 18
image's data-volume boundary. API processes run as the image's non-root Node user.
Resource, process, request, payload, log and shutdown limits are explicit.

Official references: [PostgreSQL image](https://hub.docker.com/_/postgres),
[Docker build contexts](https://docs.docker.com/build/concepts/context/),
[Cloudflare tunnel parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/),
[openid-client](https://github.com/panva/openid-client).

## Private configuration

Place configuration outside every Git checkout in an owner-controlled directory
(0700); files must be 0600. Set `PLATFORM_CONFIG_DIR` and an immutable
`PLATFORM_RELEASE` in a private Compose environment file. Never run `docker compose
config` to a terminal with real environment files: the expanded output contains
credentials. Validate it in memory and emit only structural results.

- `postgres.env`: `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`. These are
  bootstrap administrator credentials, unavailable to the API.
- `api.env`: native `DATABASE_URL`, `DATABASE_DRIVER=postgres`, application
  integrations, OIDC configuration, `PLATFORM_PROXY_SECRET`, exact operator
  origins, and `PLATFORM_JOBS_ENABLED`. Runtime credentials must not own tables.
- `tunnel.token`: dedicated connector token, mounted read-only and passed by file,
  never a command-line token or a credential embedded in Compose/source.
- Separate owner/migrator credentials are retained privately for schema changes.

Preserve the existing private Blob token, VAPID keypair, sender settings and any
configured capability/rate-limit secrets. Vercel Sensitive variables may be masked
on export; an empty downloaded value is not a usable replacement credential.
Resolve those credentials before activation. Do not copy Vercel OIDC runtime
tokens, unrelated provider credentials or PostgreSQL-admin passwords into the API.

The Vercel storefront needs only `SELF_HOSTED_API_ORIGIN=https://api.3dprint4.me`
and the server-only forwarding secret when forwarding is enabled. Forwarding is
disabled when the origin is unset. An invalid configured origin fails closed.
Forwarded requests bind exact bytes, method, path/query, permitted headers and
caller IP to a timestamped HMAC and one-time database nonce. Writes have no
automatic retry. Private response bodies and credentials must never be logged.

The operator Vercel project uses `OPERATOR_API_BASE=https://api.3dprint4.me` and
`OPERATOR_AUTH_PROVIDER=authentik`. The API allows only
`OPERATOR_ALLOWED_ORIGINS=https://work.3dprint4.me`. Preview aliases cannot use
production cookie authentication. Legacy Neon auth remains an explicit rollback
mode; it is not an automatic fallback on authentication failure.

## Database and authentication

Provision a non-login `platform_backend` group and distinct administrator,
`platform_owner` and `platform_app` logins. Runtime is NOSUPERUSER, NOCREATEDB,
NOCREATEROLE, NOREPLICATION and NOBYPASSRLS. Restore the application public schema
with `--no-owner --no-acl` as the owner, then apply migrations001–008 as appropriate
to the restored schema. Do not import managed Neon roles, passwords or auth
sessions. Migration 008 is for this dedicated native database, not hosted Neon.

Backend RLS policies permit the dedicated backend group; application authorization
continues to enforce operator/owner access. Runtime cannot create tables, alter
operator roles/enabled state or create identity bindings. Verify those denials
using the actual runtime login after every schema/security change.

Use a dedicated confidential Authentik application with authorization-code flow,
PKCE, RS256, `openid profile`, and strict redirect
`https://api.3dprint4.me/api/auth/callback`. Bind the approved owner's exact issuer
and stable subject to the existing operator ID. Never infer access from an email,
display name or an incoming role claim. Existing operator/work relationships are
preserved. Missing, disabled or removed bindings cannot authenticate.

Login state, nonce and PKCE verifier remain in a one-time private flow. Sessions
store token hashes with an eight-hour expiry; only Secure, HttpOnly, host-only
SameSite=Lax cookies reach the browser. Logout requires POST from the exact work
origin. Browser storage never receives provider or new application tokens. The
operator shell advances to v8 so installed clients can load the new sign-in flow.

## Workers and cutover gates

The `writers` profile starts local jobs only after an explicit handover;
`PLATFORM_JOBS_ENABLED=1` is also required. Push outbox claims retain existing
leases; retention and auth cleanup use private database leases. Push drains every
15 seconds, expired auth/replay rows every minute, and model retention every six
hours. The local push drain needs no publicly callable worker endpoint. Preserve
the VAPID keys and subscription records. Slicer polling should remain five minutes.

Inventory and pause the old Neon scheduled push function, GitHub retention
workflow, and old slicer before enabling replacement writers. A lease in one
database cannot coordinate a worker connected to another database.

Before changing production routing:

1. Verify source reads, encrypted exports and an actual isolated restore.
2. Restore existing records to the candidate and verify runtime permissions,
   owner login, four intake paths, private files, estimates and draft-only billing.
   Candidate tests must not email existing customers or dispatch invoices.
3. Verify bounded API transport and a handover that fences source writes and
   captures a fresh consistent export. The initial recovery snapshot alone is
   insufficient: writes accepted since that snapshot must be preserved.
4. Complete tests, screenshots, secret scans, fresh review, candidate image checks,
   private backups and their restore verification.
5. Record the exact writer/routing switch and live checks. Keep Neon intact.

## Recovery and limits

Use native custom-format dumps with tools at least as new as the source server.
Back up application records, native role/bootstrap configuration, application
secrets and OIDC bindings into encrypted off-host storage. Keep decryption keys
outside the Docker host. Never retain plaintext dumps in a checkout or static
directory. Record snapshot identity, content digest and actual restore evidence;
successful upload alone does not prove recovery.

Restore drills use a separately named container/database with no published ports
and no production jobs. Remove only the drill's own resources afterward. A schema
restore into an empty database must account for its default empty `public` schema;
never drop the production schema to test restore behavior.

After accepting target writes, roll application code back against the target
database. Returning to an older Neon snapshot would discard new work. Any reverse
database move requires its own fenced export and verification. Do not delete the
source or replace newer target records with older history.

This single local host is not high availability. Encrypted off-host backups allow
recovery; host, power and ISP outages still require intervention. Treat restore
time and key custody as verified operational facts only after drills prove them.
