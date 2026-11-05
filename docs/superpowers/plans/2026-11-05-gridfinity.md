# Gridfinity implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement task by task, with tests and review.

**Goal:** Ship configurable Gridfinity plates and bins, including an honest printable vase workflow, on green deployed origin/main.

**Architecture:** Two isomorphic generator definitions share dimensional helpers and Manifold construction helpers. Existing studio, private request intake and download flow remain the integration boundary.

**Tech Stack:** JavaScript, Manifold WASM, Three.js, Vite, existing 3MF export, Node tests and Playwright.

**Spec:** `docs/superpowers/specs/2026-11-05-gridfinity-design.md`

## Global constraints

No remote Customize requests; only public/ is deployed; no secrets or uploads made public. Grid pitch 42 mm, nominal cell bin size 41.5 mm, height step 7 mm. No claimed physical fit test. Pixel editor deferred.

## Review focus

Maximum footprints must finish within the browser build budget. Direct server submissions must reject vase/divider/magnet combinations that the UI hides. Single-row rails and smallest bins must remain connected. Magnet roofs must retain material. Vase downloads must keep adapters out of spiral printing.

### Task 1: Dimensions and provenance

Files: `public/assets/js/customize/gridfinity.js`, `customizer/generators/gridfinity/shared.js`, `tests/unit/customize-gridfinity.test.mjs`, `customizer/static/licenses/gridfinity.txt`.

- [x] Write failing tests for 42 mm centers, 41.5 mm footprints, exact foot profile sections, height and bounded schemas.
- [x] Implement shared pure constants/position helpers and Manifold profile builders, disposing intermediate objects.
- [x] Preserve upstream MIT notices and add provenance documentation.
- [x] Run focused tests and commit.

### Task 2: Baseplate generator

Files: definition `public/assets/js/customize/generators/gridfinity-base.js`, builder `customizer/generators/gridfinity-base/build.js`, page `customizer/g/gridfinity-base/index.html`, both registries, tests from Task 1.

- [x] Add failing tests for conventional/reduced-material/magnetic plates, socket dimensions, connectivity, magnet pocket geometry and volume differences.
- [x] Build connected support-free plates and bounded rows/columns/clearance controls with starting designs and print facts.
- [x] Register page/builder/catalog and verify real 3MF defaults and presets.
- [x] Commit passing focused changes.

### Task 3: Container generator and separate vase print workflow

Files: definition `public/assets/js/customize/generators/gridfinity-bin.js`, builder `customizer/generators/gridfinity-bin/build.js`, page `customizer/g/gridfinity-bin/index.html`, both registries; narrowly extend download packaging if needed for separate vase shell and adapter exports.

- [x] Add failing tests for ordinary/thin/labeled/divided/magnetic bins, foot fit, floor thickness and label underside angle.
- [x] Implement controls, cross-field validation, connected geometry and useful starting designs.
- [x] Add failing tests that vase shell is a single perimeter with a flat floor, adapter is a separate conventional print, and incompatible options are rejected.
- [x] Implement separately downloadable vase shell and adapter with correct slicer settings and visible assembly directions; verify print-operation isolation.
- [x] Verify each variant through real Manifold and analyzer; commit.

### Task 4: Browser coverage and release

Files: new Gridfinity browser tests, existing generator contract tests where cardinality is pinned, `docs/GENERATORS.md`, generated asset versions and screenshot artifacts as repository policy requires.

- [x] Test catalog, presets, edits, recovery, offline downloads, request hand-off and vase exports in browser at desktop and 390 px.
- [x] Run build, asset versioning, full npm test and screenshots; inspect preview board and both new pages in light/dark themes.
- [x] Independent review against the complete spec; resolve findings and rerun affected checks.
- [ ] Push PR, verify required CI, merge to origin/main, verify both deployments and live smoke including generator downloads and intake.

## Pre-merge verification record — 2026-11-05

Implementation is committed on `feat/gridfinity-generators`; PR #69 (ready for review): https://github.com/JerrettDavis/3dprint4me/pull/69 . Worktree `G:/git/3dprint4me-gridfinity`, based on origin/main `0ec3bbe`. The original checkout's unrelated edits remain untouched.

Completed evidence:

- Fifteen focused geometry/server tests pass, including fixed mating dimensions, same-plane seating, maximum footprints, pocket adjustment, measured floor/divider/shelf geometry and server rejection of incompatible vase settings.
- Thirty-one focused browser checks pass: both browsing catalogs, preset selection, private intake, component provenance, offline edits/downloads, local recovery, mobile themes, realistic preview and blocked-IndexedDB download fallback.
- Eight real exported fixtures independently sliced in PrusaSlicer 2.5.0 with supports disabled. Report: `docs/gridfinity-slicing-report.json`. Continuous vase wall: 2,768 rising extrusion moves, no wall retracts/travel and six measured floor layers. Standard and labeled/divided/magnetic bin lips retain the expected 46 mm final layer.
- Independent review found no remaining product/code blocker after corrections. The light base now relieves lower rails while preserving full 4.75 mm seating height; the stacking lip truncates the knife tip to a 0.4 mm land at rim+4 mm, without changing seating height. Magnet-pocket dimensions are adjustable and bounded.
- Final `npm run screenshots` passed: 176 captures. Inspected the preview board's changed storefront/customizer region via cropped review sections (the original board is 132 MP and too large for the image tool) and new desktop/mobile captures directly. Customer guide, generator reference, image provenance and printability docs updated; reviewed publication hashes and nav updated for handbook publication.
- Both Vercel previews deployed successfully. Storefront authenticated preview smoke passed four offline downloads (base, standard bin, vase shell, adapter), correct isolated settings and enabled request actions. CLI auto-link briefly created an empty worktree-named project; verified zero deployments, removed it and verified absence. Local `.vercel` now explicitly points to the existing storefront, and is ignored.

Verification and release state at this checkpoint:

- Final `npm test` completed successfully (exec session 26744, terminal exit 0): 1,309 unit/contract checks, 479 browser checks with five environment skips, and all 241 UX checks. Log: `gridfinity-final-test.log`. No local test or screenshot process remains running.
- Handbook checks complete: 115-page build/link validation, four integration unit checks and two browser theme/navigation/search checks pass. Logs: `gridfinity-docs-final.log`, `gridfinity-docs-browser.log`. The direct pytest wrapper misreported the browser invocation; a raw `pytest.main` run confirmed both pass.
- GitHub verify job for PR #69 was live; poll current head checks before merging. Push the final screenshots/docs checkpoint, then let required CI pass. PR is ready; merge only after required checks for the final pushed commit pass.

Earlier full browser run ended with 15 failures, all old catalog-count assertions or missing Gridfinity matrix edits/import quoting. Those were corrected and covered by the 31-check focused rerun. Earlier screenshot attempt failed during concurrent bundle rebuilding; final stable-build capture passed. Do not substitute those older runs for final full verification.

Remaining release gates: final hosted CI for the audit-evidence commit; mark PR ready, merge to origin/main; verify both production deployments, handbook publication and live same-origin/offline generator downloads. Physical sample fit is disclosed as unverified; the pixel editor remains a future revision as requested.
