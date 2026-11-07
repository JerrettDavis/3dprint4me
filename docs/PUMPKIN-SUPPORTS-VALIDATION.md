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

Final cap detail check: the first thinner stitch revision was visible in renders but omitted
by the 0.16 mm slicing profile. A failing relief-section test reproduced that issue.
Fitted-cap stitches now have 0.56 mm width and 0.36 mm raised relief; actual G-code
shows the two stitch rows on layers Z=5.64 and 5.80 mm above the visor. The original
30 mm mesh hash is unchanged. All 12 focused geometry/export/resource tests pass.

## Version 8: level exterior bases

The exterior base of each hat is planar at assembled Z=28 mm, with only an
internal pumpkin-shaped recess (0.2 mm vertical clearance, about 2.16 mm
maximum depth). The base has a continuous uncut 1 mm thick annulus between
radii 13 and 14.3 mm, including the 30 and 40 mm cap sizes. The cap visor
shares its crown base; witch/Santa mounting pegs remain attached. Upper heights
retain version 7 values. No pumpkin geometry or socket dimension changes.

Fresh Bambu Studio slices with the same X1 Carbon/0.16 mm PLA profile and
automatic supports disabled all completed with nonempty G-code,
`support_used=false` and `outside=false`: witch 9,582,898 bytes,
Santa 9,086,217 bytes and baseball 6,276,788 bytes. These exports include
the model-derived removable supports. Earlier slicing figures and the original
30 mm mesh hash above are historical; version 8 intentionally changes all
hat bases. Physical fit and clean support removal still await print tests.

Actual-mesh reviews: `screenshots/pumpkin-cap-fitted-seat.png`,
`screenshots/pumpkin-witch-flat-base.png`, `screenshots/pumpkin-santa-flat-base.png`.
Regenerate with `python scripts/render_pumpkin_cap.py --style <baseball|witch|santa>`.

## Version 9: snugger baseball cap

The baseball cap now sits lower without changing its top height or bending its
base. The default 36 mm crown has a flat base at Z=25.9212 mm instead of 28 mm,
and a central mould depth of about 4.24 mm instead of 2.16 mm. The recess extends
closer to the edge; a continuous 2 mm outer land remains uncut. For each cap
diameter (30-40 mm), the builder measures the highest point of the exact filled
pumpkin outside that land, then adds the 0.2 mm mould clearance and 0.05 mm
safety. The boundary is measured with a 192-sided cylinder, not sparse ray probes.
Witch/Santa geometry and all three top heights remain unchanged.

Regression coverage checks all cap sizes for collision-free flat rims, a
continuous 1 mm-thick outer annulus on the end sizes and default, 64 close-fit
probes at radius 14.5 mm, connected solids, unchanged top heights, mounting-pin
fit, clean multi-color exports and resource cleanup. The focused suites pass
24 tests. Physical fit and support removal still await a printed sample.

The default cap's actual exported flat underside triangles cover 397.68 mm2,
down from 707.63 mm2 in version 8 (about 44% less blank underside). Its print
part height is now 17.278797 mm because its base seats lower; the assembled
top remains at the previous height. All three fresh integrated-support slices
completed with `support_used=false`, `outside=false` and nonempty G-code.
