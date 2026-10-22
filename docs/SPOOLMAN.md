# Spoolman inventory sync

Live and verified on 2026-10-22. Spoolman owns imported stock; 3dprint4me automatically refreshes it every minute.

The provider uses Spoolman 0.27.0's read-only API. It requests currency at
`/api/v1/setting/currency` (the `value` is a JSON-encoded string) and all spools
at `/api/v1/spool?allow_archived=true`, with no pagination limit. The response
must fit 16 MiB and 5,000 spools within a 30-second deadline, and its
`x-total-count` must match the returned array. A partial or invalid snapshot
never changes inventory. Redirects are rejected and provider errors are sanitized.

Official source contracts: [spool endpoint](https://github.com/Donkie/Spoolman/blob/v0.27.0/spoolman/api/v1/spool.py)
and [response models](https://github.com/Donkie/Spoolman/blob/v0.27.0/spoolman/api/v1/models.py).
Spool price overrides filament price. Spool cost uses initial net grams, falling
back to the filament's nominal grams; filament price uses filament nominal grams.
Unknown price or denominator stays unknown. Only USD source prices are usable
in the application's USD cost basis. Source prices are recorded costs, not a
claim of independently verified purchase receipts. Freight is local and explicit.

Stock is one row per physical spool. Remaining source grams retain precision;
matching floors them conservatively. PLA+ remains distinct from PLA. TPU and
Flexible (TPU) map to TPU. Unknown materials require review. Multicolor,
transparent/translucent, missing colors, and nonopaque alpha values cannot
automatically match a solid color. No Spoolman writes or stock deductions occur.

## Ownership, readiness, and costs

Use Spoolman to edit imported identity, product, color, material, weight, price,
and archive state. Each physical spool has a stable local identity; deletion or
archive deactivates the row without deleting proposal history. Manual stock lots
remain separate. The owner may edit local notes, freight, estimate-default flag,
and a nullable local cost override. The API rejects source edits through the
manual save route and rejects unknown fields on the imported-local-fields route.

Missing costs do not enter averages as zero. The local override wins, then a
known USD source cost. Average only known costs among stocked lots and report
uncovered grams. When stocked imported lots have no usable known cost, use the
documented material fallback even if an empty lot has a historical price. Manual
legacy pricing remains unchanged. Cost provenance includes source currency and
last successful sync; retained cost values do not imply freshly verified stock.

Imports run every minute. The worker polls every five seconds for an explicit
owner refresh request. Syncs claim a shared two-minute database lease and publish
all rows plus success metadata in one transaction. Unchanged snapshots renew
freshness without incrementing stock revisions. Failed/partial snapshots retain
the previous rows and success timestamp. The API reads status and queues work;
it never connects to Spoolman. An idle poll cannot clear failure-health evidence.

After five minutes without complete success, imported stock is unverified.
Candidate selection, new approval/acceptance, and accepted-proposal readiness all
enforce freshness and appearance eligibility. Historical acceptance remains in
the audit trail but cannot bypass current checks. Qualifying manual stock remains
usable during a source failure. Disabling source configuration explicitly marks
the persisted integration disabled, rejects refresh, and prevents imported stock
from being treated as verified. Changing instance ID requires reconciliation;
it is not an automatic new import alongside the old physical spools.

In **Filament inventory**, check the sync state and last complete timestamp.
**Refresh from Spoolman** queues an import; **Reload inventory** reads the worker's
result. Neither button promises completion before a successful worker run.
Imported rows show original material, precise recorded grams, conservative whole
grams, appearance warnings, cost source, timestamp, and a link to the human UI.

## Private deployment and migration

1. Back up and restore-check the current selected native database. Apply additive
   `neon/migrations/011_spoolman_inventory.sql` after 010 as the migration owner,
   never as runtime. It adds nullable imported values, source identity metadata,
   local override cents, and backend-only `spoolman_sync_state`. Manual rows still
   require price and weights. No PUBLIC grants are added.
2. Create the dedicated internal network `3dprint4me-spoolman`. Merge
   `deploy/platform/spoolman-source.fragment.yml` into the owned source stack,
   preserving all existing source networks/routes. The tested transformation in
   `spoolman-network.py` supports the deployed list-style source. Validate the
   candidate Compose before atomically retaining it in the private deployment
   source; preserve a private backup. Connect the running Spoolman application to
   that network without restarting it, with alias `spoolman`. Compose provides
   that service-name alias again on future recreation.
3. Add the jobs-only variables in `jobs.spoolman.env.example` to private
   `jobs.env`; keep `SPOOLMAN_INSTANCE_ID` stable. Add the optional
   `SPOOLMAN_UI_ORIGIN=https://spoolman.jerrettdavis.com` to private `api.env` for
   human links. That origin must be HTTPS without credentials, path, or query.
4. Include `-f deploy/platform/compose.spoolman.yml` alongside the main Compose
   file on jobs deployment/recreation. Only jobs joins the application network.
   API, slicer, PostgreSQL, and the tunnel never join it. Do not join Spoolman's
   database network or widen its Authentik/Home Assistant routes.
5. Deploy the API/jobs image and operator shell together after schema migration.
   Preserve existing platform rollout overrides and the slicer image tag. Verify
   a complete first import and a second automatic success with unchanged IDs and
   revisions. Compare every source ID, mapped value, active/archive state, and
   quantity with a fresh complete source snapshot.

The recorded preactivation check found USD source currency and zero destination
inventory rows. Recheck before enabling: a newly added manual lot must not
silently double-count the same physical spool. Never seed production fixtures.

## Recovery and failure verification

Full selected-database backups include `spoolman_sync_state` and source inventory
metadata automatically; there is no separate shadow ledger to recover. Preserve
the private jobs/API configuration and optional network Compose files with the
release source. The historical platform cutover's fixed 18-table count manifest
remains historical and is not extended for new application tables.

On provider failure, inspect the safe sync state and last success, correct the
private connection/Host configuration, and reload after the next minute. Failure
does not delete source rows or mark emails/substitutions accepted. Restore a
healthy connection and confirm a complete successful import before treating
imported grams as current. A changed instance ID is an operator reconciliation
event, not a connection retry.

To disable, remove `SPOOLMAN_BASE_URL` from the jobs configuration and recreate
jobs; its first poll records disabled state. Leave the additive migration in
place and retain imported rows/history. The owner can still maintain separate
manual lots. Restore the same source configuration to resume syncing with stable
IDs. Roll back only to an application version that understands nullable imported
prices/weights; a preintegration build can misinterpret unknown cost as zero.
Keep the Spoolman application, Home Assistant usage integration, human UI, and
restricted machine endpoint intact.

For a production failure drill, use an isolated sync invocation with a synthetic
failing provider against the existing repository; do not edit physical source
spools or interrupt unrelated scheduled jobs. Confirm rows/last-success remain
unchanged, errors are sanitized, and the next real scheduled import recovers.
Verify stale matching by injecting a future clock into a read-only application
view against the imported records; no production timestamps need alteration.

## Release verification (2026-10-22)

Full `npm test`: 1,101 unit/contract tests, 224 browser tests, 241 UX checks passed; one optional browser test skipped. The source-network transformation has two additional passing Python recovery tests. Captured 77 screenshots and inspected the preview board plus imported inventory at 390 pixels. Independent review has no remaining Critical or Important findings. Real HTTP tests cover redirect rejection, 16 MiB overflow, streaming timeout, and caller cancellation.

The private release image built successfully and all migrations rehearsed on a disposable 29-table native database. Two encrypted backup copies passed readback; an isolated restore verified both databases, 14 configuration hashes, and runtime privilege denials. No physical spool records were edited. Production activation, subsequent automatic sync, and production failure-recovery checks passed as recorded below.

## Live release evidence

[PR 51](https://github.com/JerrettDavis/3dprint4me/pull/51) merged as
`daaa01d682dab921f0b55c401a3d27e125c17435`. The private API/jobs image uses the
reviewed release source `e2974c96810837e6737ecdc6369832cbd573ce62`; the operator
and storefront production deployments succeeded through the normal GitHub path.
The direct CLI operator attempt was rejected by Vercel's author policy and did
not replace production; no account permissions were changed.

- Applied migration 011 to the selected native database after a verified encrypted
  backup/isolated restore. The API replacement overlapped a healthy guard.
- First complete import at 23:24:57 UTC imported 80 active spools. A fresh complete
  Spoolman response matched all 80 IDs and every normalized source-owned field.
  Seventy-four prices remain unknown; 11 appearances require review, leaving 69
  eligible for solid-color comparison. No material label was unmapped.
- Subsequent automatic imports retained all 80 IDs and revision 1 for unchanged
  source data. No source spool writes or stock deductions occurred, and the
  Spoolman application container was not restarted.
- At 23:26:49 UTC a synthetic provider failure recorded only the safe failure code,
  retaining all 80 rows and the previous successful timestamp. The actual worker
  automatically recovered at 23:27:53 UTC with no duplicate rows or revision churn.
- Read-only matching with a clock five minutes beyond the successful snapshot
  confirmed that stale imported stock cannot report ready. Every material cost
  result was finite and unknown costs remained labeled with fallback/coverage.
- The signed-in production owner saw all 80 rows, queued **Refresh from Spoolman**,
  and reloaded the completed result at 23:32:14 UTC. Source weight and purchase
  cost fields were disabled while the local override remained editable. The real
  existing print request correctly required review for its unspecified color;
  no customer requirements or substitution decisions were changed.
- Inspected the dedicated internal Docker network: its only members are the jobs
  worker and the Spoolman application. API, source database, application database,
  slicer, tunnel, and existing Home Assistant routes were not added to it.
- After activation, two encrypted database/file backup copies passed readback.
  An isolated networkless restore recovered the 29-table selected database,
  all 80 inventory rows, and the singleton sync state. Runtime privilege denials
  and 14 private-configuration hashes passed; no restore volume was retained.

Source-data limitations remain explicit: physical remaining-weight accuracy
requires correct Spoolman onboarding and printer-to-spool assignment. The missing
74 prices are not fabricated purchase costs. Nothing in this release verifies
physical stock on a scale or silently approves a material/color substitution.
