# Algorithmic vase studio

Release candidate on `feat/algorithmic-vase`; hosted CI, merge and production verification remain pending. See the algorithmic-vase design and implementation plan under `docs/superpowers/`.

## Controls and original forms

Ten presets cover wind-shaped dunes (default), classic urn, blossom, ripple, hollow faceted planter, faceted rose, scales, cells, zigzag crystal and organic multiscale relief. These are independently authored mathematical forms; no reference mesh or source is included.

The profile editor supports dragging, labeled numeric coordinates, adding/removing points, and base/mouth outside diameters in millimeters. Physical controls solve the canonical endpoint radius using the same sampled envelope as the builder. Unreachable sizes clamp with an accessible achievable-range explanation. Diameters describe the centered outside envelope including deformation, rather than the hollow opening or polygon flat-to-flat span. Changing an endpoint can affect normalization and the other end's diameter.

Profiles contain 3–12 independent `{height, radius}` objects. Normalized heights span 0–1 with fixed endpoints and a minimum neighbor gap of 0.02. Radii span 0.05–1. Browser and server reject nonfinite values, sparse arrays and malformed points. Shape-preserving PCHIP interpolation passes through each point without interval overshoot.

Height is 30–250 mm; maximum centered envelope diameter is 30–220 mm. Polygon sides are 0 or 3–32, twist ±360 degrees, lobes 0–16, relief/lobe depth 0–0.3, organic displacement 0–0.2, repeats 1–24 and seed 0–65535. Wall thickness is 0.8–4 mm and base thickness 0.8–6 mm. Printer fit remains the customer's responsibility.

## Geometry contract

The radial field composes spline profile, polygon, lobes, surface relief and seeded periodic organic displacement. Twist changes angular phase. Relief and twist fade over the lowest 8% for a stable flat base. Multiscale relief sums three bounded octaves. Final shared normalization scales the completed sampled envelope to the requested diameter.

Sampling follows pattern frequencies, lobes, organic harmonics, facets and twist. Faceted rings rotate with the polygon to retain corners. Maximums are 1,024 angular segments, 512 height rows and 80,000 estimated vertices. Profile stations are included explicitly and the periodic seam shares indices. Excessive combinations return an actionable reduction message.

Solid construction closes both ends for slicer vase mode. Its 3MF requests spiral mode, zero top layers, zero infill and six bottom layers at 0.2 mm. Displayed solid volume describes the input envelope, not spiral-print material. Inspect actual slicer results and machine-specific settings.

Hollow construction erodes an extended closed envelope with Manifold `minkowskiDifference`, clips the cavity above the chosen base plane and subtracts it. A convex kernel scaled by its measured face inradius contains the requested thickness ball. Cavity-source simplification is limited to 0.2 mm; that allowance is added to erosion distance to protect separation conservatively. Walls can be thicker than requested. The simplified cavity source is limited to 16,000 triangles. Empty/disconnected cavities, mouth area below pi × 4 square mm, and excessive complexity return corrective errors. Hollow files use normal printing with spiral mode off.

Rapid edits terminate superseded vase workers; existing generators retain their queue behavior. Current-revision exports, drafts and private request handoff follow the generator contract. Assets, fonts, WASM and workers remain same-origin. Operator details render profile percentages with text-only DOM updates.

## Verification and limitations

Focused tests cover profile math/validation, deterministic fields, normalization, polygon corners, high-twist sampling, archive topology/winding, positive volume, cylinder wall separation, physical controls and operator formatting. Browser coverage includes ten presets offline, pointer/keyboard edits, drafts, private handoff, actual exported 70 mm base / 45 mm mouth dimensions, desktop visibility and 390 px light/dark/reduced-motion behavior. Independent code re-review approved the corrected sampler and controls.

`node scripts/verify-vase-geometry.mjs` exports all ten presets in both modes and independently analyzes actual 3MF archives, with a 22-second per-fixture process budget. `python scripts/vase-slice-check.py` uses isolated Bambu Studio configuration, checks errors/warnings and actual G-code, and requires continuous XYZ extrusion for spiral files. Local artifacts stay in ignored `.superpowers/vase-fixtures/`. Final regression, screenshots, slicing and hosted release evidence must be recorded before declaring production readiness.

The catalog image comes from actual local preview geometry via `python scripts/render-vase-product.py`. It is an illustrative render. Digital geometry/slicing do not certify water retention, strength, overhang quality, material safety or physical printing. Test an appropriate printer/material combination before making those claims.

## Reference access record

All fourteen supplied Printables pages were opened November 10, 2026 and returned the browser challenge title “Just a moment…” with `www.printables.com`. Authenticated Edge inspection was unavailable because the Computer Use native pipe failed, including after reset. No visual comparison or reference fidelity is claimed. Each reference was inaccessible for the same reason: 834831 dune; 538186 anti-sphere; 290951 olpe; 60696 blossom; 353853 dragon scales; 228303 tetrahex ripple; 288453 vase650; 1595 low-poly rose; 680360 modern wavy; 538175 inverted hex; 874182 nordic; 691907 mosaic; 290650 crystal; 43717 zigzag. No geometry/code was copied and no challenge bypass attempted.

## Local release evidence — November 10, 2026

The final source asset release is `6c6c04bbfe128f84`. All 20 actual exports passed independent archive analysis (one cells-hollow attempt timed out under concurrent load, then passed isolated in 18.163 seconds). All 20 fixtures sliced without warnings, with continuous spiral extrusion in every solid and spiral mode off for hollow files. Five attempts using reused output directories timed out; clean-directory reruns passed. The verifier now always creates fresh output directories. Detailed dimensions, triangles, runtimes and G-code checks are in [vase-verification.json](vase-verification.json).

The fresh local run passed 1,430 unit/contract tests; browser results were 524 passed, 7 skipped and one stale service-worker-version assertion failed. The corrected v36 upgrade assertion passed separately. UX/accessibility audit passed 241/241. Screenshot capture produced 194 images and the preview board; desktop/mobile vase views and board sections were visually inspected. Hosted integrated full checks remain required before merge.
