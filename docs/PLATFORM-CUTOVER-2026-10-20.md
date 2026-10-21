# Production handover evidence — 2026-10-20

Main changes: [draft invoicing PR44](https://github.com/JerrettDavis/3dprint4me/pull/44)
and [platform migration PR45](https://github.com/JerrettDavis/3dprint4me/pull/45).
The platform deployed from main `a3bf24bb185dee9a8140a00d229ebc34d5fbda7c`;
its reviewed image release `6a24f9b` has the same source tree.

## Verified production behavior

- The storefront remains on Vercel; `/api/health` returns PostgreSQL through the
  signed HTTPS proxy. The native database has no published port.
- Direct GitHub sign-in grants access only to the bound numeric owner identity.
  The production inbox displayed both recovered work items.
- A new anonymous model upload remained private, passed geometry analysis and
  completed native slicing in 7.78 seconds. No business request or customer email
  was created by this check. The existing Home Assistant token still reads the
  production integration successfully.
- The controlled handover completed in 7.4 seconds, with all 18 source table
  counts matching. Source write fencing remains installed. The independent
  durable control record selects the native live database across API restarts.
- The legacy slicer was stopped and the Neon cleanup workflow disabled. The
  GitHub Neon database secret, Vercel Neon binding and legacy auth environment
  variables were removed. Neon compute showed inactive after the final archive.
- Both Vercel's managed subscription and Neon billing show Free. Approximately
  $0.24 was already accrued; final paid-period billing is not erased. The unrelated
  personal-site resource remains intact.
- Independent [public status](https://status.3dprint4.me) and the
  [protected operations view](https://3dprint4me-operations.vercel.app) work without
  the local database or Authentik. Operational alerts target the approved owner.
  Anonymous visitors cannot access the operations reader.
- The hourly Windows task ran successfully in Password mode with limited
  privileges. Windows holds the locally entered credential. Result0 and a fresh
  independent heartbeat were verified after registration.

## Recovery evidence

Both encrypted Restic stores passed full byte readback. A selected production
checkpoint restored the independent control database and live database into
isolated PostgreSQL18 with no network or ports and temporary memory storage.
Runtime DDL, operator-role changes and identity-binding deletion were denied.
The final read-only Neon archive also restored independently: 18 tables, one
operator, two requests and two work items. Private archives, credentials and
repository passwords are held outside source control.

Use [the recovery runbook](PLATFORM-RECOVERY.md) for repository-owned preparation,
encrypted backup, isolated restore, task installation and controlled cutover tools.
The source supplies reproducible infrastructure and configuration contracts;
recovery still requires private key custody and external account/DNS access.

## Deliberate limitations

Physical offsite storage and independent key custody have not been verified. A
complete signed-out reboot and external-account rebuild have not been drilled.
Neon is a fenced historical source; automatic failover, continuous replication
and an agreed RPO/RTO are not configured. Two inherited failed notification-outbox
entries remain visible for operator review; migration did not discard or falsely
mark them delivered. Provider configuration alone never turns capabilities green.
Invoices remain draft-only and require the owner's manual dispatch.
