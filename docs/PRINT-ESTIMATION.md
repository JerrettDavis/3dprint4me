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

ZIP pack branch:
Print service -> choose .zip -> browser reads the ZIP directory with the shared inspector,
     measures each STL/3MF part locally -> picker (all measurable parts selected, quantity 1)
     -> planning range from the selected parts (not a slice)
  -> [if configured] one signed PUT of the ZIP -> analyze: server re-inspects the archive,
     extracts every STL/3MF entry into a private child asset and measures it
  -> estimate-pack (debounced preview on each selection change; final purpose=submission at
     submit): parts rolled up, pricing policy runs once, one slice job per selected part
  -> submit: the ZIP and the selected parts attach; unselected parts are removed by the next
     cleanup run
  -> operator: ZIP row (ignored files), part rows with quantities, per-part download
```

Without Neon + private Blob the browser still measures the model locally, the range still updates, and the file travels with the normal request path (signed upload or local/email recovery). A slicer outage, pending job, or failed job never blocks submission. The same holds for a ZIP pack: the picker and planning range work locally and the ZIP travels with the request as an ordinary file.

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
| ZIP pack inspector (browser and server, same rules) | `public/assets/js/print-estimation/archive.js` (uses `readZipDirectory` / `readZipEntry` from `three-mf.js`) |
| Browser pack read, local rollup | `public/assets/js/print-estimation/pack.js` |
| Server pack extraction, claim and cleanup | `application/estimate-session.js` (`analyzePack`), `application/pack.js` (public pack view, part names) |
| Pack estimate and rollup | `application/estimate-pack.js` |
| Repositories | `adapters/neon-print-repository.js` (production), `adapters/local-print-repository.js` (loopback workspace) |
| Schema | `neon/migrations/004_print_estimation.sql`, `005_print_estimate_rate_limits.sql`, `006_model_packs.sql` |

API entrypoints: `POST|GET /api/print-estimate` (public, capability-owned) and `GET|POST /api/operator-print` (approved operators). The deployment stays at 12 functions; a unit test guards the Vercel Hobby limit.

Contributor note: the shared browser modules are imported with `?v=<hash>` query strings, so the same file can load as two module instances. `error instanceof ModelAnalysisError` is then unreliable; check `error?.name === "ModelAnalysisError"` and `error.code` instead, as the existing code does.

## Pricing

See [PRICING-CALIBRATION.md](PRICING-CALIBRATION.md#dual-floor-print-pricing). Every snapshot stores the pricing-model version, rate-card version, material-cost snapshot (source and inventory IDs), derived machine/labor rates, options, production figures, engine/profile/version, and timestamps. Snapshots are insert-only; a database trigger rejects any change except linking a snapshot to its request once.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PRINT_ESTIMATE_MAX_BYTES` | 26214400 | Server model size limit (signed upload and read bound) |
| `PRINT_ESTIMATE_MAX_TRIANGLES` | 1500000 | Triangle limit for STL/3MF analysis |
| `PRINT_ESTIMATE_MAX_3MF_ENTRIES` | 256 | ZIP entry limit (3MF containers and ZIP packs) |
| `PRINT_ESTIMATE_MAX_3MF_UNCOMPRESSED_BYTES` | 134217728 | Total bounded expansion of a 3MF or ZIP pack |
| `PRINT_ESTIMATE_MAX_PACK_PARTS` | 16 (values above 32 are clamped to 32) | STL/3MF entries accepted from one ZIP pack; a pack with more is refused, not truncated. One session may hold at most twice this many extracted parts. Server-side only: the browser's own pack limit is fixed at 16 (the `mesh.js` default; `SITE_CONFIG.printEstimation` does not override it), so raising this value does not enable larger packs in the picker. A pack over 16 is refused in the browser ("too many parts") and travels with the request as an ordinary file. |
| `PRINT_ESTIMATE_SESSION_TTL_HOURS` | 24 | Anonymous session/asset lifetime (max 168) |
| `PRINT_ESTIMATE_MAX_ASSETS` / `PRINT_ESTIMATE_MAX_ESTIMATES` | 3 / 20 | Per-session abuse bounds. A ZIP counts as one asset. Pack preview estimates share the estimate cap; the final `purpose: "submission"` pack estimate may exceed it by 5. Slicer results (`purpose = 'slice'`, one per sliced part and profile) are written by the worker and never count toward the cap. |
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

