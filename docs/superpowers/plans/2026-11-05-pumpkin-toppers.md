# Pumpkin toppers implementation plan

> Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Detailed extensible festive hats on the exact supplied pumpkin, reviewed by a screenshot committee and deployed green on main.

**Architecture:** Exact worker-only reference mesh plus shared mould/peg mount and style registry. Existing parametric builder remains selectable. Presentation assembles parts; printable export lays them out separately.

**Tech stack:** Existing Manifold, fflate, customizer schema/worker, Node tests, Python/Playwright screenshots.

**Spec:** ../specs/2026-11-05-pumpkin-toppers-design.md

## Global constraints

Keep all generator resources on-origin and offline, private hand-off unchanged, five colors maximum, existing responsive/theme/accessibility behavior intact. Preserve exact reference dimensions and round Ø4 mm hole. Do not claim physical fit or support-free printing.

## Review focus

Reference socket origin differs from bounding-box center; legacy drafts must retain their geometry; moulded undersides must not leave trapped interior material; tiny decorations must be attached and printable; single-color downloads must retain visible detail.

- [x] Import exact main-shell coordinates through `scripts/import-pumpkin-reference.py`; generate `customizer/generators/pumpkin/reference-data.js` and provenance. Add failing reference fidelity tests, then loader `reference.js`; confirm Manifold bounds/socket/coordinate fidelity and clean analyzer output.
- [x] Add shared mount and witch/Santa/baseball builders under `customizer/generators/pumpkin/toppers/`; test real solids, mould intersection, peg clearance, connected details, extrema and resource lifetime before integrating UI.
- [x] Add reference mode/export/hat controls and festive gallery designs to pumpkin definition; bump version with legacy defaults; dispatch reference mode in `build.js`; pin schema, server revalidation and legacy behavior in tests.
- [x] Add offline browser download/hand-off coverage and screenshot capture for assembled hats and their undersides; run build/version/test/screenshots, inspect preview board and model closeups; fix failures.
- [x] Have three independent committee reviewers inspect generated screenshot files and record findings; revise and repeat review where needed. Update `docs/GENERATORS.md` and release evidence.
- [ ] Commit/push/review PR, merge after green CI, verify main CI/deployment and live offline edit/download/request hand-off. Only then complete goal.
