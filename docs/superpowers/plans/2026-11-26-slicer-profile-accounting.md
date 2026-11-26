# Profile-aware slicing implementation plan

**Goal:** Account for actual printer profiles, automatic tree supports, color changes and production waste in estimates, then land green on main.

**Architecture:** Extend existing trusted slicer adapters and immutable estimate snapshots. Keep geometry-only planning available when production evidence is unavailable.

**Spec:** ../specs/2026-11-26-slicer-profile-accounting-design.md

## Constraints
Private uploads and credentials remain private. No customizer remote requests. Unknown measurements remain unknown. Total filament must include production waste exactly once. Unresolved color assignments must be visible and cannot silently become single-color production evidence.

## Tasks
- [x] Correct missing-versus-zero swap accounting in both CLI parsers; reject malformed numerical summaries. Test absent, explicit zero, multicolor and partial plate summaries before implementation.
- [x] Verify pinned slicer source/CLI and deployed profile artifacts. Implement trusted material/quality profile selection and automatic tree supports, including reproducible effective-profile identity. Test unsupported materials and invalid profiles.
- [x] Detect 3MF color assignments, preserve supported assignments and facilitate unresolved mapping through customer/operator review. Test plain STL, generic color 3MF and painted slicer projects.
- [x] Parse supported waste/support measurements with explicit total semantics. Propagate actual profile, support policy, swaps and accounting uncertainty through snapshots and safe projections. Verify no double counting.
- [x] Rehearse real flat, overhang and multicolor models with pinned slicer. Compare supports and material/time changes. Document evidence and production configuration.
- [ ] Run npm test, screenshots for visible changes, inspect preview board, review diff and PR, merge green and verify main.

## Review focus
Partial plate data must not become a complete total. Uploaded machine settings must not override trusted settings. Color count cannot predict swaps. Missing output cannot count as zero waste. Provider failures must preserve the recoverable planning estimate.
