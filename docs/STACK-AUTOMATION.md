# Stack setup, backup and disaster recovery

This is the entry point for the entire production stack. Source, migrations,
Docker definitions, slicer profiles, public configuration, cloud deployment
settings and automation belong in Git. Credentials, customer records, model
files, OAuth tokens, backup passwords and private controller configuration do not.
The machine-readable component inventory is [`stack.json`](../deploy/platform/stack.json).
Retired Neon deployment instructions are historical, not production setup steps.

## Prerequisites and private custody

Use an owner-controlled Linux Docker host with Docker Engine and Compose v2,
Python 3.11+, Git, enough space for PostgreSQL and both image builds, and working
outbound HTTPS. No database port is published. Development/CI additionally needs
Node 22, `npm ci`, `python -m pip install -r requirements-dev.txt`, and
`python -m playwright install chromium`. Run `npm test` before releases.

Retain account recovery for GitHub, Vercel, Cloudflare, Resend and optional Stripe,
Invoice Ninja and Home Assistant. Keep a separate copy of the Restic password,
SSH host trust and private configuration in independent custody. Losing the only
decryption key cannot be repaired by this repository. The Windows backup machine
needs Python, OpenSSH and hash-pinned Restic 0.19.1. Restic repositories must already
exist, with owner-only ACLs, separate caches and a separately held password file.
Do not initialize over an existing repository or prune during recovery.

External account creation, ownership verification, plan/payment authorization,
OAuth credential entry and account recovery remain owner actions. Automation
consumes those credentials privately; source cannot recreate account ownership.
No script changes unrelated services, promotes historical Neon, dispatches
invoices or silently switches production routing.

## New installation

Use `bootstrap-host.py` only for a genuinely new empty installation. For customer
data recovery, use `rebuild-host.py` instead. Both default to preview and refuse
existing platform Docker resources, including stopped containers and volumes.

1. Create an owner-only root outside any Git checkout (`install -d -m 700
   /home/OWNER/3dprint4me-platform`). Clone this repository into its
   `candidate-source/`, and check out an exact reviewed 40-character commit from
   `origin/main`. Keep the checkout clean. Enable Docker at boot through the host's
   normal service manager; verify it after a reboot.
2. Supply owner-only private files in the root, never in `candidate-source`:
   `postgres.env`, `database.private.json`, `api.env`, `activation.env`, `jobs.env`,
   `slicer.env`, `github.private.json`, `tunnel.token` and
   `status-collector.private.json`. JSON credential file keys `admin`, `owner`,
   `runtime` each need independently generated 32–128 character base64url secrets.
   `postgres.env` must use `POSTGRES_USER=platform_admin`, `POSTGRES_DB=postgres`
   and a `POSTGRES_PASSWORD` matching `admin`. Generate values in private tooling.
3. Use [`api.env.example`](../deploy/platform/api.env.example) as the server
   configuration contract. Populate real credentials locally; placeholder values
   are not a working installation. `activation.env` initially matches `api.env`;
   `jobs.env` needs Blob, notification, VAPID and integration settings as well as
   `PLATFORM_JOBS_ENABLED=1`. `slicer.env` needs the private Blob token,
   `SLICER_PROVIDER=bambu-cli`, `SLICER_ENGINE=bambu-studio-cli`,
   `SLICER_PROFILE_ID=bambu-x2d-0.4-0.16hq-generic-v1`,
   `SLICER_TIMEOUT_MS=300000`; image defaults supply binary and profiles.
   `github.private.json` holds `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` for
   private custody. Collector JSON is `{"platform_root":"/home/OWNER/3dprint4me-platform",
   "secret":"<platform reporting key>"}`. The four reporting/reader keys are distinct.
4. Independently confirm the numeric GitHub owner ID. The current owner is
   `2610199`; usernames and email addresses do not grant access. Configure the
   [exact OAuth callback](GITHUB-OPERATOR-AUTH.md).
