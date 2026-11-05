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

- [ ] Write failing tests for 42 mm centers, 41.5 mm footprints, exact foot profile sections, height and bounded schemas.
- [ ] Implement shared pure constants/position helpers and Manifold profile builders, disposing intermediate objects.
- [ ] Preserve upstream MIT notices and add provenance documentation.
- [ ] Run focused tests and commit.

### Task 2: Baseplate generator

Files: definition `public/assets/js/customize/generators/gridfinity-base.js`, builder `customizer/generators/gridfinity-base/build.js`, page `customizer/g/gridfinity-base/index.html`, both registries, tests from Task 1.

- [ ] Add failing tests for conventional/reduced-material/magnetic plates, socket dimensions, connectivity, magnet pocket geometry and volume differences.
- [ ] Build connected support-free plates and bounded rows/columns/clearance controls with starting designs and print facts.
- [ ] Register page/builder/catalog and verify real 3MF defaults and presets.
- [ ] Commit passing focused changes.

### Task 3: Container generator and separate vase print workflow

Files: definition `public/assets/js/customize/generators/gridfinity-bin.js`, builder `customizer/generators/gridfinity-bin/build.js`, page `customizer/g/gridfinity-bin/index.html`, both registries; narrowly extend download packaging if needed for separate vase shell and adapter exports.

- [ ] Add failing tests for ordinary/thin/labeled/divided/magnetic bins, foot fit, floor thickness and label underside angle.
- [ ] Implement controls, cross-field validation, connected geometry and useful starting designs.
- [ ] Add failing tests that vase shell is a single perimeter with a flat floor, adapter is a separate conventional print, and incompatible options are rejected.
- [ ] Implement separately downloadable vase shell and adapter with correct slicer settings and visible assembly directions; verify print-operation isolation.
- [ ] Verify each variant through real Manifold and analyzer; commit.

### Task 4: Browser coverage and release

Files: new Gridfinity browser tests, existing generator contract tests where cardinality is pinned, `docs/GENERATORS.md`, generated asset versions and screenshot artifacts as repository policy requires.

- [ ] Test catalog, presets, edits, recovery, offline downloads, request hand-off and vase exports in browser at desktop and 390 px.
- [ ] Run build, asset versioning, full npm test and screenshots; inspect preview board and both new pages in light/dark themes.
- [ ] Independent review against the complete spec; resolve findings and rerun affected checks.
- [ ] Push PR, verify required CI, merge to origin/main, verify both deployments and live smoke including generator downloads and intake.

## Progress

2026-11-05: Research and architecture recorded. Isolated worktree `<repo-root>/dprint4me-gridfinity`, branch `feat/gridfinity-generators`, based on origin/main `0ec3bbe`. Original checkout contains unrelated edits and remains untouched. No implementation or release claim yet.
