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
- [ ] Record reference topology, exact dimensions and provenance without distributing unapproved source meshes.
- [x] Write failing tests for bounded hinge parameters, real bearing clearance, retention and independent connected solids.
- [x] Implement internal double-pivot connector and socket tools with explicit temporary-solid ownership.
- [x] Run focused tests and inspect geometry; retain limitations until folding and slicing checks pass.

### Task 2: Complete mechanical families

Files: `customizer/generators/infinity-fidget/{build,assemblies,shapes}.js`, pure topology module, mechanical motion tests.

- [ ] Define measured cube topology and independent folding sequence.
- [ ] Build eight bodies and captured connectors; validate loop closure, movement, gaps and part accounting.
- [ ] Add rectangular and spherical bodies with preserved movement envelopes.
- [ ] Implement actual infinity-triangle topology from accessible source/mechanical evidence.
- [ ] Exercise parameter boundaries; slice samples and fit coupons, inspect layers and printable starts.

### Task 3: Surface, symbols, images and materials

Files: generator definition, `customizer/generators/infinity-fidget/decoration.js`, geometry/export tests.

- [ ] Test and implement smooth, chamfered, knurled, ridged, hexagonal and line surfaces.
- [ ] Add per-block symbols/text and local simple-image decoration using existing tracing and fonts.
- [ ] Add individual block colors with five-material validation and nonoverlapping material partitions.
- [ ] Prove geometry survives actual STL and 3MF parsing, including small features and worst-case workload.

### Task 4: Studio integration and release

Files: public definition/registry, builder registry, generator page, browser tests, generator docs, screenshots, generated assets.

- [ ] Integrate presets, controls, fit coupon, local drafts, downloads and private order handoff.
- [ ] Verify image edits, all shapes/details, theme, keyboard, reduced motion, 390 px and offline reload/edit/export.
- [ ] Run customizer build, asset versioning, `npm test`, screenshots and inspect preview board.
- [ ] Update docs and commit coherent implementation; obtain code review and green PR Actions.
- [ ] Merge main, deploy authorized production targets, inspect live downloads/offline edits/handoff and require green main Actions.

## Execution ledger

2026-11-09: isolated branch `feat/infinity-fidget-generator` starts at `4c1c05e`. Original workspace contains unrelated changes and was left untouched. Local reference `InfinityCubeFidget(5).3mf` has eight 20 mm block bodies plus eight independent connector solids; source mesh bounds approximately 82.4000 × 40.8068 × 20 mm. Actual triangle source remains uninspected. Full baseline unit/contract suite is running under session 66718; check its authoritative result before claiming baseline success.

Baseline session 66718 finished successfully: 1,338 passed, one skipped, zero failed. Six new focused tests pass for bounds, closed solids, neutral gaps/capture, export analysis and individual socket quarter-turns. A neutral-only socket first failed at 47 degrees; the retained regression now passes after adding an analytic swept envelope. An attempted 3D sampled sweep was deliberately terminated because it generated excessive geometry; the final 2D sector/annular sweep replaced it and focused tests complete in roughly 1.3 seconds. This is an internal engineering coupon, not a completed mechanism.

Ruling: inspect the MIT Jan Pieper source before choosing final production connectors. Its conical captured bearings and sacrificial supports are stronger manufacturing evidence than the independent cylindrical coupon. Do not preserve the coupon as the final mechanism merely because its tests pass. Evidence and pinned source revision are in `docs/design-concepts/infinity-fidget-reference-evidence.md`.

Fresh-context core review found no important/critical defect. Its one test-temporary leak was corrected by tracking the source cube as well as its translated copy. Full current unit/contract run is under session 21218. Build and asset versioning succeeded; validation exited zero before the final mechanical-only source changes. No public generator is registered yet, and no deployment has been attempted.

Checkpoint verification: session 21218 finished with 1,345 tests passed and zero failures/skips. Fresh customizer build and asset versioning succeeded; session 63978 validation passed (17 HTML pages, 211 local references, 650 JS files; architecture boundaries passed for 236 JS files). `git diff --check` is clean. The updated coupon preview was rendered and visually inspected at `screenshots/fidget-hinge-fit.png`. No customer-facing UI changed, so the site-wide screenshots and full browser/audit run remain release-stage work. STL/3MF engineering samples, source thumbnail and test logs remain untracked in this worktree: automatic approval review rejected the cleanup/move command with “blocked by policy,” so it was not performed. The current full generator task remains active and incomplete.