5. Preview and then apply on the new host:

   ```sh
   python3 candidate-source/deploy/platform/bootstrap-host.py --root "$PLATFORM_ROOT" --release "$RELEASE_SHA" --owner-subject 2610199
   python3 candidate-source/deploy/platform/bootstrap-host.py --root "$PLATFORM_ROOT" --release "$RELEASE_SHA" --owner-subject 2610199 --apply
   ```

   Setup creates restricted roles, applies every tracked migration to control and
   live databases, creates an exact owner binding and durable live selection,
   writes private database URLs, builds API and slicer images, and prepares health
   volumes. It starts PostgreSQL only. Partial failures retain evidence and are
   not automatically retried over an existing installation.

## Hosted services and routing

Restore/link the four **existing** Vercel projects, with roots `.`, `operator/`,
`status/` and `status/operations/`. Each root has its tracked `vercel.json`; only
its designated output is served. Run the official Vercel CLI's `vercel link` in
each root and verify the chosen project before deploying. Local `.vercel/`
identity files remain ignored. Do not attach legacy Neon integrations.

The storefront Production function environment needs `SELF_HOSTED_API_ORIGIN` and
the same private `PLATFORM_PROXY_SECRET` as the native API. The operator browser
uses the public GitHub provider/API-origin configuration in its tracked assets.
The public status project needs no database or secret. Operations requires
**Vercel Authentication for every deployment**, its private reader credential,
and `OPERATIONS_PROTECTION_VERIFIED=1`. Preserve the environment names from
[`status/README.md`](../status/README.md) and its API implementation.

Use installed official Vercel/Wrangler CLIs with locally authenticated accounts:

```sh
python3 deploy/platform/deploy-cloud.py --component storefront
python3 deploy/platform/deploy-cloud.py --component operator
python3 deploy/platform/deploy-cloud.py --component status
python3 deploy/platform/deploy-cloud.py --component operations
python3 deploy/platform/deploy-cloud.py --component monitor
```

These commands preview. Add `--apply` for the selected component; operations also
requires `--operations-protection-verified` after checking protection in Vercel.
That flag records an operator prerequisite; it is not an API verification.
The monitor deploys the tracked Worker, Durable Object migration and five-minute
schedule. Restore `STATUS_PLATFORM_SECRET`, `STATUS_BACKUP_SECRET`,
`STATUS_CONTROL_SECRET` and `STATUS_READER_SECRET` through protected stdin with
`wrangler secret bulk`. Restore alert configuration privately. Durable Object
incident history is disposable operational evidence, not the customer system of
record: a replacement starts unknown and must receive fresh probes/heartbeats.

Restore Cloudflare DNS for `3dprint4.me`, `work.3dprint4.me`, `api.3dprint4.me`,
`status.3dprint4.me` and `status-api.3dprint4.me`, preserving unrelated records.
The outbound tunnel route must target `http://api:8080`; its token lives only in
`tunnel.token`. Confirm all exact domains/certificates through the provider
before starting the tunnel. Preserve email MX, SPF, DKIM and DMARC records and
Resend's verified sender. Optional Stripe callbacks must verify payment server-side;
a return URL is never payment evidence. Invoice Ninja remains disabled/manual
until a separately verified unsent draft is approved for operational use.

## Schedules and routine operation

Use the same private compose environment for every host command:

```sh
docker compose --env-file "$PLATFORM_ROOT/compose.env" -f "$PLATFORM_ROOT/candidate-source/deploy/platform/compose.yml" up -d api
```

Verify native readiness and GitHub sign-in before starting background writers or
routing public traffic. After the acceptance checks, start `--profile writers up
-d jobs slicer`, then `up -d tunnel` using the same compose prefix. Compose restart
policies restart already enabled services after Docker boots; the writers profile
does not itself schedule work. `platform-jobs.mjs` owns push, expiry and retention
with durable leases. Keep the retired Neon/GitHub cleanup schedule disabled.

Generate the host monitor's systemd units:

```sh
python3 candidate-source/deploy/platform/install-status-timer.py --root "$PLATFORM_ROOT" --user "$PLATFORM_USER" --output "$PRIVATE_UNIT_OUTPUT"
```

