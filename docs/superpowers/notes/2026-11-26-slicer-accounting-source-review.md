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
