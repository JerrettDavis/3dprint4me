# ZIP model packs: safe extraction, per-part estimates, operator view

Date: 2026-10-05. Status: design, awaiting owner review.

## Intent

Customers (and designers) deliver multi-part print packs as a ZIP: for example `turn-tracker-print-pack-v2.zip`, 22 entries, 3.2 MB expanded: 9 STLs, 8 preview PNGs, an `ASSEMBLY.md` and an OpenSCAD source. Today a ZIP is not a recognized model format, so the customer gets no estimate, nothing is sliced, and the operator sees an opaque blob.

Goal: the Print service accepts a ZIP, safely extracts the printable models, lets the customer choose which parts to print and how many of each, produces an estimate and slice jobs per selected part, and shows the operator a pack with per-part detail and downloads.

Success criteria:

1. The reference pack above yields 9 selectable parts, ignores the non-model files without failing, and produces a pack estimate.
2. No archive can cause unbounded CPU, memory, storage or path escape, regardless of what its headers claim.
3. The browser estimate stays non-binding; the server re-validates everything (AGENTS.md invariant 4). Uploads stay private (invariant 3). Failure copy never exposes internals (invariant 8).
4. Without Neon and private Blob, the ZIP still travels with the request as a normal file and the browser still shows a planning range (invariant 6).
5. Existing STL/3MF flows are unchanged.

Out of scope: plate packing/arrangement, nested archives, non-print services' ZIP handling (they keep treating a ZIP as an ordinary attachment), `.scad` or image processing, 3MF parts inside a ZIP beyond the existing 3MF analyzer.

## Decision record

Chosen approach: **hybrid**. The browser reads the ZIP directory and measures parts locally for the picker and a planning range. The ZIP is uploaded once. The server re-validates, extracts every candidate STL/3MF entry (bounded) into child assets, measures each, and slices only the selected ones. Rejected: browser-only extraction (needs N uploads against the 3-asset cap and rate limits, loses the original) and server-only (no instant feedback, no offline range).

The customer picks parts and quantities (default: all parts, quantity 1). The server extracts **all** candidate models at analysis time, not only selected ones, because the picker needs server-measured dimensions and volume per part. Unselected children are never attached to the request and are purged when the request is submitted.

## Data model (migration 006, additive)

`print_assets` changes:

| Change | Detail |
|---|---|
| `format` check | adds `'zip'` |
| `parent_asset_id text REFERENCES print_assets(id) ON DELETE RESTRICT` | null for ordinary assets and for the ZIP itself; set on extracted children |
| `archive_entry text` (max 255) | display-only entry path (sanitized); never used to build a storage path |
| `quantity integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 99)` | per-part quantity within one pack; meaningful only on children |
| `selected boolean NOT NULL DEFAULT false` | set by `estimate-pack`; children not selected at submit are purged |
| index | `(parent_asset_id)` |
| constraint | a child must share its parent's `estimate_session_id`; a ZIP asset never has a parent |

Child `blob_path` is `print-estimates/<session>/<server-random>-part<index>.<ext>`. Entry names appear only in `archive_entry` and the display name.

Per-session bounds: the ZIP counts as one asset against `PRINT_ESTIMATE_MAX_ASSETS`. Children are bounded separately by new `PRINT_ESTIMATE_MAX_PACK_PARTS` (default 16, max 32).

## Server: archive inspection (`lib/print-estimation/archive/inspect-archive.js`)

Pure module, injectable inflate, no I/O of its own. Input: ZIP bytes (already size-capped by the upload authorization). Output: `{ models: [{ index, name, format, compressedSize, uncompressedSize, bytes }], ignored: [{ name, kind, uncompressedSize }] }` or a coded `ArchiveError`.

