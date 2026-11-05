# Gridfinity generators

## Intent and scope

Add two public, offline generators to the existing Customize studio: `gridfinity-base` and `gridfinity-bin`. Customers can download printable models or hand them to the existing private print intake. The user authorized research, planning, implementation, review, merge to origin/main and green deployment. Implementation choices below are agent decisions within that scope.

Baseplates support rectangular rows and columns, a conventional socket lattice, magnetless construction, reduced-material open lattice and magnetic pockets. Bins support rectangular footprints, height in 7 mm units, ordinary and thin-wall construction, optional magnets, dividers, stacking interface and a support-free label shelf. Vase construction must be a real printable spiral-compatible shell with separately printed Gridfinity adapter feet, rather than enabling spiral mode on a conventional multi-foot bin. Export and instructions must distinguish the print operations. A pixel-like occupancy editor is explicitly a future revision; shared cell positioning should accommodate it without implementing an editor now.

## Prior art and licensing

Reviewed 2026-11-05:

- Gridfinity Rebuilt: https://github.com/kennetek/gridfinity-rebuilt-openscad . Its LICENSE includes MIT notices for Kenneth Hodson and Zachary Freedman: https://raw.githubusercontent.com/kennetek/gridfinity-rebuilt-openscad/main/LICENSE . Preserve those notices for adapted profile data. Do not assume unrelated community designs share this license.
- Rebuilt dimensional constants: https://raw.githubusercontent.com/kennetek/gridfinity-rebuilt-openscad/main/src/core/standard.scad . Grid pitch 42 mm, bin outside 41.5 mm per single cell, base corner radius 3.75 mm; mating foot rises 0.8 mm at 45 degrees, then 1.8 mm vertical, then 2.15 mm at 45 degrees (4.75 mm total). Height units 7 mm. Magnet centers are 8 mm from nominal cell edges. Use explicit additional socket clearance rather than silently scaling the grid.
- Rebuilt vase implementation and instructions: https://kennetek.github.io/gridfinity-rebuilt-openscad/vase/ . Conventional multi-foot geometry is incompatible with spiral printing; prior art separates the vase container and its bases. Follow this physical strategy with independent Manifold geometry.
- Gridfinity Extended: https://github.com/ostat/gridfinity_extended_openscad . Broad inspiration for configurable plates, bins, labels and dividers; GPL-3.0, so do not copy implementation into the site's MIT modules.
- Community catalog: https://github.com/jeffbarr/gridfinity-catalog . Discovery reference for magnetless/reduced-material variants, not a blanket license grant or verified dimensional authority. Do not claim compatibility with proprietary named snap systems.

## Architecture and geometry

Use the existing isomorphic definition/schema/server validation, Manifold worker builders, 3MF writer, catalog, download and private hand-off. No runtime third-party dependencies, remote fonts or remote fetches. Shared pure dimensional helpers own cell placement and mating profiles; builder helpers own rounded profiles and memory disposal. All exported print parts lie on z=0, and all overhangs are ramps at 45 degrees or less or documented short bridges. Magnet recesses open toward the build plate; no trapped pockets. Label shelves grow inward on a 45-degree underside. No loose text floating above an open bin.

Standard sockets and feet use the same dimensional profile but tests must compare independently stated expected dimensions and section widths. A plate uses socket subtraction in a connected frame; reduced-material variants remove only material outside the load-bearing socket rails. Magnets are optional, with nominal 6 x 2 mm magnets and adjustable diameter/depth clearance. Magnetic plates need a floor beneath the sockets thick enough to retain pockets; prohibit incompatible thicknesses rather than returning broken models.

Use bounded dimensions and cross-field limits to avoid excessive browser work and impossible dividers or labels. Defaults and every preset/design must validate and build. Hidden incompatible features must be normalized on user changes and rejected by server rules if submitted directly. Bed-size facts and print caveats remain visible. Do not claim a fit test or support-free physical validation has occurred when only geometry/slicing was checked.

