# Pumpkin topper validation

## Reference and mount

The source is the user-supplied `PumpkinHappyEyesstl.stl`, SHA-256
`8bf2485d6549eb3fdfaca9ac3ecf6e6911a4b961474a4787dfc13a6a3c7cd991`.
Its main shell retains all original vertex coordinates: 47,029 vertices and 94,074 triangles.
Only 98 disconnected microscopic debris triangles are excluded. Body dimensions remain
45.947322845 × 45.988433838 × 29.954841614 mm. The original round Ø4 mm hole is unchanged.
The import, checksum, exact bounds, socket probes, connected hats and assembled collision
checks are covered by the reference/topper unit tests.

Hats share a crown-derived mould with 0.2 mm seating clearance and a round tapered peg
(default diameter 3.7 mm). Numerical compatibility is verified; physical fit awaits a printed
sample. The pumpkin itself is not changed to accommodate an accessory.

## Three-member screenshot committee

Three independent subagents reviewed the actual generated front/underside geometry and then
the depth-correct WebGL screenshots. They assessed reference accuracy, seating, detail,
printability risks, style and aesthetics. Final decisions were unanimous approval with no
remaining visual blockers:

- Reference reviewer: pumpkin proportions/face preserved, convincing crown seating for all three hats.
- Aesthetic reviewer: readable witch buckle/star, red/cream Santa trim and detailed blue baseball cap.
- Printability reviewer: clean assembled renders and readable details; retain slicing and physical-fit caveats.

The initial Matplotlib inspection incorrectly sorted the Santa/body surfaces. Actual browser
renders resolved that concern. Review feedback also led to deeper cap stitch attachment,
annular eyelets, contrasting printable trim volumes and accurate preset captures.

Final reviewed output: `screenshots/pumpkin-topper-witch-ui.png`,
`screenshots/pumpkin-topper-santa-ui.png`, `screenshots/pumpkin-topper-baseball-ui.png`.
The normal screenshot suite also captures all three at desktop/light and 390px/mobile/dark,
and includes them in `screenshots/preview-board.png`.

## Slicer evidence

All three generated multi-color pumpkin + hat 3MFs were sliced by Bambu Studio 02.08.02.61,
X1 Carbon 0.4 mm nozzle, 0.16 mm High Quality process, Generic PLA, with tree supports
explicitly enabled. CLI exit codes were zero. Each output archive contains a nonempty G-code
file and reports `support_used=true`, `outside=false`:

- Witch: 28,474 seconds and 83.50 g, including support and color-change material.
- Santa: 26,774 seconds and 78.07 g, including support and color-change material.
- Baseball: 16,962 seconds and 51.27 g, including support and color-change material.

These profile-specific figures are evidence of successful slicing, not customer quotes or
guaranteed print times. The supplied process profile overrides embedded support settings;
therefore supports were explicitly enabled in the loaded profile for validation. Customers
should inspect their layer preview and support placement. No physical print has been made.

## Release gates

Full local `npm test` passed validation, unit/contract checks, 488 browser tests
(five existing skips) and 241 UX checks. The final focused reference/topper suite has
eight passing behavioral tests, including all export choices and resource cleanup.
The serial `npm run screenshots` completed 184 captures; the preview board was visually
inspected with complete mobile hat views. The handbook build/link checks, four handbook
integration tests and two handbook browser tests also passed.

The full test command, main CI, merge and live production checks must pass before this
feature is considered released. The current merge/deployment outcome is recorded in
[PR #72](https://github.com/JerrettDavis/3dprint4me/pull/72).
