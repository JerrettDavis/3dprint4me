# Platform recovery and backup automation

See [STACK-AUTOMATION.md](STACK-AUTOMATION.md) for the complete stack inventory,
new-host bootstrap, replacement-host rebuild, streamed private-file checkpoints,
hosted deployment commands and operational acceptance checklist. Evidence below
describes database/configuration and private-object checkpoint verification. The
2026-10-24 update below establishes scheduled file backups, not a cold host rebuild.

The storefront and operator shell remain on Vercel. Independent status runs on
Vercel and Cloudflare; its protected operations view requires Vercel Authentication
on **all deployments**. Local runtime uses the private PostgreSQL18 database,
API, jobs, slicer, and outbound Cloudflare connector. GitHub hosts operator identity.
See [the sign-in contract](GITHUB-OPERATOR-AUTH.md) and [status deployment](../status/README.md).

## Current verification and limits

Production switched to private PostgreSQL on 2026-10-20. The fenced handover
completed in 7.4 seconds with all 18 source table counts matching. The source stays
read-only; the durable target selection prevents returning to stale Neon data.
The storefront proxy, direct GitHub owner sign-in, recovered work inbox and a new
anonymous private-upload/slicing request were verified against production.
Invoices remain draft-only and require manual dispatch.

Neon billing was downgraded to Free after offload. Approximately $0.24 had already
accrued in the paid period; downgrading does not erase earlier charges. The shared
installation also contains an unrelated personal-site database: never delete the
installation or its resources to clean up this migration.

The repository-owned tools encrypted the selected live database and independent
control database to two existing Restic stores, read both back byte for byte, and
restored both into disposable PostgreSQL18 with no network, no published ports,
and temporary memory storage. Each restored database contained 25 tables; the
live database preserved one operator, two requests and two work items. Runtime
DDL, operator-role changes and identity-binding deletion were denied. The final
fenced Neon archive separately restored all 18 source tables and matching records.
These checks prove data recovery, not a complete external-account rebuild.

The hourly Windows task `3dprint4me-encrypted-backup` now uses Password logon with
a Windows-managed credential entered locally by the owner. A fresh execution
completed with result0 and a fresh independent heartbeat. Windows rejected S4U
logon on this host. A full signed-out reboot drill has not been performed.
Missed backups become aging after two hours and critical after six. Both stores
are off the Docker host; physical offsite storage and independent decryption-key
custody remain unverified. Two inherited failed notification-outbox entries remain
visible as a jobs blocker and require operator review; they were not discarded.

Neon is a fenced historical recovery source, not an automatic failover. A cold
recovery must restore a current checkpoint and verify identity, files, jobs and
routing before accepting writes. No automatic failover, continuous replication,
or agreed RPO/RTO is claimed. Local host outages can interrupt API work while the
static storefront and independently hosted status page remain reachable.

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
scripts under the private root, registers an hourly task, and starts it. The
default is S4U; Windows may require an administrator and may reject that logon
mode. Use `-PasswordLogon -Apply` on this host: a local credential prompt supplies
the current owner account password directly to Windows Task Scheduler. No password
is written into source, command arguments, or configuration. `-Interactive` is an explicit fallback
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

## Controlled handover source and repeatability

`deploy/platform/controlled-cutover.py` preserves the reviewed production handover.
It previews by default; only `--apply` mutates infrastructure. The SSH identity and
private host root are deliberately project-specific and must be reviewed for a
replacement host. Never run it against the selected production target again.
Preflight requires prepared private roles/schema, reviewed API and slicer images,
a verified encrypted source archive, stopped legacy writers and an approved routing
window. Prepare secrets using the private host tooling, never GitHub source files.
The handover verifies all source table counts, fences source statements, restores a
unique target, and persists target selection before resuming traffic. Failure can
reopen the source only before durable selection and independently verified fence
ownership; uncertainty leaves writes paused. After selection, recovery always uses
the target checkpoint. External routing changes remain explicit operator actions.

Health volume setup in `prepare-host.py` uses isolated ownership initialization
followed by the real writer UID to set the shared group and directory setgid bit.
This preserves readable aggregate job health without broadening runtime privileges.
After restoring/recreating workers, verify both health files through the API's
status collector; do not infer health from a running container alone.


## Complete checkpoint activation, 2026-10-24

The existing private Windows task now runs the verified current controller/export/
restore scripts; the prior versions are retained privately for rollback. Its action,
Windows-managed password and hourly trigger were preserved. A fresh task run exits
with result `0`, which also requires successful authenticated backup reporting.
Both existing encrypted repositories contain the new `20261024T143605Z` complete
checkpoint receipts linking database/configuration and private-object snapshots.

Before the scheduled update, the manual `20261024T143246Z` complete checkpoint passed
both-store byte/hash readback. Its exact database archive restored into a disposable,
network-isolated PostgreSQL 18 container: 25 control tables and 29 live tables,
14 verified archive/configuration members, and runtime privilege denials. Both
repositories' private-object streams independently verified three objects and the
receipt hash without plaintext files or provider writes. Exact snapshots and logs
remain private; [VERIFICATION.md](VERIFICATION.md) records the scope and limits.

This proves scheduled complete backups and isolated database recovery. It does not
prove private-object writes to a replacement provider, a full host rebuild, signed-out
reboot survival, independent offsite/key custody or an agreed recovery time.
