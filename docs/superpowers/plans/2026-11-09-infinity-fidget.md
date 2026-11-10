# Infinity fidget implementation plan

**Goal:** Release the complete customizable infinity cube and infinity-triangle generator on main with green Actions.
**Architecture:** Use the existing schema-driven offline studio and Manifold worker. Separate mechanical policy, captured connector geometry, assembly topologies, decoration and UI integration. Reference measurements inform requirements; independent motion and mesh checks establish behavior.
**Tech stack:** JavaScript ES modules, Manifold, existing Vite/Three.js customizer, Node tests, Python/Playwright and local slicing tools.
**Spec:** `docs/superpowers/specs/2026-11-09-infinity-fidget-design.md`

## Global constraints

Same-origin operation only; no remote generator dependencies. Five unique 3MF material colors maximum. All geometry must survive STL/3MF exports and private handoff. The triangle uses an infinity-triangle mechanism. Release is not complete without all requested shapes, details, image/symbol features and production verification.

## Review focus

- A neutral assembly may look correct but lock during folding: independent full-path transforms, loop closure and collision checks.
- A captured pin may fuse or print in air: inspect gaps and layer starts in sliced production geometry.
- Decorative relief may enter a bearing: reserve mechanical envelopes and test maximum detail settings.
- Eight block color controls may exceed five materials: explicit validation rather than silent recoloring.
- Source provenance may differ between original and remix: record measured source and applicable rights separately.

### Task 1: Reference evidence and shared captured hinge

Files: `public/assets/js/customize/fidget-mechanics.js`, `customizer/generators/infinity-fidget/hinge.js`, `tests/unit/customize-fidget-mechanics.test.mjs`, reference evidence document.

- [x] Inspect current main, existing framework contracts and local reference archive.
- [x] Record full scope and confirm infinity-triangle intent with user.
- [x] Record reference topology, exact dimensions and provenance without distributing unapproved source meshes.
- [x] Write failing tests for bounded hinge parameters, real bearing clearance, retention and independent connected solids.
- [x] Implement internal double-pivot connector and socket tools with explicit temporary-solid ownership.
- [x] Run focused tests and inspect geometry; retain limitations until folding and slicing checks pass.

### Task 2: Complete mechanical families

Files: `customizer/generators/infinity-fidget/{build,assemblies,shapes}.js`, pure topology module, mechanical motion tests.

- [x] Define measured cube topology and independent folding sequence.
- [x] Build eight bodies and captured connectors; validate loop closure, movement, gaps and part accounting.
- [x] Add rectangular and spherical bodies with preserved movement envelopes.
- [x] Implement actual infinity-triangle topology from accessible source/mechanical evidence.
- [x] Exercise parameter boundaries; slice samples and fit coupons, inspect layers and printable starts.

### Task 3: Surface, symbols, images and materials

Files: generator definition, `customizer/generators/infinity-fidget/decoration.js`, geometry/export tests.

- [x] Test and implement smooth, chamfered, knurled, ridged, hexagonal and line surfaces.
- [x] Add per-block symbols/text and local simple-image decoration using existing tracing and fonts.
- [x] Add individual block colors with five-material validation and nonoverlapping material partitions.
- [x] Prove geometry survives actual STL and 3MF parsing, including small features and worst-case workload.

### Task 4: Studio integration and release

Files: public definition/registry, builder registry, generator page, browser tests, generator docs, screenshots, generated assets.

- [x] Integrate presets, controls, fit coupon, local drafts, downloads and private order handoff.
- [x] Verify image edits, all shapes/details, theme, keyboard, reduced motion, 390 px and offline reload/edit/export.
- [ ] Run customizer build, asset versioning, `npm test`, screenshots and inspect preview board.
- [ ] Update docs and commit coherent implementation; obtain code review and green PR Actions.
- [ ] Merge main, deploy authorized production targets, inspect live downloads/offline edits/handoff and require green main Actions.

## Execution ledger

2026-11-09: implemented the complete generator in an isolated worktree. The production mechanism derives from the pinned MIT Jan Pieper source, with eight bodies and eight captured conical links. The permissioned triangle STL was inspected for topology and dimensions; no reference mesh is redistributed. Nine presets cover cube, rectangular, spherical and infinity-triangle bodies, finishes, artwork, writing and the fit sample.

Independent actual-mesh tests exercise a 14-phase closed folding sequence, including partial reversals, and meaningful dimension extremes. Analytic corner-gap controls preserve mechanical envelopes. Spherical bearing lands connect all pins to their bodies; the spherical fit sample uses the same bearing-foot bevel and passes an independent 0-90 degree collision regression. These checks are sampled geometric evidence, not physical fit, release-force or durability certification. Print the fit sample first.

All nine exported presets have successful Bambu Studio 02.08.02.61 slicing evidence with zero reported warnings. Preserve the original classic timeout report and successful retry separately. Production uses 0.2 mm layers, Arachne walls and automatic supports off, with designed removable strips, posts and bearing-tip stalks.

Verification: 1,385 unit/contract tests passed before the final spherical fit regression; the final focused fit/folding run passed eight tests. Build, asset versioning and validation passed. The 190-screen screenshot run completed; the preview-board crop and desktop/mobile fidget screens were inspected. The final anonymous browser run was interrupted at the user's request after reporting a failure; it is not counted as a passing run. Browser verification now uses the user's existing Edge session. Prior full browser run passed 500 tests with five skips and six stale catalog-count failures; those expectations were updated. Independent review found no material issue with the integration or final spherical fit fix.

Release remains incomplete until reviewed commits have green Actions, main is merged, the native API registry and storefront are deployed, and live checks pass.
