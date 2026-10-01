# Slicer profiles

`default.ini` is a PLACEHOLDER (generic 0.4 mm nozzle / PLA values). **The owner must
replace it with the real printer + filament + print profile** before estimates are used for
pricing; otherwise print time and grams will not match the actual machine.

How to export a real profile: in PrusaSlicer, select the printer, filament and print
presets you quote with, then **File > Export > Export Config...** and save the `.ini`.
Replace `default.ini` with it (or mount a directory at `/profiles` via docker-compose and set
`SLICER_PROFILE=/profiles/<file>.ini`), and bump `SLICER_PROFILE_ID` in `.env.worker`.
