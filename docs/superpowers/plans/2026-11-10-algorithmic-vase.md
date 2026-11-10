# Algorithmic Vase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build, test, review, merge, deploy, and verify an original offline vase studio with editable spline profiles, algorithmic forms and relief, and hollow or solid slicer-vase exports.

**Architecture:** A pure shared domain module evaluates bounded profile/pattern settings. A customizer builder creates one closed manifold mesh from that field. A reusable profile form control stores the same structured value consumed by drafts, provenance, and server validation.

**Tech stack:** Existing JavaScript ES modules, customizer worker/build pipeline, local 3MF export, Node test runner, Playwright, and existing deployment tooling. No remote generator dependencies.

**Spec:** `docs/superpowers/specs/2026-11-10-algorithmic-vase-design.md`.

## Global constraints

- Only `public/` is static output; no secrets or customer data in browser assets.
- No off-origin generator requests, including fonts and workers.
- All four service paths and recoverable no-integration intake remain functional.
- Preserve theme modes, reduced motion, keyboard access, and 390 px layout.
- All submitted settings and provenance are revalidated on the server.
- Profile points: 3–12, fixed endpoint heights 0/1, minimum adjacent height distance 0.02.
- Export cannot use a stale preview revision. Invalid geometry produces actionable errors.

## Review focus

1. Narrow mouths and strong relief must not collapse hollow walls or produce intersections.
2. Malformed profile arrays must fail consistently in browser and server, including nonfinite values and duplicate heights.
3. Rapid edits followed by export must export the current valid revision.
4. Facets and high-frequency patterns must preserve seam topology and adequate sampling.
5. Solid spiral-mode exports must be closed solids; hollow exports must have an open mouth and closed base.

## Task 1: Establish contracts and reference evidence

Files: `docs/GENERATORS.md`, existing schema/runtime/form/worker tests, new `docs/VASE.md`.

- [ ] Read complete generator contract and current representative builder, definition, form, worker, domain validator, and export tests. Record exact integration points before edits.
- [ ] Inspect all supplied reference URLs in the authenticated browser. Record traits and access failures per URL; do not copy geometry or source.
- [ ] Define parameter names, units, safe numerical limits, preset settings, pattern evaluation order, triangle/memory ceilings, and the hollow construction/separation algorithm in `docs/VASE.md`.
- [ ] Record the chosen construction's explicit rejection conditions, including a stable untextured base transition and inner-mouth clearance.
- [ ] Commit the contract and evidence document.

## Task 2: Shared profile and procedural field

Files: new `public/assets/js/customize/vase-shape.js`, new `public/assets/js/customize/generators/vase.js`, existing `public/assets/js/customize/schema.js`, new vase unit/contract tests following repository layout.

Interfaces: `evaluateVaseRadius(settings, normalizedHeight, angle)` returns a finite positive radius in mm; `sampleVaseProfile(points, normalizedHeight)` evaluates a shape-preserving cubic interpolation; the definition exports the established generator contract at version 1.

- [ ] Add failing tests for endpoint interpolation, no overshoot, point limits/order/separation, malformed values, and deterministic seeded results.
- [ ] Add failing tests for final diameter bounds and each smooth, dune, ripple, blossom/lobed, faceted, scale, cell, zigzag, and multiscale preset family.
- [ ] Implement bounded structured profile validation and pure interpolation/field evaluation. Use one documented composition order and normalization pass.
- [ ] Add schema/definition tests proving canonical profile settings survive serialization and reject excessive data on both client and server.
- [ ] Run the targeted tests, verify all assertions pass, and commit.

## Task 3: Printable geometry and independent export checks

Files: new `customizer/generators/vase/build.js` and focused geometry helpers, `customizer/generators/index.js`, export/geometry tests and fixtures.

Interfaces: builder consumes normalized version-1 vase settings and returns the existing framework model result. One periodic radial surface feeds mode-specific closures and wall construction.

- [ ] Add failing independent topology tests for boundary edges, edge incidence, winding, positive volume, flat base, final dimensions, and hollow/solid cross sections.
- [ ] Add difficult fixtures for narrow necks, strong twist, high-frequency relief, steep profiles, and faceted hollow shapes. Assert either valid geometry or a specific actionable rejection.
- [ ] Implement adaptive sampling with explicit ceilings and periodic shared seam vertices. Implement solid caps and hollow base/wall/rim geometry under the documented minimum-separation contract.
- [ ] Exercise actual exported 3MF archives through independent mesh inspection, not only builder-returned geometry.
- [ ] Run targeted tests and commit the passing builder and registry entry.

## Task 4: Accessible profile editing and complete studio integration

Files: new `customizer/framework/profile-input.js`, existing `customizer/framework/form.js`, `customizer/styles.css`, app/worker/revision integration files identified in Task 1, generator catalog/page/registry, existing server domain registry.

Interfaces: profile editor consumes a canonical points array and emits that array through the existing change callback. Numeric controls and pointer handles edit the same state.

- [ ] Add failing browser tests for keyboard and pointer point editing, add/remove, endpoint constraints, validation messages, and draft restoration.
- [ ] Implement a labeled SVG profile view with equivalent numeric controls, focus visibility, and accessible announcements. Keep usable layout at 390 px.
- [ ] Integrate presets, mode-specific controls, seed randomization, reset, shared settings, provenance, and server registry validation.
- [ ] Add rapid-edit/export coverage and implement revision checking plus actual stale computation interruption using the framework's supported mechanism.
- [ ] Verify themes, reduced motion, current-revision downloads, recoverable handoff, malformed server payloads, and offline editing/export; run targeted checks and commit.

## Task 5: Slicing, visual review, and complete regression validation

Files: `docs/VASE.md`, `docs/GENERATORS.md`, release evidence and focused screenshots; generated static assets and asset version references.

- [ ] Build with `npm run customizer:build` and `npm run assets:version`; verify generated output and CSP remain same-origin.
- [ ] Slice representative hollow and solid fixtures with appropriate slicer settings. Inspect layer results, openings/base, relief, and warnings. Record material/printer-dependent physical limitations.
- [ ] Run `npm run validate`, `npm test`, required browser and accessibility suites, and `npm run screenshots`.
- [ ] Inspect `screenshots/preview-board.png` and focused desktop/mobile vase screenshots. Fix observed defects and rerun affected checks.
- [ ] Review source, generated artifacts, validation, error messages, private handoff behavior, and full requirements against the spec. Commit verified results.

## Task 6: Land and verify production

Files: final PR, CI runs, deployment records, `docs/VASE.md` release evidence.

- [ ] Create/review the PR with problem, resulting behavior, validation, and physical print limitations. Resolve review findings.
- [ ] Wait for all required hosted checks to pass; merge to main and verify main checks.
- [ ] Deploy required static and API changes using established release procedures. Verify both production apps and handbook as applicable.
- [ ] Verify live desktop/mobile rendering, all preset families, profile edits, both exports, offline behavior, provenance validation, private request handoff, and all four service paths.
- [ ] Record authoritative production URLs, commits, CI/deployment evidence, and any physical-print limitations. Mark the goal complete only after all requested release criteria are proven.

## Plan self-review

Each original scope item maps to Tasks 2–4, geometry/print claims to Tasks 3 and 5, and requested green-main/deployed readiness to Task 6. Reference review is explicitly pending in Task 1. Exact framework interfaces must come from current-source inspection before edits; the plan does not presume an unsupported profile schema or cancellation API. No user product decision is currently blocking execution.