Review the generated files, install them in `/etc/systemd/system/` through the
host administrator, then run `systemctl daemon-reload` and
`systemctl enable --now 3dprint4me-status.timer`. Check `systemctl list-timers` and
a fresh platform heartbeat. This fixes the previous example's mismatched private
collector filename. The generator never invokes sudo or overwrites files.

Reinstall the Windows hourly backup task using the committed
[`install-backup-task.ps1`](../deploy/platform/install-backup-task.ps1) and private
controller JSON from [PLATFORM-RECOVERY.md](PLATFORM-RECOVERY.md). Optional
`platform_root` overrides the historical host path. Password logon is required on
the current backup host; enter the Windows password locally. Verify result 0 and
fresh independent backup evidence, including after a signed-out reboot. Regenerate
or update installed script copies after changes; merging source does not update
the installed task or running image automatically.

## Complete encrypted checkpoints

`backup-controller.py` creates:

- The independent control database and durably selected live database, preserving
  schema ownership/ACLs and exact matching MVCC file-reference inventories.
- All required owner-private server configuration, including GitHub, tunnel,
  jobs, slicer and platform reporting settings.
- A separate streamed private Blob snapshot with original paths, content types,
  per-object SHA-256 and bytes. Referenced files must exist; disappearance during
  retention makes the checkpoint fail rather than silently lose customer data.
- An encrypted checkpoint receipt linking both archive identities and hashes in
  every Restic store. Only a completed, readback-verified pair reports success.

Customer bytes travel over pinned SSH directly into Restic. The entire store is
not accumulated in RAM or a plaintext file. Individual objects are bounded at
64 MiB (the application upload limit is lower); database/config archives retain
the existing explicit 128 MiB bound. Capacity/time-limit failures report failure;
monitor them and move to a streaming database exporter before approaching that
bound. Object exports allow at most one million paths and 15 minutes per stage.
No automatic pruning is enabled: review storage growth and legal retention before
adding a separate prune policy. API reads/provider egress may consume provider
quotas; full-store readback is intentional and is not claimed cost-free.

The database snapshot determines required retained files, including assets in
`analyzing` state, submitted inquiry attachments and inherited inquiry files.
Estimate attachments follow their asset retention state, so deliberately deleted
assets are not incorrectly required forever. Blob export may include newer/unreferenced objects as a safe
superset. An already missing required file fails recovery coverage. Historical
checkpoints created before this feature contain database/config only; the tool
does not retroactively recover their missing model bytes.

## Replacement host and restore

Fence the failed/original writers and routing before restoring. A recovered host
must never compete with the original installation for jobs or traffic. Select a
specific successful `platform:3dprint4me-complete-checkpoint` receipt, inspect its
counts/identities privately, and retain its exact SHA values. Do not use `latest`
as an ambiguous restore identity. Restic copy changes destination snapshot IDs;
the receipt records each store's exact identities.

On a replacement host, clone an exact reviewed commit, create an **empty**
owner-only destination root, and pipe the trusted database/config archive into:

```sh
set -o pipefail
restic --repo "$RECOVERY_REPOSITORY" --password-file "$RECOVERY_PASSWORD_FILE" dump "$DATABASE_SNAPSHOT" "/$DATABASE_ARCHIVE" | python3 deploy/platform/rebuild-host.py --root "$NEW_PLATFORM_ROOT" --source "$REVIEWED_SOURCE" --release "$RELEASE_SHA" --sha256 "$DATABASE_SHA256"
```

Preview does not write files or Docker resources. Repeat the exact command with `--apply`
only after review on the replacement Linux host. The script verifies every member
and hash, rejects unexpected paths and existing platform resources, extracts only
tracked source from the chosen commit, creates private configuration exclusively,
restores both databases with ACLs, verifies durable selection, builds API/slicer
images and initializes health volumes. API, tunnel and writers remain stopped.
Private recovery configuration is written with mode 0600 under a 0700 root;
decrypted database dumps remain in memory. Partial state is kept for inspection;
the script never deletes an existing volume to make a retry work.

