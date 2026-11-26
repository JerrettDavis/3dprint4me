# Pinned Bambu CLI source review

Primary source: https://github.com/bambulab/BambuStudio/blob/v02.08.04.57/src/BambuStudio.cpp

Reviewed 2026-11-26 against the release pinned in `deploy/slicer-worker/Dockerfile.bambu`.

## Accounting contract
The CLI fills `filament_info.total_used_g` from `print_estimated_stat.total_volumes_per_extruder`. It fills `main_used_g` from model volume plus support volume. Both are converted to grams with the same per-extruder filament density. Therefore `total_used_g - main_used_g` measures non-model, non-support consumption. Name this `wasteGrams`, not purge-only grams: it includes tower and other waste. Total consumption already includes it; pricing must not add this component again.

`filament_change_times` is explicit per plate. Missing fields are unknown, including when a fixture reports only one filament. Incomplete plate or filament totals cannot establish whole-job totals.

## Controls requiring real-slice verification
- For Bambu 3MF with loaded filaments resolving to one filament, `disable_wipe_tower_after_mapping` becomes true outside estimate mode.
- The CLI can replace `stTreeAuto` with `stNormalAuto` if `support_type` is absent from `different_settings_to_system`.
- `estimate_mode` requires switching machines via loaded settings; it cannot be enabled as a universal fix for jobs targeting the original machine.
- The older multicolor rehearsal in `2026-10-02-multicolor-slicing.md` is useful historical evidence but does not prove current effective support or tower settings. Repeat with the exact new implementation and inspect generated settings and totals.

## Current regression evidence
Five new accounting regression tests failed before the corresponding changes and passed afterward. Together with existing Bambu contract and multicolor tests, 11 focused tests passed. Full-suite and real-slicer verification remain separate gates.

## Real multicolor baseline
Built `3dprint4me-slicer-profile-check:20261126` from this branch using the pinned Dockerfile. Ran `scripts/slicer-smoke.mjs` against the existing `three-color-bambu.3mf` fixture with `--network none` and read-only fixture/script mounts, without worker credentials.

Observed Bambu Studio 02.08.04.57, X2D machine/process profile and PLA: 20,919.42 seconds, 69.22 g total filament, 60.8678412437439 g combined waste, 224 tool changes, 112 layers. Support grams remain unknown. This proves measured waste extraction on a real multicolor slice; it does not establish that tree supports are active. No waste component was added to the pricing total.

## Automatic-tree and quality rehearsal
`scripts/slicer-profile-rehearsal.mjs` generates a flat block and a T-shaped overhang and invokes the pinned real CLI without credentials or networking. With automatic trees, the flat block had zero support features. The overhang without supports used 3.3223 g and 1,350.35 seconds; automatic trees produced 124 support feature sections, 5.4497 g and 2,440.45 seconds. G-code settings explicitly recorded `enable_support = 1`, `support_type = tree(auto)` and `support_on_build_plate_only = 0`.

The real adapter also sliced the existing three-color fixture with the fine profile: `0.12mm High Quality @BBL X2D`, 27,560.38 seconds, 88.80 g total, 80.8708 g waste, 298 changes and 149 layers. This establishes that selecting fine changes real production figures rather than only a displayed label. Effective profile fingerprint: `4f6bed94131038409a0f0697a5b9f43457cd479130fd51d79d5ab434aed8f30e`.

The initial full unit/contract baseline completed: 1,729 passed, one skipped, zero failed. Subsequent profile changes have their own focused verification; a final full run remains required.

## Prusa and interface evidence
The pinned PrusaSlicer 2.8.1 image was built and exercised without networking or credentials using an explicitly synthetic engine-rehearsal configuration. Flat geometry produced no support sections. The T-shaped overhang without supports used 4.16 g and 1,927 seconds; organic supports produced 99 support sections, 5.82 g and 2,844 seconds. G-code recorded enabled automatic support and organic style. This verifies engine behavior, not calibration of a production Prusa printer.

Ten focused intake browser/API tests passed after updating fake-worker fixtures to supply explicit synthetic profiles. Screenshot capture completed with 277 screenshots; the 390-pixel measured-production panel and a reduced overview of the 1280×70988 preview board were inspected. Final screenshot refresh remains needed after the final visible revision.

Independent review identified and prompted regressions for partial Bambu header totals, incomplete Prusa profiles, generic/Prusa-painted color mappings and operator pack figures. The second full unit run reported 1,743 passed and one failed: the new pack metadata test ran against its pre-fix loaded module. The pack fix subsequently passed focused tests; do not treat that full run as green.

### Outstanding production-fidelity gate
Pinned Bambu source `PrintObject.cpp:3496–3502` overlays uploaded object configuration on global defaults. The CLI only replaces object config while orienting, whereas estimates preserve orientation. Before completion, sanitize uploaded 3MF process/object/layer overrides in the private working copy while preserving geometry and color assignments, then prove effective supports and quality with a real adversarial 3MF overhang. Merely setting global support fields is insufficient. Final full tests, screenshots, review, PR, green merge and main verification remain required.
