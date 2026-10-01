# Print estimation, private models, and retention

This runbook covers the `print-estimation` vertical slice: model-aware print estimates, private STL/3MF retention, the asynchronous slicer contract, operator economics, and cleanup.

## Flow

```text
Print service -> choose STL/3MF -> bounded browser geometry -> planning range (not a slice)
  -> [if configured] create capability session -> signed direct PUT to private Blob
  -> server verifies object size, re-analyzes geometry, stores immutable estimate snapshot
  -> [if a slicer is configured] slice job queued (never awaited)
  -> submit request: model referenced, not re-uploaded; session/assets/snapshots attach in the
     same statement that creates the single work item
  -> operator work detail: files, 60 s signed download, latest estimate, cost/margin, history, runs
```

Without Neon + private Blob the browser still measures the model locally, the range still updates, and the file travels with the normal request path (signed upload or local/email recovery). A slicer outage, pending job, or failed job never blocks submission.

## Code map

| Area | Location |
|---|---|
| Shared bounded STL/3MF parsers (browser and server) | `public/assets/js/print-estimation/{mesh,stl,three-mf,geometry}.js` |
| Browser model panel, private-upload flow | `public/assets/js/print-estimation/{controller,view,client}.js` |
| Pricing policy (server-only) | `lib/print-estimation/pricing-policy.js`, `compose-estimate.js`, `rate-card.js` |
| Filament cost basis | `lib/print-estimation/inventory.js`, `application/filament.js` |
| Sessions, upload authorization, analysis | `lib/print-estimation/application/estimate-session.js`, `capability.js` |
| Slicer port and providers | `lib/print-estimation/slicer-contract.js`, `adapters/local-cli-slicer.js`, `adapters/http-slicer.js` |
| Job runner / worker | `application/slice-jobs.js`, `scripts/print-estimate-worker.mjs` |
| Operator read model and downloads | `application/operator-view.js`, `api/operator-print.js`, `operator/assets/print-detail.js` |
| Retention and privacy purge | `application/retention.js`, `scripts/print-estimate-maintenance.mjs` |
| Repositories | `adapters/neon-print-repository.js` (production), `adapters/local-print-repository.js` (loopback workspace) |
| Schema | `neon/migrations/004_print_estimation.sql` |

API entrypoints: `POST|GET /api/print-estimate` (public, capability-owned) and `GET|POST /api/operator-print` (approved operators). The deployment stays at 12 functions; a unit test guards the Vercel Hobby limit.

## Pricing

