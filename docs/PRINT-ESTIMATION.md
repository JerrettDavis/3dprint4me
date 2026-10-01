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
| `SLICER_PROVIDER` | unset | `local-cli` or `http`; unset disables exact slicing |
| `SLICER_BIN`, `SLICER_PROFILE`, `SLICER_PROFILE_ID`, `SLICER_ARGS`, `SLICER_ENGINE`, `SLICER_ENGINE_VERSION` | — | Local CLI provider (PrusaSlicer-compatible defaults; `SLICER_ARGS` is a JSON array with `{model}`, `{output}`, `{profile}`) |
| `SLICER_HTTP_URL`, `SLICER_HTTP_TOKEN` | — | HTTPS worker provider; the worker receives a 10-minute signed model URL |
| `SLICER_TIMEOUT_MS`, `SLICER_POLL_MS` | 120000, 15000 | Provider timeout and worker idle poll |

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
5. Exact slicing is optional: run `npm run estimate:worker` on a host with a slicer binary (`SLICER_PROVIDER=local-cli`), or deploy an HTTP worker implementing the contract in `adapters/http-slicer.js`, and set `SLICER_PROVIDER` on the storefront so jobs are queued.

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
