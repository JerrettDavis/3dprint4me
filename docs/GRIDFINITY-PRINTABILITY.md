# Gridfinity geometry and slicing checks

The generators use the 42 mm mating grid documented in [the design](https://github.com/JerrettDavis/3dprint4me/blob/main/docs/superpowers/specs/2026-11-05-gridfinity-design.md).
They are intended to print upright without generated supports. Ordinary bridge tuning is required:
magnet-pocket roofs bridge up to 6.4 mm; multi-cell bin floors and the vase adapter bridge the small
gaps between rounded feet (up to about 8 mm at a cell junction). A paper-label shelf grows inward
on a 45 degree ramp. Magnet pockets open down and are glued after printing.

These are geometry and toolpath checks, not physical test prints or a calibrated printer profile.
Print a one-cell fit sample and check magnet dimensions and polarity before a full batch.

## Evidence recorded 2026-11-05

Eight exported fixture pairs were sliced with Debian's PrusaSlicer 2.5.0, 0.4 mm nozzle,
0.2 mm layers, generic PLA and `support_material = 0`: standard/light/magnetic plates,
standard/thin bins, a combined paper-label/divider/magnetic bin, a vase shell and its adapter.
All eight produce continuous layer sequences and zero support paths. The spiral shell has
2,768 rising extrusion moves above its six-layer floor, with zero wall retractions or travel moves.
The [machine-readable report](https://github.com/JerrettDavis/3dprint4me/blob/main/docs/gridfinity-slicing-report.json) records model SHA-256 digests,
layer counts, final layer heights and path types. Bridge and overhang paths remain expected.

The original sharp stacking lip lost its final layer in slicing. The final lip truncates the
last 0.4 mm of that taper, leaving a 0.4 mm land at 4 mm above the nominal bin rim. This
does not move the seating plane or change the 7 mm stacking increment. Independent solid
intersection tests verify the standard foot still clears the cavity. Both sliced lip fixtures
retain their expected 46 mm top layer for the six-unit starting bin.

## Reproduction

Run `node scripts/export-gridfinity-print-fixtures.mjs` to export the actual generated 3MFs,
equivalent STLs and input/hash manifest into ignored `.superpowers/gridfinity-printability/`.
Slice each STL with a local PrusaSlicer using `deploy/slicer-worker/profiles/default.ini`,
`--export-gcode --gcode-comments`, and an output with the fixture's name plus `.gcode`.
All conventional fixtures use the normal profile; only `vase-shell` adds:

```text
--spiral-vase --top-solid-layers 0 --bottom-solid-layers 6 --perimeters 1 --fill-density 0 --extrusion-width 0.45
```

Then run `python scripts/check-gridfinity-gcode.py .superpowers/gridfinity-printability`.
The checker rejects missing/skipped layers, support paths, a lost standard lip top layer,
and discontinuous spiral walls. It writes `report.json`; copy it to the documentation report
only after inspecting the output. The exported 3MFs also have separate shell/adapter settings:
never enable spiral mode on the adapter or combine both objects in a spiral print job.
