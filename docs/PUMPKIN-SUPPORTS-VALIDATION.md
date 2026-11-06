# Cap fit and included support geometry

The cap correction makes the default crown 36 mm instead of approximately 30 mm.
Both bill roots sit inside the dome; the bill width and stitch rows follow smaller
fitted crowns (31–40 mm). The explicit 30 mm profile preserves version 4 geometry.
The original pumpkin main shell and round 4 mm socket are unchanged.

Version 5 includes removable support solids in downloads by default, under actual
downward-facing surfaces of the hat and pumpkin, including Santa's pompom. Finished
presentation omits these solids. They use a 2.4 mm grid, 1.3 mm posts, tapered
0.45 mm tips and 0.16 mm vertical release gaps, with model geometry subtracted.
The option can be disabled for an experienced user to provide their own supports.
Version 4 provenance retains omitted supports and the original cap dimensions.

All three exports were sliced with Bambu Studio 02.08.02.61, X1 Carbon 0.4 mm,
0.16 mm High Quality PLA and automatic supports explicitly disabled. Each slice
completed with nonempty G-code, `support_used=false` and `outside=false`. The
generated Santa G-code was inspected at Z=8.20, 10.60, 11.56, 12.04, 12.52 and
13.00 mm beneath the pompom and into its first layers. Actual extrusion paths show
the support columns transitioning into the pompom's expanding layers. This is
sliced coverage evidence, not a physical print or removal test.

The aesthetic reviewer approved the enlarged cap and flush bill ends. The code
review caught a smaller-crown regression; a failing geometry test reproduced it
at 31 mm, then passed at both roots for every fitted size after deriving bill width
from the crown. The printability reviewer approved clear hat-only/underside support
captures and the actual G-code layer render, with physical limitations retained.

Captures: `screenshots/pumpkin-topper-baseball-ui.png`, the three
`pumpkin-topper-*-supports.png` views and their `*-supports-bottom.png` counterparts.
Private slicer inputs, G-code and layer plots stay outside static output.

Physical peg fit, post stability and clean removal remain unverified until printed.
Independent tall posts and internal support access require careful layer-preview
inspection; do not infer reliable release or universal printer compatibility from
a successful slice. Use 0.16 mm layers and remove support material after printing.

The branch's PR records final full-test, screenshot, CI and deployment outcomes.
