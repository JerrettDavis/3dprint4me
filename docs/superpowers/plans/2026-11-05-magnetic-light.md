# Magnetic light baseplate implementation plan

**Goal:** Add a configurable magnetic light baseplate closely resembling RIP_Plo-Koon's Printables 250550 reference, preserving the other constructions.

**Architecture:** Extend the existing isomorphic definition and Manifold builder. Retain the 42 mm grid and mating profile, removing the subfloor between rounded corner tabs. Magnets insert from above; optional smaller bores continue through the pocket floors.

**Tech stack:** Existing JavaScript schema, Manifold WASM, 3MF exporter, Python/Playwright.

## Design and reference evidence

The user approved a magnetic light option and specifically requested a near-identical reference shape with configurable thickness and opening size. Reference: https://www.printables.com/model/250550-gridfinity-magnet-light-baseplate by RIP_Plo-Koon. Direct Printables access is blocked by its verification page. Inspected the author's photograph and single-cell 3MF preview through cached image delivery from Polyzon; the preview URL is `https://media.printables.com/media/prints/250550/stls/5247587_4d45ed57-9cbf-41da-a8d5-e5af8831c7fb_6f32b9b8-cf7b-462f-b942-7179da07f4fe/gridfinity_magnet_light_baseplate_1x1_press_fit_magnets_remix_preview.png`. Original model bytes could not be retrieved, so do not claim a measured replica or use invented source dimensions.

Implement independent geometry with the existing MIT mating profile: rounded plate perimeter; open rectangular cells; rounded inner corner tabs attached to both adjacent rails; four top-open pockets at ±13 mm; optional 3 mm bores through their floors. Include visible attribution and a reference link in the local license notices. No third-party requests at runtime.

Agent choices: `light_base_mm` 2.4–5 mm (default 2.8), measured below the fixed 4.75 mm mating section; `light_opening_mm` 30–39.6 mm (default 36); `light_tab_wall_mm` 0.8–2 mm (default 1.2); `light_magnet_diameter_mm` 5.8–6.6 mm in 0.01 mm steps (default 6.5, permits press-fit tuning); shared depth 2–2.4 mm (default 2.2); optional `light_through_holes` on by default, diameter 2.8–3.6 mm. Keep at least 0.4 mm pocket floor and 1.2 mm outer rail. Opening size describes the square cutout before the corner tabs, not an unobstructed square. Presets: magnetic light, one-cell magnetic fit sample, and a tighter nominal press-fit starting point (never a guaranteed fit). All advanced values travel through existing provenance/private intake and validate server-side. Existing styles and parameters keep their meaning and default behavior.

## Tasks

- [x] Add failing geometry/schema tests for open centers, top-open pockets, through-holes, rounded tabs, adjustable thickness/opening/walls, floor safety, full mating clearance, extrema and connectivity.
- [x] Implement the schema, presets and builder; pass focused tests with real Manifold and 3MF exports.
- [x] Cover browser edits, advanced controls, presets, recovery, offline download, private hand-off and mobile light/dark screenshots.
- [x] Update generator/printability docs and print fixtures. Build, version assets, run npm test and screenshots; inspect preview-board and dedicated views. Review the full diff and record evidence.

## Constraints and review focus

Only public/ deploys; no remote Customize requests, secrets or public uploads. Keep old style output unchanged. Reject unsafe floor/depth combinations on direct submissions; clamp committed edits to retain a printable floor. Verify 1×1, 1×6, 6×1, 6×6 and maximum opening/minimum rail corners. Check actual tab/rail junctions, not only nonzero volume. Physical magnet/bin fit remains unverified and requires a sample.

## Verification record

- Watched the new schema/geometry tests fail because `magnetic-light` was unsupported, then pass after implementation. All 18 focused tests pass, including direct floor/tab-wall probes at both configuration extremes and fixed-foot intersection checks through 6 × 6.
- All 18 Gridfinity browser checks pass, including advanced edits, local draft recovery, offline export and private intake provenance for the new construction.
- Exported and sliced 11 fixture pairs with PrusaSlicer 2.5.0, including the three new light magnetic cases. The checker confirms continuous layers, zero support paths and the existing continuous vase wall. Recorded model/STL hashes in `docs/gridfinity-slicing-report.json`. Wide openings produce expected short bridge/overhang toolpaths beneath the mating rails; the UI and guide disclose them.
- `npm run screenshots` captured 178 images and the preview board. Inspected the new desktop/mobile views in light/dark and the preview board's Gridfinity rows (bounded crops of the 1680 × 79994 board). The model was also compared visually with the reference's photograph and single-cell preview.
- Independent read-only code review found no blocking issues. Its suggested extrema floor/tab-wall coverage was added and passed.
- Initial full validation found stale ignored `public/handbook/` output from the previous documentation build, with Pages-relative links unsuitable for the storefront validator. Moved that generated directory to `.superpowers/handbook-before-magnetic-light` within this isolated worktree and regenerated asset versions; no tracked handbook source or production policy was changed.
- Full `npm test` passed: 1,312 unit/contract checks, 485 browser checks (five skips), and all 241 UX/accessibility checks.
- A final maximum-clearance probe exposed a 0.04645 mm loss of nominal height with 3.75 mm outside corner radii on a single-cell light frame. Watched the new height assertion fail, then tightened only this construction's outer radius to 3.5 mm. All extrema now retain the configured base thickness plus 4.75 mm mating height. Independent delta review found no issues.
- Rebuilt/versioned/validated the final bundle after that correction. All 18 focused geometry checks, eight Gridfinity preset/design/export/analyzer checks, and all 18 focused browser checks pass on the final implementation. The latter explicitly confirms the wide-opening bridge guidance appears in the actual built worker's output. Re-exported and re-sliced all 11 fixtures; the committed report describes this final geometry. Refreshed all 178 screenshot captures and inspected the final preview board's Gridfinity rows and dedicated views. All supporting source changes outside the feature's own files were checked to contain only required asset-version keys.