Vase shell has one continuous rounded perimeter, flat floor, no dividers, no label shelf and no stacking lip. Its adapter is printed conventionally, joined after printing, and supports the full flat floor with Gridfinity feet underneath. Never apply spiral settings globally to a multi-object adapter assembly. Provide an unambiguous separate shell download/print path before calling vase complete.

## UX and invariants

## Builder review decisions (2026-11-05)

The independent builder review identified missing numeric and export decisions. Resolve them as follows (agent choices):

- Scope is 1–6 cells on each axis (maximum plate 252 x 252 mm); bins are 2–12 height units. Bin width/depth are `42n - 0.5`; plate perimeter is `42n`. Foot stations `(z, width, corner radius)` in mm: `(0,35.6,0.8)`, `(0.8,37.2,1.6)`, `(2.6,37.2,1.6)`, `(4.75,41.5,3.75)`. Socket cross-sections add configurable 0.15–0.4 mm radial clearance (default 0.25), preserving center positions. Clearance changes the socket, never grid pitch.
- Bin body begins at z=4.75. Nominal rim is at `7 * height_units`; optional stacking lip adds 4.4 mm. Floor is at least 1.2 mm above foot top; walls 1.2–2.4 mm (thin preset 1.2). Shelf is a blank paper-label shelf, 8 mm deep, with 8 mm vertical ramp underneath and at least 1.2 mm shelf thickness; only bins of at least 3 units accept it. Printed text can be a later extension; UI must say paper-label shelf.
- Magnet centers are `(±13,±13)` from each cell center (8 mm from nominal 42 mm edges). Default pockets 6.2 mm diameter, 2.2 mm depth, open down, glue retention. Pocket roof minimum 0.8 mm; pocket roof is an explicitly allowed short bridge at most 6.4 mm. No guarantee of press fit. Magnetic plate has a 3.2 mm subfloor below the socket; no pocket cuts into the mating rails. Other plates have open centers; reduced-material rails must be at least 1.2 mm wide and all sockets connected.
- Vase mode adds a required print-component control: `shell` or `adapter`. Each build/download/request represents exactly that component. This uses the existing one-model contract rather than a global multi-object spiral file. Shell filename ends `vase-shell`, adapter `vase-adapter`; the selected component is part of provenance and saved draft. The UI tells users to download both components separately and to submit separate print requests if ordering both. Shell export is a solid positive volume for the slicer to hollow with spiral mode, zero top layers and a 1.2 mm floor; target 0.4 mm nozzle / 0.45 mm line width. Adapter export is a conventional model with full flat glue land and feet, with no spiral settings. Glue the flat floor to the matching adapter after printing; outer footprint aligns the parts without unsupported clips. No partitions, magnets, lip or shelf in the shell. Verify actual sliced continuous perimeter before shipping the vase claim.
- Every default/preset and maximum 6x6 build must finish within 20 seconds on the same Node/Manifold test machine as existing generator tests. Geometry tests include 1x1, 1x6, 6x1 and 6x6. Print instructions disclose the maximum magnet bridge and need for a fit sample.

Reuse the studio layout and themes, 390 px responsiveness, keyboard focus, reduced motion, local drafts, downloads and request recovery. Show intelligible units, material/strength tradeoffs, magnet assembly and vase assembly instructions. Starting designs cover the advertised variants. No external requests from Customize. Private intake and sensitive-field guarantees remain unchanged.

## Acceptance evidence

Unit tests: schema limits, invalid combinations, profile dimensions, empty-free connected manifold solids, pocket locations/depth, volume reduction, divider connectivity, label ramp, vase perimeter and separate print operations; all defaults/presets through real Manifold and the site's 3MF analyzer. Browser tests: both catalog entries, edits, designs, downloads, reload recovery, private hand-off and offline behavior including vase workflow. Run `npm run customizer:build`, `npm run assets:version`, `npm test`, `npm run screenshots`; inspect `screenshots/preview-board.png` plus new generator views. Review complete diff and production error behavior. Merge only after CI passes; verify origin/main commit, deployed pages and live download/request behavior. Physical sample fit remains an explicitly disclosed operational limitation, not a claimed result.
