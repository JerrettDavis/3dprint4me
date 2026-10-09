# Pumpkin generator (customizer) - design

Date: 2026-10-09. Status: approved by the standing goal (autonomous run to main).

## Intent
A `pumpkin` generator in the Customize section that algorithmically makes almost any pumpkin: solid,
hollow (tealight cover when open at the bottom), vase mode, and a bowl with a removable lid; single
color or multi-color (AMS/MMU); faces as inlay, engraving or full cut-outs; lobed, ridged, knitted or
lattice surfaces; separate peg-in stem or a stem printed attached. Simple mode = designs gallery +
few controls; advanced = every shape parameter. Same contract as the other four generators
(docs/GENERATORS.md): isomorphic definition, worker-only builder, <= 5 colors, analyzer-clean 3MF.

## Research (reference models, verified by browsing MakerWorld; most pages state no numbers)
- Ridged tealight: ~90 tall x 123 wide (aspect 0.73), hollow, fits electronic tealights; stem separate.
- Modern lattice tealight: three sizes, stem on its own plate, 2 walls.
- Bowl with lid: body/lid/stem separate, scalable; knitted cute pumpkin: V-stitch texture, glued stem.
- Inferred: tealight cavity 40-41 mm x 16-17 mm; wall 1.6-2.4; lid split 75-85 % height; keyed peg.

## Geometry
Closed parametric surface (rings x azimuth samples -> Manifold mesh): superellipse meridian
(roundness/boxiness), pear taper, plan-view oblongness, top stem dimple, twist, `segments` lobes with
depth/sharpness, per-lobe irregularity from a seed, texture displacement along the meridian normal
(fine ridges or knit V-stitches). Flat base from a base-width %. Hollow = outer minus an inset copy
(rings moved in along the meridian normal by the wall: an even wall for any shape); openings by extruding a slice of the cavity.
Bowl: split plane + tongue (bowl) / recess (lid) with 0.3 mm clearance. Face = 2D shapes extruded
radially through the front: cut-out (hollow only), inlay (separate colored part filling a skin of
`face_depth`), or engraved. Lattice = radial prisms (diamond/round/slot) through a hollow shell.
Stem = lofted ridged bent column + flange; `fused` (pocket in body, union if single color) or `peg`
(D-keyed peg, socket tube inside hollow tops, loose stem laid out beside, printed top-down).

## Rules (fieldErrors, never raw errors)
cut-out face needs hollow/bowl; lattice needs hollow; vase has no face/stem (controls hidden, ignored by the builder, values kept);
single-color inlay becomes glue-in pieces (pockets plus loose smaller pieces on the bed); tealight fit check (>= 41 mm opening, >= 17 mm
cavity); min wall after ribs/texture; bowl split must clear the face.

## Parts and colors (<= 4 used)
Body, Lid, Stem, Face (+ Cheeks). `multicolor: false` collapses every part to the body color.

## Testing
Unit: shape math, schema/rules, builds for every design and style x opening x stem x face matrix
(manifold-valid, analyzer-clean, leak-guard), E2E matrix flow, pages/catalog/sitemap/screenshots.

## Research provenance (what was verified and what was inferred)
Verified by loading the pages (MakerWorld needed a real browser; plain fetches got 403):
- Ridged tealight (MakerWorld 633969): 90 mm tall x 123 mm wide, scalable to about 75 %, fits electronic
  tealights, stem and body as separate files (glued stem), tree supports inside.
- Modern lattice tealight (1790758): three sizes, stem on its own plate, glued, interior bridges work
  with 2 walls only. Bowl with lid (638844): body, lid and stem separate; stem glued; two-color version.
- Knitted cute pumpkin (1858202): jack-o'-lantern face, no AMS needed, glued parts, 2 walls.
From search results only (not opened): Printables vase-mode jack-o'-lantern (0.8 mm nozzle or 0.8 mm
line width, body optimized for vase mode); Printables large low-poly pumpkin (vase-mode body variant,
lid lip needs supports); a MakerWorld "Jack-O-Lantern Maker" with Classic / Cinderella / Tall /
Heirloom shapes, width, rib count, rib style, wall, twist, face size and position, stem size and curl
(the same parameter families as this generator); a MakerWorld "Evil Pumpkin" in solid, hollow and
multicolor versions; Thangs/Cults3D tealight covers for 38 mm LED candles.
Opened through the signed-in Chrome session (the headless browser saw only a disclaimer): MakerWorld
1753706 is "Pumpkin Halloween" by Tim, tagged spool winder / cable management / yarn winder: a small
solid-looking pumpkin with an internal winder tower. Profile 0.16 mm layers, 2 walls, 15 % infill,
about 27 g PLA, 4.8/5 from 121 ratings. Reviewers scaled it from smaller than the original up to
185 % (one 186 g print failed at the internal tower; slow print speeds weakened the internal supports).
Takeaways used here: pumpkins this family are printed across a wide size range (the generator's
50-180 mm width), 2 walls at 15 % infill is the reference profile (solid type keeps the slicer's infill
defaults), and internal structure is the failure point (the hollow types print supports from the bed).
Each named site was also tried through the signed-in Chrome session: Printables search worked (a
"Pumpkin Whose Eyes Follow you - Vase Mode Version" by Lothar Creative Design, 4.6 stars, 219 likes:
the vase-mode pumpkin is an established category); Thingiverse's search page renders nothing the
browser tool can read; Yeggi and Cults3D stand behind bot-verification pages, which are not bypassed
(a person can open them). So Yeggi, Cults3D and Thingiverse contributed nothing beyond the earlier
search-result snippets. Everything numeric that no page stated (the 41 mm / 17 mm tealight cavity, wall
defaults, 78 % lid split, peg size and clearance) is inferred from the above plus standard FDM practice
and has not been print-tested.

## Slicer validation (Bambu Studio 02.08 CLI, X-series defaults, 0.2 mm layers, PLA)
All 11 designs slice with return code 0. With the first 3MFs, the four hollow designs (classic, ridged,
lattice, bowl) drew the slicer's "floating regions" warning (the unsupported inside of the dome); the
vase sliced as a normal solid (240 min, 121 g). The 3MF now carries `enable_support` (tree, build plate
only) for hollow types and `spiral_mode` for the vase. Re-sliced: no warnings; supports 45-84 min;
the vase prints in 65 min and 13 g. Cute 308 min / 87 g (+11/2/3 g), classic 301 min / 87 g with
supports, bowl 502 min / 108 g + 28 g, lattice 364 min / 90 g. Not yet on a printer.
