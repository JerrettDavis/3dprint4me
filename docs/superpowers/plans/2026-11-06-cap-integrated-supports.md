# Cap fit and integrated supports

Use superpowers:executing-plans inline; maintain the existing isolated worktree.

User direction: bill edges must meet the dome flush; enlarge the dome for better proportions. Include removable support geometry wherever required, specifically Santa's pompom. Keep the exact pumpkin shell/socket unchanged.

- [x] Add failing geometric tests for a broader crown, bill-root overlap, support beneath the pompom, support/model separation, exports and presentation.
- [x] Broaden the cap and attach its bill ends within the crown; keep seams, vents and trim on the revised surface. Preserve v4 geometry through version defaults.
- [x] Generate removable support posts from actual downward-facing surfaces and vertical empty intervals. Include support solids in downloads, omit them from assembled presentation, and keep the original shell unchanged. Explain removal and layer-preview limitations.
- [x] Build/version assets, run focused and full tests, capture/inspect screenshots, and slice with automatic support disabled to inspect the integrated supports.
- [ ] Review the changed branch and renders, update documentation, and release through green PR/main and live verification.

Implementation choices: same Manifold framework, no remote resources/dependencies; 0.16 mm support separation and thin tapered contacts designed for 0.16 mm PLA layers. Fit and removal remain unverified physically. Existing versions retain original defaults.

Review ruling: preserve the explicit 30 mm legacy mesh; derive bill width and stitch rows for every fitted size (31-40 mm). Root probes reproduced the 31 mm failure and now pass across the range. Original-cap mesh hash matches the released implementation.

Validation in progress: focused geometry and resource tests pass; three automatic-support-OFF slices succeeded; actual Santa G-code layers and clear support screenshots approved. Full regression, normal screenshot board and release checks remain required.

Local evidence: 1,323 unit/contract tests pass; broad browser run 485 pass and five existing skips, with only three new archive-location assertions failing; those corrected tests subsequently all pass (support IDs verified against meshes). UX 241/241; 188 screenshots complete and festive board region visually inspected; handbook build/link checks and final static validation pass. Hosted full npm test remains the final coherent full-suite gate.

Slicer ruling: increase fitted-cap stitch radius to 0.28 mm at Z=30.28 mm. Actual
G-code omitted the thinner visible-only relief. The new relief test failed before
the change and passes afterward; both stitch rows now survive two 0.16 mm layers.
