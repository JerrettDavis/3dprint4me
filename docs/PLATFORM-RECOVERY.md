# Platform recovery and backup automation

The storefront and operator shell remain on Vercel. Independent status runs on
Vercel and Cloudflare; its protected operations view requires Vercel Authentication
on **all deployments**. Local runtime uses the private PostgreSQL18 database,
API, jobs, slicer, and outbound Cloudflare connector. GitHub hosts operator identity.
See [the sign-in contract](GITHUB-OPERATOR-AUTH.md) and [status deployment](../status/README.md).

## Current verification and limits

On 2026-10-20 the repository-owned recovery tools exported the native candidate,
encrypted it independently to two existing Restic stores, read both back byte for
byte, and restored it into a disposable PostgreSQL18 container. The restore held
25 tables, one operator, two requests, two work items, and one identity binding.
Runtime attempts to create tables, change operator roles, and delete identity
bindings were denied. Scratch PostgreSQL had no network, no ports, and tmpfs data;
the container was removed afterward. This is a candidate recovery test, not proof
that production has migrated or that every external account can be recreated.

The hourly Windows task `3dprint4me-encrypted-backup` completed with result0.
Unattended S4U registration was denied by Windows; the installed task uses the
owner's interactive logon. It depends on that account remaining signed in.
Independent status explicitly flags this limitation. A missed backup becomes
aging after two hours and critical after six. Both stores are off the Docker host;
physical offsite storage and independent decryption-key custody are unverified.

## Secure configuration

Keep configuration and decryption keys outside GitHub and static output. Linux
private roots/files must belong to the operator and deny group/other access.
Windows ACLs must grant access only to the owner, SYSTEM, and Administrators, with
ancestors protected from untrusted replacement. Commands refuse unsafe paths,
symlinks, and an unverified Restic executable. Pin Restic0.19.1 using the hashes in
`deploy/platform/backup-controller.py`. Keep the password file separate from
repositories and cache. Preserve SSH host-key trust independently.

Private controller JSON has this shape (paths are examples, never credentials):

```json
{
  "restic": "G:/private/tools/restic.exe",
  "password_file": "G:/private/keys/restic-password.txt",
  "ssh_host": "operator@docker-host",
  "status_backup_secret": "<from private secret store>",
  "stores": [
    {"repository": "G:/private/restic", "cache": "G:/private/cache"},
    {"repository": "D:/private/restic", "cache": "D:/private/cache"}
  ]
}
```

Initialize each private Restic repository separately using its official CLI and
the private password file. The controller only uses existing repositories. It
does not delete snapshots, prune storage, rotate credentials, or touch production.

## Run and restore

```powershell
python deploy/platform/backup-controller.py --config G:/private/keys/platform.json
python deploy/platform/restore-drill.py --config G:/private/keys/platform.json --snapshot <exact-64-hex-snapshot> --filename 3dprint4me/platform-YYYYMMDDTHHMMSSZ.tar --sha256 <exact-archive-sha256>
```

The export includes the independent control database and the active business
database selected by the durable control record. A stale prepared manifest cannot
omit the live database. A selection change during export rejects the checkpoint.
The archive also contains owner-only runtime configuration, GitHub credentials,
database credentials, tunnel token, jobs/slicer settings, and the platform collector
configuration. Dumps and private files stay in memory until Restic encrypts them.
Controller output contains only snapshot identities, aggregate counts and hashes.

`restore-drill.py` decrypts the exact snapshot in memory, verifies its hash and all
archive members, and restores into a new randomly named isolated container. It
never selects a production database. A real host rebuild must recreate the pinned
Compose stack and private roles, restore control plus business dumps as the schema
owner with ACLs, restore private files with0600 permissions, preserve durable
selection, and verify all provider paths before routing traffic. Do not fall back
automatically to stale Neon data or reopen the old source after target writes.

## Install schedules

```powershell
./deploy/platform/install-backup-task.ps1 -Python <absolute-python.exe> -PrivateRoot G:/private -Config G:/private/keys/platform.json
./deploy/platform/install-backup-task.ps1 -Python <absolute-python.exe> -PrivateRoot G:/private -Config G:/private/keys/platform.json -Apply
```

The first command previews. The applied command copies the three reviewed recovery
scripts under the private root, registers an hourly S4U task, and starts it. Windows
may require an administrator to register S4U. `-Interactive` is an explicit fallback
that only runs while the owner is signed in. Inspect `Get-ScheduledTaskInfo` and
confirm result0 plus a fresh independent heartbeat; task registration alone proves
nothing. Reapply after reviewing script updates. Execution is bounded to20minutes
and overlapping task instances are ignored.

On the Docker host, run `deploy/platform/status-collector.py --config <private-json>`
every five minutes under its Docker operator using `flock`. Its private JSON holds
`platform_root` and the separate platform-reporting `secret`. Preserve unrelated
crontab entries. The collector executes only a fixed read-only aggregate command;
it never exposes the Docker socket or database to the monitor. Missing evidence
fails closed. Configuration-only provider checks remain unknown; failed/retrying
work and overdue queue entries prevent a green jobs status.

The GitHub repository is the source for automation; it contains no secret values.
Recovery still requires account access, the separately held decryption key, DNS
control, and private credentials. The dashboard keeps these unproven conditions
visible until an end-to-end rebuild drill and offsite recovery are completed.