It reuses `readZipDirectory` and `zipSafeName` from `public/assets/js/print-estimation/three-mf.js` (already shared with the server's analyzer). Rules, all enforced before any entry is inflated unless stated:

| Rule | Behavior |
|---|---|
| Directory only | Entry list comes from the central directory; local-header sizes are never trusted. |
| Entry count | `<= PRINT_ESTIMATE_MAX_3MF_ENTRIES` (256) else `zip_limit`. |
| Names | Refuse absolute paths, drive letters, `..`/`.` segments, backslashes, NUL/control characters, over-long names (`zip_unsafe_path`). |
| Duplicates | Refuse duplicate names and names equal under Unicode NFC + case-fold (`zip_duplicate`). |
| Encryption / ZIP64 / methods | Refuse encrypted and ZIP64 entries; only stored (0) and deflate (8). |
| Symlinks / specials | Entries whose external attributes mark a symlink, device or other non-regular type are skipped and listed as ignored (kind `special`). |
| Total expansion | Sum of declared uncompressed sizes `<= PRINT_ESTIMATE_MAX_3MF_UNCOMPRESSED_BYTES` (128 MiB). |
| Per-model size | Each extracted model `<= PRINT_ESTIMATE_MAX_BYTES` (25 MiB). |
| Ratio | `uncompressed / compressed` per entry `<= maxCompressionRatio` (existing limit). |
| Which entries | Only `.stl` and `.3mf` (case-insensitive) are extracted. Directories are dropped. Everything else is listed in `ignored` by name and coarse kind (`image`, `document`, `source`, `archive`, `other`) and never read. A nested `.zip` is ignored with kind `archive` and never opened. |
| Part count | More than `PRINT_ESTIMATE_MAX_PACK_PARTS` model entries: `too_many_parts`; the whole pack is refused rather than silently truncated. |
| No models | Zero model entries: `no_models` (customer is told to attach STL or 3MF files). |
| Real inflate bound | Inflate runs with a hard output cap equal to the declared size; output exceeding it, or finishing smaller than declared, aborts the whole archive (`zip_limit`). A CRC-32 mismatch aborts (`malformed`). |
| Atomic | Any `ArchiveError` fails the whole ZIP; no partial pack is stored. |

Errors map to short customer copy via the existing `publicAnalysisFailure` pattern (generic wording; private diagnostic code stored on the asset as `analysis_error_code`).

## Server: use cases (`estimate-session.js`)

1. `authorizeUpload`: `modelFormatFromName` recognizes `.zip` and returns `zip`. Size and rate limits unchanged.
2. `analyze` for a `zip` asset: `verifyUpload`, then read bytes (bounded), `inspectArchive`, then for each model: write a child asset (state `uploaded`), upload its bytes to private Blob under the generated path, run `analyzeAsset`. A failing part is stored `failed` with its code and is shown to the customer as unmeasurable; remaining parts proceed. The ZIP asset becomes `ready` once extraction finished (even when some parts failed), `failed` if the archive was refused. Idempotent: calling `analyze` again returns the existing pack and never re-extracts.
3. Response shape (public-safe, no blob paths or hashes): `{ status: "pack", pack: { assetId, parts: [{ partId, name, format, dimensionsMm, volumeCm3, triangleCount, warnings, quantity: 1, state }], ignored: [{ name, kind }] }, slice: { status: "unavailable" } }`. `partId` is the child asset id.
4. New action `estimate-pack`: `{ sessionId, token, assetId, selections: [{ partId, quantity }], options }`. Validates every `partId` is a ready child of that ZIP in the caller's session, 1 to 99 quantity, at least one selection, selection count bounded by part cap. Persists `selected`/`quantity`. Enqueues one `slice` job per selected part (profile key unchanged, existing unique index prevents duplicates). Composes and stores an immutable pack estimate snapshot (`estimator_type` `geometry`, or `slicer` when all selected parts have results) and returns the public view.
5. `status` for a pack session returns the latest pack snapshot plus per-part slice states.

`estimate-pack` consumes the existing estimate-per-session limit once per call.

## Pricing rollup

Per selected part: production comes from its slice result when `ready`, otherwise from `estimateProductionFromGeometry`. Pack production = sum over parts of `grams x partQuantity` and `hours x partQuantity`. The existing `composePrintEstimate` runs **once** on that total, so setup, labor and minimum charges apply once for the job, not per part. The order-level quantity multiplies the whole pack. Pack confidence is the lowest confidence among selected parts. `slice.status` is `ready` only when every selected part's job is `ready`; otherwise `pending`, and the displayed range uses geometry for pending parts and is labelled as such. Plate arrangement is not modelled: the figure is a sequential-print upper bound, stated in the estimate's assumptions copy.

## Submit and retention

Attachment happens in the same single statement that creates the work item (existing `completeWithEstimateAttachment`), extended to: attach the ZIP asset and every child with `selected = true`; mark unselected children `deleted` and remove their Blob objects. A session expiring before submit purges the ZIP and all children via the existing sweep (children added to the sweep by `parent_asset_id`). After submit, the pack follows the work lifecycle and retention exactly like a single asset; children inherit the ZIP's retention hold.

## Operator view

`operator-view.js` returns, for a work item with a pack: the ZIP asset, selected parts (name, quantity, dimensions, grams/time/slice state, per-part estimate) and the ignored file list. `operator/assets/print-detail.js` renders a Pack section: ZIP **Download** (existing 60 s signed link flow), a parts table with a **Download** button per part, per-part slice state, pack total, and ignored files as plain names. `signDownload` already restricts a download to assets of the work item's own request; it additionally accepts child assets.

## Browser

- `modelFormat` accepts `zip`; `controller.sync` treats a ZIP as the print model.
- Local read uses `readZipDirectory` with browser limits, lists model entries and ignored entries, inflates each model entry with the existing `browserInflateRaw` (bounded), and analyzes each with `analyzeModelBytes`.
- The order panel shows the picker: a native checkbox and a numeric quantity input per part with its dimensions and volume, all selected, quantity 1. It is keyboard operable, announces selection totals through the existing polite live region, uses the existing light/dark tokens, and reflows to one column at 390 px.
- The planning range recomputes from local geometry as selection changes (non-binding copy unchanged). When a private session exists, the server's `estimate-pack` result replaces it.
- No private estimates configured: picker and range still work; the ZIP uploads with the request as an ordinary file.
- A malformed or refused ZIP shows the generic "could not be measured" copy and the request remains submittable.

## Safety and failure behavior

| Failure | Customer | Operator |
|---|---|---|
| Archive refused (bomb, unsafe path, encrypted, ZIP64, duplicate names, truncated, CRC) | Generic "could not be measured"; still submittable with the ZIP as a normal file | Asset `failed` with private code |
| More than 16 model entries | "This pack has too many parts; attach fewer or contact us" | Asset `failed`, code `too_many_parts` |
| No STL/3MF inside | "Attach STL or 3MF files" | Asset `failed`, code `no_models` |
| One part unmeasurable | That part shown as not measurable and not selectable; others proceed | Part `failed` with code |
| Rate limit / storage failure | Existing fallback: file uploads with the request | Normal file row |
| Slicer unavailable | Geometry range; "exact estimate queued" | Jobs pending/failed per part |

No unzipped bytes touch the filesystem on the storefront; the worker already receives only a signed URL to a single model. No ZIP entry name is ever used in a path, command, or URL. Responses and logs contain no raw archive errors.

## Testing

- **Inspector (unit):** generated fixtures: ratio bomb, entry-count bomb, declared-size lies (entry inflates larger or smaller than declared), CRC mismatch, traversal (`../`, absolute, backslash, drive letter, NUL), encrypted, ZIP64, duplicate and case/NFC-colliding names, nested ZIP ignored, symlink skipped, truncated file, bad EOCD, 17 model entries, zero models, and a clean pack mirroring the reference (9 STLs, PNGs, md, scad). Reference ZIP itself is not committed.
- **Use cases (unit, fake repository/store):** upload authorization for zip, extraction creates children with generated paths, partial part failure, idempotent re-analyze, `estimate-pack` validation (foreign partId, zero selections, quantity bounds), per-part slice jobs, rollup math and `slice.status` transitions.
- **Repository:** PGlite test runs migration 006 and the new queries against real Postgres semantics (the lesson of PR #27: mocked SQL cannot catch parameter-typing errors), including the submit attachment/purge statement and the sweep.
- **Operator:** pack rendering and per-part download authorization (a part of another request is refused).
- **E2E:** picker keyboard operation, selection changing the range, 390 px layout, no console errors, no-private-estimates fallback; operator pack section.
- Existing STL/3MF suites unchanged. Docs: update `docs/PRINT-ESTIMATION.md` (flow, configuration table, failure table) and `docs/VERIFICATION.md`.

## Configuration additions

| Variable | Default | Purpose |
|---|---|---|
| `PRINT_ESTIMATE_MAX_PACK_PARTS` | 16 (max 32) | Model entries accepted from one ZIP |

All other archive limits reuse the existing `PRINT_ESTIMATE_MAX_*` variables.

## Open assumptions (stated, not blocking)

- A single pack rollup (one setup charge) is the intended pricing; if the owner prefers a per-part minimum, it is a change to the rollup function only.
- Quantity cap of 99 per part and 16 parts per pack are starting values.