Restore or verify the separate object stream using the receipt's exact object
snapshot and filename. First pipe `restic dump` to
`node scripts/blob-recovery.mjs verify-stream` in trusted tooling. Verify its
whole-stream SHA-256 against the receipt before applying a restore. Then pipe
the same snapshot to `node --env-file=<private-destination-blob.env>
scripts/blob-recovery.mjs restore-stream --apply`. Destination credentials stay
in the private env file. All writes use private access, original paths and no
overwrite. Identical existing files are hash-verified and skipped, so interrupted
restores resume; conflicts fail. No customer path or file body is logged.
For a new Blob store, restore bytes there and update the host's private Blob token
before readiness checks; never publish the store to make recovery easier.

Run the existing isolated `restore-drill.py` for database recovery/privilege checks
and the stream verifier for object integrity. These do not prove DNS/account/key
custody or host rebuild. Record the commit, timestamp, checkpoint hashes, aggregate
counts, denied runtime privileges and acceptance results without private values.

## Acceptance, rollback and evidence

Before accepting production writes, verify all of these:

1. No database port is published; runtime cannot create tables, change operator
   roles or delete identity bindings. Exactly the existing owner signs in through
   GitHub. Unknown GitHub identities fail closed.
2. Storefront and operator shell load; production health names PostgreSQL. Exercise
   a labeled private model upload, authenticated download, native slicing and
   customer-recoverable intake. Retain real requests and idempotency records.
3. Anonymous private file access is denied. Anonymous operations requests to `/`
   and `/api/index`, aliases and deployment URLs are denied by Vercel Authentication.
   Public status renders even with the native stack stopped.
4. Start one set of writers only. Check queue leases and failure counts; never
   mark inherited failures delivered. Confirm fresh slicer/jobs health and bounded
   provider failures. Verify notification delivery with a labeled test under the
   normal operator process; invoice dispatch remains manual.
5. Confirm platform and hourly backup heartbeats and a complete checkpoint in
   both stores. Restore it into isolation, verify objects, then perform a
   signed-out host reboot test during a planned window. Home Assistant's minimized
   integration remains optional; its [installation process](../integrations/home-assistant/README.md)
   preserves unrelated configuration.

If pre-routing checks fail, leave traffic fenced and repair the replacement.
After accepting new writes, never roll back to an older database or fenced Neon.
Code rollback must remain compatible with the selected database; take a fresh
checkpoint before additive migrations. Use the original-host recovery path only
after proving no divergent writes. There is no automatic failover or agreed RPO/RTO.

Repository tests cover safety gates, format integrity and provider contracts.
On 2026-10-21, `python tests/integration/platform_recovery_docker.py` passed real
PostgreSQL setup, exported MVCC snapshots, backup and two-database restore,
including runtime privilege denials, using synthetic credentials in disposable
network-isolated containers with memory-only database storage. The rehearsal
intercepts host Compose/build/health-volume operations; CI repeats it, and it
does not establish a complete replacement-host or external-provider rebuild.
`python tests/integration/restic_stream_recovery.py --restic <pinned-executable>`
tests actual encrypted stream backup, native snapshot-path lookup, copy identity
and both-store readback with synthetic repositories. It passed on Windows with
the hash-pinned 0.19.1 binary; CI repeats it on Linux and checks the binary hash
before executing it.
A complete external-account rebuild, independent offsite/key custody and host
build/routing activation still require a separately recorded operational drill.
This document distinguishes committed automation from live deployment:
the existing scheduled backup must use the updated scripts and an API image that
includes `scripts/blob-recovery.mjs` before object coverage is active.

Implementation references: [Vercel Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk),
[PostgreSQL 18 restore](https://www.postgresql.org/docs/18/app-pgrestore.html),
[Restic streaming backups](https://restic.readthedocs.io/en/stable/040_backup.html),
[Restic snapshot copy](https://restic.readthedocs.io/en/stable/045_working_with_repos.html).
