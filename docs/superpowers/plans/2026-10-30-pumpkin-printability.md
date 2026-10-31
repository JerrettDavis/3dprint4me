# Pumpkin face printability

Goal: optimize face cutouts for upright printing and explain remaining support needs by mode, then deploy.

Design: a default-on cutout-only option adapts each disconnected feature to a convex lower outline and a peaked upper roof with slopes at least 45 degrees. It stays within that feature's bounds; concave details and the sunglasses bridge are omitted. The original outlines remain available. Inspect actual combined contours for shallow roofs and material islands. Multicolor inlays fill their pockets; engraving and loose glue-in pockets need separate guidance. Do not claim the whole pumpkin is support free.

- [ ] Add failing tests for all preset/custom feature roofs, component bounds, original outlines, and mode warnings.
- [ ] Implement the geometry helper, cutout option, version bump, builder integration and warning guidance.
- [ ] Add browser coverage, document the adaptation and limitations, build/version assets.
- [ ] Run npm test and screenshots; inspect preview board and actual optimized faces.
- [ ] Review, commit, deploy the storefront and verify live generated assets and behavior.

Constraints: preserve private intake, same-origin generator execution, existing layout/orientation and slicer settings. No physical print guarantee: a 45-degree planar roof is a design heuristic; shell curvature, extrusion depth, material and slicer settings still matter.

Baseline: current origin/main 2400019; 75 pumpkin unit/geometry tests passed before changes. Existing unrelated checkout edits are outside this isolated branch.