1. Apply migration 004 after 001-003, then 005, then 006 (all additive; see [DEPLOYMENT.md](DEPLOYMENT.md#print-estimation)). Apply 005 before deploying code that includes the rate limiter, because creation fails closed without its counter table. Apply 006 before deploying code that includes ZIP packs: that code reads and writes `parent_asset_id`, `archive_entry`, `quantity`, `selected` and the `zip` format and `analyzing` state.
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
cp deploy/slicer-worker/.env.worker.example deploy/slicer-worker/.env   # compose reads .env next to the compose file
chmod 600 deploy/slicer-worker/.env
$EDITOR deploy/slicer-worker/.env             # DATABASE_URL, BLOB_READ_WRITE_TOKEN (required), SLICER_PROFILE_ID
docker compose -f deploy/slicer-worker/docker-compose.yml up -d --build
docker compose -f deploy/slicer-worker/docker-compose.yml logs -f      # expect JSON lines only when jobs are claimed
```

#### Alternative: Portainer git stack

The compose file takes all configuration from environment variables (no `env_file`), so it deploys as a Portainer Repository stack on a standalone Docker host:

1. Check free disk on the host first (`docker system df`, `df -h`); the build needs roughly 2 GB for the image plus build cache.
2. Portainer > Stacks > Add stack > Repository.
3. Repository URL `https://github.com/JerrettDavis/3dprint4me`, reference `refs/heads/main`, compose path `deploy/slicer-worker/docker-compose.yml` (the `../..` build context resolves to the repository root checkout). Add credentials only if the repo is private.
4. Under Environment variables enter `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` (required; the stack refuses to deploy without them) and optionally `SLICER_PROFILE_ID`, `SLICER_TIMEOUT_MS`, `SLICER_POLL_MS`, `SLICER_PROVIDER`, `SLICER_ENGINE`. Defaults are the Bambu values in `.env.worker.example`. `SLICER_BIN`, `SLICER_PROFILE`, `SLICER_BED_TYPE` and `SLICER_FILAMENT_PROFILES` are only passed through when set (the Bambu image bakes them). For PrusaSlicer also set `SLICER_DOCKERFILE=Dockerfile`, `SLICER_PROVIDER=local-cli`, `SLICER_BIN=/opt/prusaslicer/AppRun`, `SLICER_PROFILE=/app/profiles/default.ini`, `SLICER_ENGINE=prusaslicer-cli`.
5. Deploy the stack. To update, use "Pull and redeploy" with re-build enabled.

Watchtower does not help here: the image is built locally and is not published to a registry, so there is nothing to pull. Exclude the container from Watchtower (label `com.centurylinklabs.watchtower.enable=false`) if Watchtower runs in monitor-all mode, and redeploy from Portainer instead.

**Switching an existing PrusaSlicer host to Bambu Studio:** `.env.worker` values override the image defaults, so remove the PrusaSlicer `SLICER_PROVIDER`, `SLICER_BIN`, `SLICER_PROFILE` and `SLICER_ENGINE` lines (use the Bambu block of `.env.worker.example`) before `up -d --build`; otherwise the new image would try to run `/opt/prusaslicer/AppRun`. To stay on PrusaSlicer, run compose with `SLICER_DOCKERFILE=Dockerfile`.

Optional one-batch check before relying on it: `docker compose -f deploy/slicer-worker/docker-compose.yml run --rm slicer-worker node scripts/print-estimate-worker.mjs --once` (exits 0 when the queue is empty).

Update (CLI): `git pull && docker compose -f deploy/slicer-worker/docker-compose.yml up -d --build`. Stop: `docker compose -f deploy/slicer-worker/docker-compose.yml down` (jobs stay queued and are leased again on restart). Run only one worker per queue unless you intend parallelism; leases make concurrent workers safe.

### Storefront step

In Vercel (Production), set `SLICER_PROVIDER` (any provider value, e.g. `bambu-cli`; an existing `local-cli` value keeps working) and redeploy. The storefront only needs the variable to queue slice jobs; the binary and profile variables are used by the worker only. To disable exact slicing, unset the variable and redeploy; pending jobs simply wait.

The PrusaSlicer AppImage version is overridable at build time (`--build-arg PRUSASLICER_APPIMAGE_URL=... --build-arg PRUSASLICER_SHA256=...`). Newer PrusaSlicer releases no longer publish an AppImage on GitHub, so 2.8.1 is pinned. The Bambu Studio AppImage is overridable with `SLICER_APPIMAGE_URL` / `SLICER_APPIMAGE_SHA256`; GitHub release assets list their SHA-256 digest.

## Customizer models

Models made on a `/customize/` generator page ([GENERATORS.md](GENERATORS.md)) enter this flow unchanged: **Continue to request** hands the 3MF to `/order.html?service=print&from=customize`, the order page attaches it through the same model path as a chosen file (browser geometry, private upload and verified estimate when configured, a queued slice job when a slicer is configured), and the request carries `customization` provenance next to it. The generator page itself uploads nothing and never touches estimate sessions or their rate limits; its "Local facts" come from the same browser geometry module and are planning figures only. Generated 3MFs are Bambu-compatible packages: the analyzer flags their embedded settings with `embedded_settings_ignored` (loaded presets win, see above) and must report no other warning (`tests/unit/customize-all-generators.test.mjs`).

**Multi-color slicing (verified 2026-10-02, [note](superpowers/notes/2026-10-02-multicolor-slicing.md)).** Generators produce 1-5 colors as separate objects with per-object filament assignments. A three-color fixture (three touching 18 mm cubes) sliced in the Bambu Studio 02.08.04.57 worker image with one `--load-filaments` entry gave 69.22 g, 20,917 s and 224 tool changes. Passing one filament or three identical filament slots gave identical grams and tool changes (time within about 6 s), so the slot count is irrelevant and the adapter was not changed. `purgeGrams` is reported as `null`: purge and prime-tower waste are **not separated**, but they are evidently included, since 69.22 g is far above the roughly 21.7 g of solid PLA in the cubes. The estimate is therefore total filament consumed. The fixture changes color on every layer, so it is a worst case. Generator inlays and raised details span only a few layers (measured below). Each launch generator's default output was then sliced locally on 2026-10-03, in the local `3dprint4me-slicer-worker:bambu` image (engine 02.08.04.57, profile `machine.json+process.json:pla`), with `scripts/slicer-smoke.mjs` as in the note. The Wi-Fi tag used a sample password.

| Generator (defaults) | Colors | Tool changes | Grams | Time |
|---|---:|---:|---:|---:|
| route-shield | 4 | 25 | 27.37 | 6,836 s (1.9 h) |
| wifi-tag (placard) | 2 | 6 | 30.50 | 6,247 s (1.7 h) |
| rating-card | 5 | 13 | 8.31 | 2,135 s (0.6 h) |
| name-plate | 2 | 1 | 7.71 | 1,522 s (0.4 h) |

All four exited cleanly with no warnings and `purgeGrams: null`. Real generator output needs one to two orders of magnitude fewer tool changes than the fixture. The production worker has not sliced these files yet: that happens in the owner-gated rollout in [DEPLOYMENT.md](DEPLOYMENT.md#customize-section-rollout-owner-gated).

## ZIP model packs

A customer can attach one `.zip` as the print model, for example a designer's print pack with several STLs, preview images and notes.

**Inspection.** `archive.js` runs the same rules in the browser and on the server. It reads only the central directory and refuses the whole archive on the first violation:

- unsafe names: absolute, drive letter, `..`/`.` segments, backslash, control characters
- duplicate names, including names that differ only in case or Unicode normalization
- encrypted entries, ZIP64, and compression methods other than stored or deflate
- more than `PRINT_ESTIMATE_MAX_3MF_ENTRIES` entries
- total expansion over `PRINT_ESTIMATE_MAX_3MF_UNCOMPRESSED_BYTES`, a model over `PRINT_ESTIMATE_MAX_BYTES`, or an unsafe compression ratio
- entries that overlap or share data
- an inflated size that differs from the declared size, or a CRC-32 mismatch
- no STL/3MF entries (`no_models`), or more than `PRINT_ESTIMATE_MAX_PACK_PARTS` (`too_many_parts`)

Only `.stl` and `.3mf` entries are inflated. Every other file (images, documents, `.scad` and other sources, nested archives) is listed as ignored by name and coarse kind and never read. Symlinks and other special entries are listed as ignored with kind `special`.

**Server analysis.** `analyze` on a ZIP works in five steps:

1. It claims the asset atomically by moving it to the transient state `analyzing`. A concurrent `analyze` gets `409` "This pack is still being analyzed". A claim older than 300 s is treated as crashed and can be reclaimed; its partial children are removed first.
2. It extracts each model entry into a child `print_assets` row. The child has a generated private path `print-estimates/<session>/<random>-part<n>.<ext>`. The entry name is stored only in `archive_entry` as a display label and is never used in a path.
3. It measures each child. A part that cannot be measured is stored `failed` and shown as unmeasurable; the other parts proceed.
4. Any archive violation fails the whole ZIP, and its children are removed.
5. Re-analyzing a ready pack returns the stored pack and never extracts again.

**Picker.** The order page lists every part with a checkbox and a quantity (1-99). All measurable parts start selected at quantity 1. Unmeasurable parts are disabled with "Could not be measured — a person will review it." Ignored files appear under "Not printed". The customer cannot clear the last selected part ("Keep at least one part selected."). The planning range is recomputed locally from the selected parts. Below the picker: "Packs are printed part by part; the confirmed price is often higher than this planning range."

Part names are archive entry labels: control, C1 and bidi characters are stripped and the label is capped at 255 characters. If two entries collapse to the same label (a shared 255-character prefix, or a difference only in stripped characters), the later one gets ` (n)`, where n starts at its 1-based archive position. The browser and the server use the same rule (`uniqueEntryLabels` in `archive.js`), so every local part maps to exactly one server part.

**Selection in the request text.** On submit, the browser adds the pack selection to the request `specifications` as plain text:

- `packParts`: `2 of 4 parts: parts/base.stl ×1; parts/lid.stl ×2`
- `packIgnored`: the ignored file names

Each value is at most 500 characters, which is what server validation keeps. A long list ends with `(+N more)` instead of being cut silently, and a label over 120 characters is shortened with `…`. The no-integration email draft carries the same two lines. This text reaches the operator on every path, including when the server never recorded a selection: no integrations, a refused pack, a failed or exhausted private estimate, or a pack too large to estimate online.

**Pack estimate.** With private estimates enabled, each selection change sends an `estimate-pack` preview:

- Previews are debounced by 700 ms. An identical selection is not resent, and previews stop after a `429`.
- At submit, a final `estimate-pack` with `purpose: "submission"` records the chosen selection.
- The server validates every part ID against ready children of that ZIP in the caller's session, with quantities 1-99 and at least one part. It stores `selected`/`quantity` and queues one slice job per selected part.
- The selection is written only while the session is still open. A preview that reaches the server after the request was submitted changes nothing. The browser also waits for every preview still in flight before it sends the submission estimate.
- Recording a selection for one ZIP unselects the parts of every other ZIP in the same session. If the customer replaces a ZIP, the earlier ZIP's parts are therefore not attached. The earlier ZIP file itself still attaches, with no parts.
- `estimate-pack` stores an immutable snapshot. `status` resolves the newest snapshot of the pack (or of a top-level model); a part's slicer result never stands in for it. `status` recomputes the pack estimate read-only and falls back to the stored snapshot if the parts are gone.

**Pricing rollup.** Each selected part contributes grams and hours x its part quantity x the order quantity. A part uses its slicer result when ready, otherwise geometry. The pricing policy then runs **once** on the totals, so setup, finishing labor and minimum charges apply once per pack, not per part. The snapshot is `slicer` only when every selected part has a slicer result.

Plates are counted per part: each selected part adds its own plate count, and plate labor (0.25 active hours per plate by default) is charged on that total. The browser's planning range (`packProduction` in `public/assets/js/print-estimation/pack.js`) uses the public rate card and has no plate term. The stored pack price is therefore usually **higher** than the on-screen range. For example, the reference pack showed $38–$64 on screen and stored $71–$88. Plate packing (several parts on one plate) is not modeled.

The pack `slice.status` is one of:

- `ready`: every selected part is sliced
- `pending`: any part is queued or processing
- `failed`: otherwise, when a slicer is configured. This covers a pack where every selected part that is not ready has failed (or was cancelled).

`status` is read-only. It reports a part's real job state and never re-queues anything, so a permanently failing part ends polling with `failed` instead of staying "queued". The next preview or submission estimate re-queues failed parts.
- `unavailable`: no slicer is configured

A pack order the pricing limits cannot represent returns `400` "This pack order is too large to estimate online. Submit the request and a person will quote it."

Limitations:

- The customer's on-screen price stays the local geometry range until the pack's slice is ready, the same as for single models. The server's pack price is stored and shown to the operator. It is usually higher than the on-screen range, because of the per-part plate rule above. The pack panel tells the customer this.
- Plate arrangement is not modeled.

**Submit and operator view.** Submit attaches the ZIP and its selected children only. The operator print section shows:

- the ZIP row, with no geometry and with the ignored-file list
- each part with its entry name, "Pack part · quantity N", its geometry and its own Download button (60 s signed link)
- a part that is not selected, marked "not selected" if it is still linked to the request

After slicing, the operator's **Latest estimate** for a pack remains the submission snapshot; it is not replaced by a re-rolled slicer total. Each part's slice job appears under **Slicer analysis**, and each part's slicer snapshot appears in **Estimate history**. To price a pack from slicer results, read the per-part rows.

## Slicer contract

`estimateSlice({ bytes | blobPath, filename, options, timeoutMs })` returns `engine`, `engineVersion`, `profileId`, `elapsedSeconds`, `materialGrams`, and optionally `materialMm`, `purgeGrams`, `supportGrams`, `toolChanges`, `layerCount`, `warnings`. Results are validated before pricing. Errors use categories `unavailable`, `timeout`, `slicer_failed`, `invalid_output` (retried with 1, 2, 4… minute backoff capped at 1 hour, 4 attempts) or `asset_missing`, `unsupported` (not retried). Jobs are leased with `FOR UPDATE SKIP LOCKED`; only the lease owner can complete or fail a job. Provider output and error detail stay private.

## Retention and privacy

- Anonymous sessions and their models expire after `PRINT_ESTIMATE_SESSION_TTL_HOURS`; the sweep deletes the Blob objects and then every session, asset, estimate, and job row.
- Uploads that never finished are removed after 24 hours.
- ZIP packs: children of an expired, never-submitted session are deleted with it. After submit, the cleanup sweep removes the remaining pack leftovers of attached sessions and reports them as `orphanedParts`:
  - unselected children that were never attached. A child linked to the request is never swept, even if a late write cleared its `selected` flag. Neither is a child with `retention_hold`, or a child of a held ZIP.
  - a ZIP in the same session that was never attached and was last updated more than 10 minutes ago
  
  Until the next `npm run estimate:cleanup` run, those objects stay in private Blob. Attached children follow the work lifecycle below and inherit the ZIP's `retention_hold`.
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
| ZIP refused by the browser (unsafe path, bomb, encrypted, ZIP64, duplicate names, truncated, CRC) | "This file could not be measured automatically. You can still submit it; a person will review the file." No picker | Normal file row (or asset `failed` with private code if verified privately) |
| ZIP with more than `PRINT_ESTIMATE_MAX_PACK_PARTS` models | "This pack has too many parts to measure automatically; attach fewer or contact us." Still submittable | Asset `failed`, code `too_many_parts` |
| ZIP with no STL/3MF | "This ZIP has no STL or 3MF files to measure; attach STL or 3MF files." Still submittable | Asset `failed`, code `no_models` |
| One part unmeasurable | Part listed, disabled: "Could not be measured — a person will review it." Other parts proceed | Child asset `failed` with code; not attached |
| Server refuses a pack the browser accepted (for example the session's part cap) | Picker and local range stay; "The private check did not finish…" copy; the ZIP uploads with the request | ZIP asset `failed` with private code |
| Concurrent `analyze` of the same ZIP | `409`; local picker and range stay, "The private check did not finish…" copy | Claim recoverable after 300 s |
| Pack order too large for the pricing limits | `400` "too large to estimate online"; local range stays; still submittable | No snapshot for that selection; the selection is in the request text (`packParts`) |
| Preview estimates exhausted (`429`) | Previews stop; local range stays; the submission estimate has a reserve of 5 | Latest stored preview/submission snapshot, plus the request text (`packParts`) |
| A part's slice fails permanently | Polling ends; geometry range with the "operator confirms" copy | Job `failed` with category; the next preview re-queues it |

## Rollback

Roll back application code first. Migrations 004-006 are additive and may remain. Do not drop print tables while any deployed code or worker references them; purge Blob objects with the maintenance script before dropping tables.
