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
| `PRINT_ESTIMATE_SESSIONS_PER_CLIENT` / `PRINT_ESTIMATE_SESSIONS_GLOBAL` | 10 / 300 | Session creations per client / all clients per window |
| `PRINT_ESTIMATE_UPLOADS_PER_CLIENT` / `PRINT_ESTIMATE_UPLOADS_GLOBAL` | 30 / 900 | Upload-token issuances per client / all clients per window |
| `PRINT_ESTIMATE_RATE_WINDOW_SECONDS` | 3600 | Fixed rate-limit window (max 86400) |
| `PRINT_ESTIMATE_RATE_SALT` | empty | Optional secret salt for hashing client addresses into rate-limit subjects |
| `PRINT_ASSET_RETENTION_DAYS` | 90 | Model retention after work reaches a terminal status |
| `SLICER_PROVIDER` | unset | `local-cli` (PrusaSlicer-style), `bambu-cli` (Bambu Studio / OrcaSlicer), or `http`; unset disables exact slicing. The storefront only checks that it is set. |
| `SLICER_BIN`, `SLICER_PROFILE`, `SLICER_PROFILE_ID`, `SLICER_ARGS`, `SLICER_ENGINE`, `SLICER_ENGINE_VERSION` | — | Local CLI provider (PrusaSlicer-compatible defaults; `SLICER_ARGS` is a JSON array with `{model}`, `{output}`, `{profile}`) |
| `SLICER_MACHINE_PROFILE`, `SLICER_PROCESS_PROFILE`, `SLICER_FILAMENT_PROFILES`, `SLICER_BED_TYPE` | — | `bambu-cli` provider: flattened preset JSON paths; filaments as `pla=/a.json;petg=/b.json` (a bare path is the default for every material); bed type e.g. `Textured PEI Plate`. Also uses `SLICER_BIN`, `SLICER_ENGINE` (default `bambu-studio-cli`), `SLICER_PROFILE_ID` (`:<material>` appended when a material-specific filament is used). |
| `SLICER_HTTP_URL`, `SLICER_HTTP_TOKEN` | — | HTTPS worker provider; the worker receives a 10-minute signed model URL |
| `SLICER_TIMEOUT_MS`, `SLICER_POLL_MS` | 120000 (300000 for `bambu-cli`), 15000 | Provider timeout and worker idle poll |

Browser analysis limits live in `SITE_CONFIG.printEstimation` and never replace server limits.

## Enable in production