See [PRICING-CALIBRATION.md](PRICING-CALIBRATION.md#dual-floor-print-pricing). Every snapshot stores the pricing-model version, rate-card version, material-cost snapshot (source and inventory IDs), derived machine/labor rates, options, production figures, engine/profile/version, and timestamps. Snapshots are insert-only; a database trigger rejects any change except linking a snapshot to its request once.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PRINT_ESTIMATE_MAX_BYTES` | 26214400 | Server model size limit (signed upload and read bound) |
| `PRINT_ESTIMATE_MAX_TRIANGLES` | 1500000 | Triangle limit for STL/3MF analysis |
| `PRINT_ESTIMATE_MAX_3MF_ENTRIES` | 256 | ZIP entry limit |
| `PRINT_ESTIMATE_MAX_3MF_UNCOMPRESSED_BYTES` | 134217728 | Total bounded 3MF expansion |
| `PRINT_ESTIMATE_SESSION_TTL_HOURS` | 24 | Anonymous session/asset lifetime (max 168) |
| `PRINT_ESTIMATE_MAX_ASSETS` / `PRINT_ESTIMATE_MAX_ESTIMATES` | 3 / 20 | Per-session abuse bounds |
| `PRINT_ASSET_RETENTION_DAYS` | 90 | Model retention after work reaches a terminal status |
| `SLICER_PROVIDER` | unset | `local-cli` or `http`; unset disables exact slicing |
| `SLICER_BIN`, `SLICER_PROFILE`, `SLICER_PROFILE_ID`, `SLICER_ARGS`, `SLICER_ENGINE`, `SLICER_ENGINE_VERSION` | — | Local CLI provider (PrusaSlicer-compatible defaults; `SLICER_ARGS` is a JSON array with `{model}`, `{output}`, `{profile}`) |
| `SLICER_HTTP_URL`, `SLICER_HTTP_TOKEN` | — | HTTPS worker provider; the worker receives a 10-minute signed model URL |
| `SLICER_TIMEOUT_MS`, `SLICER_POLL_MS` | 120000, 15000 | Provider timeout and worker idle poll |

Browser analysis limits live in `SITE_CONFIG.printEstimation` and never replace server limits.

## Enable in production

1. Apply migration 004 after 001-003 (additive; see [DEPLOYMENT.md](DEPLOYMENT.md#print-estimation)).
2. Optionally bootstrap filament cost basis. Without rows, the explicit pricing-model fallback ($20/kg PLA) is used and recorded as `fallback`:

   ```sql
   INSERT INTO filament_inventory (material, brand_line, color, spool_nominal_grams, purchase_cost_cents, freight_fee_cents, on_hand_grams, estimate_default)
   VALUES ('pla', 'Average / Standard', 'Mixed', 1000, 2000, 0, 0, true);
   ```

   Or the owner can `POST /api/operator-print` with `{ "action": "save-filament", "filament": { ... } }`. Money is integer cents; landed cost per kg is derived.
3. `/api/health` reports `printEstimation: true` once Neon and private Blob are configured; the order page then uploads the model privately.
4. Schedule `npm run estimate:cleanup` (hourly is sufficient) from a trusted host with the production environment. A GitHub Actions workflow (`.github/workflows/estimate-cleanup.yml`) is provided that runs hourly; see [DEPLOYMENT.md](DEPLOYMENT.md#print-estimation-scheduled-cleanup) for secret configuration.
5. Exact slicing is optional: run `npm run estimate:worker` on a host with a slicer binary (`SLICER_PROVIDER=local-cli`), or deploy an HTTP worker implementing the contract in `adapters/http-slicer.js`, and set `SLICER_PROVIDER` on the storefront so jobs are queued. The containerized worker for an always-on Docker host is described in [Slicer worker container](#slicer-worker-container).

## Slicer worker container

`deploy/slicer-worker/` packages `npm run estimate:worker` with a headless PrusaSlicer CLI (`SLICER_PROVIDER=local-cli`) for an always-on Docker host. PrusaSlicer is the official Linux release AppImage (pinned version and SHA-256 build args, extracted with `--appimage-extract`, so no FUSE is needed). The container runs as a non-root user (uid 10001), with a read-only root filesystem, tmpfs for `/tmp` and `$HOME`, all capabilities dropped, no published ports (outbound to Neon and Vercel Blob only), 2 GB / 2 CPU limits, and `restart: unless-stopped`. The healthcheck verifies the slicer binary and profile are present; job-level health is visible in `print_analysis_jobs` and the operator print section.

Files: `Dockerfile`, `docker-compose.yml`, `.env.worker.example`, `profiles/default.ini` (placeholder).

### Profile (owner action required)

`profiles/default.ini` is a generic placeholder, not calibrated to any printer. Export your real config from PrusaSlicer (select printer, filament and print presets, then File > Export > Export Config...) and replace the file, or mount a directory at `/profiles` and set `SLICER_PROFILE=/profiles/<file>.ini`. Change `SLICER_PROFILE_ID` whenever the profile changes; it is recorded on every estimate.

### Host deploy steps

On the Docker host (these steps are manual; nothing here is automated):

```bash
git clone https://github.com/JerrettDavis/3dprint4me.git && cd 3dprint4me
cp deploy/slicer-worker/.env.worker.example deploy/slicer-worker/.env.worker
chmod 600 deploy/slicer-worker/.env.worker
$EDITOR deploy/slicer-worker/.env.worker      # DATABASE_URL, BLOB_READ_WRITE_TOKEN, SLICER_PROFILE_ID
cp /path/to/exported-profile.ini deploy/slicer-worker/profiles/default.ini
docker compose -f deploy/slicer-worker/docker-compose.yml up -d --build
docker compose -f deploy/slicer-worker/docker-compose.yml logs -f      # expect JSON lines only when jobs are claimed
```

Optional one-batch check before relying on it: `docker compose -f deploy/slicer-worker/docker-compose.yml run --rm slicer-worker node scripts/print-estimate-worker.mjs --once` (exits 0 when the queue is empty).

Update: `git pull && docker compose -f deploy/slicer-worker/docker-compose.yml up -d --build`. Stop: `docker compose -f deploy/slicer-worker/docker-compose.yml down` (jobs stay queued and are leased again on restart). Run only one worker per queue unless you intend parallelism; leases make concurrent workers safe.

### Storefront step

In Vercel (Production), set `SLICER_PROVIDER=local-cli` and redeploy. The storefront only needs the variable to queue slice jobs; the binary and profile variables are used by the worker only. To disable exact slicing, unset the variable and redeploy; pending jobs simply wait.

The AppImage version is overridable at build time (`--build-arg PRUSASLICER_APPIMAGE_URL=... --build-arg PRUSASLICER_SHA256=...`). Newer PrusaSlicer releases no longer publish an AppImage on GitHub, so 2.8.1 is pinned.

## Slicer contract

`estimateSlice({ bytes | blobPath, filename, options, timeoutMs })` returns `engine`, `engineVersion`, `profileId`, `elapsedSeconds`, `materialGrams`, and optionally `materialMm`, `purgeGrams`, `supportGrams`, `toolChanges`, `layerCount`, `warnings`. Results are validated before pricing. Errors use categories `unavailable`, `timeout`, `slicer_failed`, `invalid_output` (retried with 1, 2, 4… minute backoff capped at 1 hour, 4 attempts) or `asset_missing`, `unsupported` (not retried). Jobs are leased with `FOR UPDATE SKIP LOCKED`; only the lease owner can complete or fail a job. Provider output and error detail stay private.

## Retention and privacy

- Anonymous sessions and their models expire after `PRINT_ESTIMATE_SESSION_TTL_HOURS`; the sweep deletes the Blob objects and then every session, asset, estimate, and job row.
- Uploads that never finished are removed after 24 hours.
- Submitted models adopt the work lifecycle: never deleted while work is active; deleted from Blob `PRINT_ASSET_RETENTION_DAYS` after the work is completed, declined, or cancelled, unless `print_assets.retention_hold = true`. The asset row remains (`state = 'deleted'`) so history stays explainable.
- Privacy deletion: `npm run estimate:cleanup -- --purge-request <request-id>` deletes the Blob objects first (aborting if any deletion fails) and then assets, estimate snapshots, jobs, and sessions for that request. Delete the request's other records with the existing request/work procedures.

## Failure behavior

| Failure | Customer | Operator |
|---|---|---|
| No Neon/Blob | Local geometry and range; file uploads with the request | Normal request detail |
| Model cannot be parsed | Generic "could not be measured" copy; still submittable | Asset `failed` with private diagnostic code |
| Private upload/verification fails | File uploads with the request instead | Normal file row |
| Slicer unavailable/failing | Geometry range; "exact estimate queued" copy | Job pending/failed with category and attempts |
| Session expired before submit | Request submits without attachment | No print section data |
| Print tables missing (migration not applied) | Private estimate unavailable; normal flow | Detail shows "Print estimate data is unavailable" |

## Rollback

Roll back application code first. Migration 004 is additive and may remain. Do not drop print tables while any deployed code or worker references them; purge Blob objects with the maintenance script before dropping tables.
