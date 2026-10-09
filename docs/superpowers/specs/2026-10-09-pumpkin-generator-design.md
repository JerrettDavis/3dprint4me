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
(fine ridges or knit V-stitches). Flat base from a base-width %. Hollow = outer minus a scaled copy
(star-shaped about the centre, so always nested); openings by extruding a slice of the cavity.
Bowl: split plane + tongue (bowl) / recess (lid) with 0.3 mm clearance. Face = 2D shapes extruded
radially through the front: cut-out (hollow only), inlay (separate colored part filling a skin of
`face_depth`), or engraved. Lattice = radial prisms (diamond/round/slot) through a hollow shell.
Stem = lofted ridged bent column + flange; `fused` (pocket in body, union if single color) or `peg`
(D-keyed peg, socket tube inside hollow tops, loose stem laid out beside, printed top-down).

## Rules (fieldErrors, never raw errors)
cut-out face needs hollow/bowl; lattice needs hollow; vase has no face/stem (hidden, forced none);
single-color inlay is built as engraved with a note; tealight fit check (>= 41 mm opening, >= 17 mm
cavity); min wall after ribs/texture; bowl split must clear the face.

## Parts and colors (<= 4 used)
Body, Lid, Stem, Face (+ Cheeks). `multicolor: false` collapses every part to the body color.

## Testing
Unit: shape math, schema/rules, builds for every design and style x opening x stem x face matrix
(manifold-valid, analyzer-clean, leak-guard), E2E matrix flow, pages/catalog/sitemap/screenshots.