1. Apply migration 004 after 001-003, then 005 (both additive; see [DEPLOYMENT.md](DEPLOYMENT.md#print-estimation)). Apply 005 before deploying code that includes the rate limiter, because creation fails closed without its counter table.
2. Optionally bootstrap filament cost basis. Without rows, the explicit pricing-model fallback ($20/kg PLA) is used and recorded as `fallback`:

   ```sql
   INSERT INTO filament_inventory (material, brand_line, color, spool_nominal_grams, purchase_cost_cents, freight_fee_cents, on_hand_grams, estimate_default)
   VALUES ('pla', 'Average / Standard', 'Mixed', 1000, 2000, 0, 0, true);
   ```

   Or the owner can `POST /api/operator-print` with `{ "action": "save-filament", "filament": { ... } }`. Money is integer cents; landed cost per kg is derived.
3. `/api/health` reports `printEstimation: true` once Neon and private Blob are configured; the order page then uploads the model privately.
4. Schedule `npm run estimate:cleanup` (hourly is sufficient) from a trusted host with the production environment. A GitHub Actions workflow (`.github/workflows/estimate-cleanup.yml`) is provided that runs hourly; see [DEPLOYMENT.md](DEPLOYMENT.md#print-estimation-scheduled-cleanup) for secret configuration.
5. Exact slicing is optional: run `npm run estimate:worker` on a host with a slicer binary (`SLICER_PROVIDER=bambu-cli` or `local-cli`), or deploy an HTTP worker implementing the contract in `adapters/http-slicer.js`, and set `SLICER_PROVIDER` on the storefront so jobs are queued. The containerized worker for an always-on Docker host is described in [Slicer worker container](#slicer-worker-container).

## Slicer worker container

`deploy/slicer-worker/` packages `npm run estimate:worker` with a headless slicer for an always-on Docker host. Two images are provided:

| Image | Slicer | Provider | Notes |
|-------|--------|----------|-------|
| `Dockerfile.bambu` (compose default) | Bambu Studio 02.08.04.57 (official `ubu24` AppImage) | `bambu-cli` | Slices with the owner's Bambu presets; Ubuntu 24.04 runtime |
| `Dockerfile` | PrusaSlicer 2.8.1 AppImage | `local-cli` | Original image; select with `SLICER_DOCKERFILE=Dockerfile` |

Both AppImages are pinned by URL and SHA-256 build args and extracted with `--appimage-extract`, so no FUSE is needed. Neither needs a display or xvfb: the CLI never opens a window (Bambu Studio logs a harmless `glfwInit`/Wayland error while skipping thumbnails). The container runs as a non-root user (uid 10001), with a read-only root filesystem, tmpfs for `/tmp` and `$HOME`, all capabilities dropped, no published ports (outbound to Neon and Vercel Blob only), 2 GB / 2 CPU limits, and `restart: unless-stopped`. The healthcheck verifies the slicer binary and presets are present; job-level health is visible in `print_analysis_jobs` and the operator print section.

Files: `Dockerfile.bambu`, `Dockerfile`, `docker-compose.yml`, `.env.worker.example`, `profiles/bambu/README.md`, `profiles/default.ini` (PrusaSlicer placeholder).

### Bambu Studio CLI

The adapter (`lib/print-estimation/adapters/bambu-cli-slicer.js`) runs, without a shell and with a hard timeout:

```
AppRun --slice 0 --arrange 1 --orient 0 \
  --load-settings "machine.json;process.json" --load-filaments filament-<material>.json \
  --outputdir <tmp>/out [--curr-bed-type "Textured PEI Plate"] <tmp>/model.stl|.3mf
```

STL and 3MF are both accepted directly (no 3MF wrapping needed); loaded presets take priority over settings embedded in a 3MF. Each job gets a private temp directory with its own `HOME`/`XDG_*` so the app's config writes stay out of the read-only image. Output is `plate_<n>.gcode` plus `result.json`; the adapter reads time (`sliced_plates[].total_predication`, seconds, includes the machine's start sequence) and grams (`filaments[].total_used_g`) from `result.json`, and layers/length/version from the G-code `HEADER_BLOCK` (`; total estimated time:`, `; total filament weight [g] :`, `; total layer number:`), which is also the fallback when `result.json` is absent. The process exit status is the CLI return code modulo 256; the adapter maps the signed `result.json` `return_code` to categories: model problems such as unparsable files (-6), nothing fits on the plate (-50) or objects partly outside the bed (-52) are permanent `unsupported`; preset/environment problems such as an invalid preset (-5) or filament/plate mismatch (-61) are `unavailable`; anything else is a retried `slicer_failed`.

The Bambu CLI does **not** resolve preset `inherits` chains (vendor presets only store overrides; without flattening, density and layer height silently fall back to defaults and grams read as 0). `scripts/flatten-slicer-presets.mjs` resolves parent chain, then `include` templates, then the preset's own keys, against the vendor profiles shipped inside the pinned AppImage, at image build time. User presets exported from Bambu Studio or OrcaSlicer can be flattened the same way; LAN/account keys (`print_host`, `printhost_*`, `user_id`, `setting_id`, ...) are dropped.

### Profile selection (owner action: confirm)

The defaults match the owner's current Bambu Studio selection; the Bambu Studio cloud-synced user folder held no custom presets, so these are the bundled vendor presets:

- Printer `Bambu Lab X2D 0.4 nozzle`, process `0.16mm High Quality @BBL X2D`, bed `Textured PEI Plate`
- Filaments `Generic PLA|PETG|ASA|TPU @BBL X2D 0.4 nozzle` for materials `pla|petg|asa|tpu` (`other` uses PLA)

Change them with build args (`SLICER_MACHINE_PRESET`, `SLICER_PROCESS_PRESET`, `SLICER_FILAMENT_PLA|PETG|ASA|TPU`) or point an arg at a sanitized user preset JSON placed in `deploy/slicer-worker/profiles/bambu/` (see its README). Bump `SLICER_PROFILE_ID` whenever the selection changes. The customer's quality/supports options do not yet select different process presets; one process preset is used for every job.

OrcaSlicer (2.4.2, `OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.4.2.AppImage`, sha256 `d12fb8c8eac1aecd2dfb6377acd48f994f8fa439ed5292fa532dd82880f029fd`) shares this CLI and can be used via `--build-arg SLICER_APPIMAGE_URL=... --build-arg SLICER_APPIMAGE_SHA256=...` with `SLICER_ENGINE=orca-slicer-cli`, but its vendor profiles do not include the X2D, and that path has not been exercised in a container.

### PrusaSlicer profile

`profiles/default.ini` is a generic placeholder, not calibrated to any printer. Export your real config from PrusaSlicer (select printer, filament and print presets, then File > Export > Export Config...) and replace the file, or mount a directory at `/profiles` and set `SLICER_PROFILE=/profiles/<file>.ini`. Change `SLICER_PROFILE_ID` whenever the profile changes; it is recorded on every estimate.

### Host deploy steps

On the Docker host (these steps are manual; nothing here is automated):

```bash
git clone https://github.com/JerrettDavis/3dprint4me.git && cd 3dprint4me
cp deploy/slicer-worker/.env.worker.example deploy/slicer-worker/.env.worker
chmod 600 deploy/slicer-worker/.env.worker
$EDITOR deploy/slicer-worker/.env.worker      # DATABASE_URL, BLOB_READ_WRITE_TOKEN, SLICER_PROFILE_ID
docker compose -f deploy/slicer-worker/docker-compose.yml up -d --build
docker compose -f deploy/slicer-worker/docker-compose.yml logs -f      # expect JSON lines only when jobs are claimed
```

**Switching an existing PrusaSlicer host to Bambu Studio:** `.env.worker` values override the image defaults, so remove the PrusaSlicer `SLICER_PROVIDER`, `SLICER_BIN`, `SLICER_PROFILE` and `SLICER_ENGINE` lines (use the Bambu block of `.env.worker.example`) before `up -d --build`; otherwise the new image would try to run `/opt/prusaslicer/AppRun`. To stay on PrusaSlicer, run compose with `SLICER_DOCKERFILE=Dockerfile`.

Optional one-batch check before relying on it: `docker compose -f deploy/slicer-worker/docker-compose.yml run --rm slicer-worker node scripts/print-estimate-worker.mjs --once` (exits 0 when the queue is empty).

Update: `git pull && docker compose -f deploy/slicer-worker/docker-compose.yml up -d --build`. Stop: `docker compose -f deploy/slicer-worker/docker-compose.yml down` (jobs stay queued and are leased again on restart). Run only one worker per queue unless you intend parallelism; leases make concurrent workers safe.

### Storefront step

In Vercel (Production), set `SLICER_PROVIDER` (any provider value, e.g. `bambu-cli`; an existing `local-cli` value keeps working) and redeploy. The storefront only needs the variable to queue slice jobs; the binary and profile variables are used by the worker only. To disable exact slicing, unset the variable and redeploy; pending jobs simply wait.

The PrusaSlicer AppImage version is overridable at build time (`--build-arg PRUSASLICER_APPIMAGE_URL=... --build-arg PRUSASLICER_SHA256=...`). Newer PrusaSlicer releases no longer publish an AppImage on GitHub, so 2.8.1 is pinned. The Bambu Studio AppImage is overridable with `SLICER_APPIMAGE_URL` / `SLICER_APPIMAGE_SHA256`; GitHub release assets list their SHA-256 digest.

## Slicer contract

`estimateSlice({ bytes | blobPath, filename, options, timeoutMs })` returns `engine`, `engineVersion`, `profileId`, `elapsedSeconds`, `materialGrams`, and optionally `materialMm`, `purgeGrams`, `supportGrams`, `toolChanges`, `layerCount`, `warnings`. Results are validated before pricing. Errors use categories `unavailable`, `timeout`, `slicer_failed`, `invalid_output` (retried with 1, 2, 4… minute backoff capped at 1 hour, 4 attempts) or `asset_missing`, `unsupported` (not retried). Jobs are leased with `FOR UPDATE SKIP LOCKED`; only the lease owner can complete or fail a job. Provider output and error detail stay private.

## Retention and privacy

- Anonymous sessions and their models expire after `PRINT_ESTIMATE_SESSION_TTL_HOURS`; the sweep deletes the Blob objects and then every session, asset, estimate, and job row.
- Uploads that never finished are removed after 24 hours.
- Submitted models adopt the work lifecycle: never deleted while work is active; deleted from Blob `PRINT_ASSET_RETENTION_DAYS` after the work is completed, declined, or cancelled, unless `print_assets.retention_hold = true`. The asset row remains (`state = 'deleted'`) so history stays explainable.
- Privacy deletion: `npm run estimate:cleanup -- --purge-request <request-id>` deletes the Blob objects first (aborting if any deletion fails) and then assets, estimate snapshots, jobs, and sessions for that request. Delete the request's other records with the existing request/work procedures.

## Rate limiting

`create` and `authorize-upload` (the only actions that mint a session capability or a signed upload URL) consume a fixed-window counter in `print_estimate_rate_buckets` (migration 005) in two buckets: the caller (`c_` + salted SHA-256 of `x-vercel-forwarded-for`, `x-real-ip`, `x-forwarded-for`, or the socket address) and `global`. The increment is a single atomic `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, so concurrent functions cannot over-admit. The client bucket is counted first so refused attempts from one caller do not drain the global budget. Over limit returns `429` with `Retry-After`; a counter failure also blocks (fail closed). Status, analyze, and finalize are not limited here because they require an existing capability. Buckets older than two days are pruned by `npm run estimate:cleanup` (`rateBucketsPruned`). Rollback: the table may remain; roll back code first.

## Failure behavior

| Failure | Customer | Operator |
|---|---|---|
| No Neon/Blob | Local geometry and range; file uploads with the request | Normal request detail |
| Model cannot be parsed | Generic "could not be measured" copy; still submittable | Asset `failed` with private diagnostic code |
| Estimate rate limit exceeded (`429` + `Retry-After`) or counter store unavailable | Private estimate skipped; file uploads with the request instead | Normal file row |
| Private upload/verification fails | File uploads with the request instead | Normal file row |
| Slicer unavailable/failing | Geometry range; "exact estimate queued" copy | Job pending/failed with category and attempts |
| Session expired before submit | Request submits without attachment | No print section data |
| Print tables missing (migration not applied) | Private estimate unavailable; normal flow | Detail shows "Print estimate data is unavailable" |

## Rollback

Roll back application code first. Migration 004 is additive and may remain. Do not drop print tables while any deployed code or worker references them; purge Blob objects with the maintenance script before dropping tables.
