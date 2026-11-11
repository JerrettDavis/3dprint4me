# Infinity fidget reference evidence

Investigation date: 2026-11-09. This is a working measurement record, not a declaration of release readiness.

## Source identity and rights

User-specified original: https://www.thingiverse.com/thing:4997903 by mjdargen. The user states they have permission/source files and identifies this as Creative Commons prior art. Direct Thingiverse access returned its error page/HTTP 403 during this session. Indexed search results describe Attribution–NonCommercial–ShareAlike; this is secondary evidence and must not be promoted to verified primary permission. Confirm the applicable original license and any separate commercial permission before publishing reference-derived files.

Local measurement input: `<local>/InfinityCubeFidget(5).3mf`. Embedded description identifies an mjdargen-based remix, improved joints/tolerances and enlarged edges. The accessible MakerWorld page for user reference 1 uses Attribution–Noncommercial–Share Alike. Keep the remix distinct from the original; permission for one is not silently attributed to another.

The development hinge primitive is newly constructed analytic geometry. No source mesh, thumbnail, customer file or reference image is committed into the public site.

## Measured local cube geometry

Read `3D/Objects/object_1.model` with defusedxml; build a Trimesh from its 5,232 vertices and 10,400 triangles. Split connected components and inspect bounds/volume. The mesh is closed/watertight with total volume approximately 51,225.217 mm³.

- Complete untransformed mesh bounds: X −41.200005 to 41.200005 mm; Y −20.403389 to 20.403389 mm; Z −10 to 10 mm.
- Sixteen closed connected components: eight block bodies and eight independent connectors. This is a captured double-pivot-link assembly, not eight simple single-axis barrel hinges.
- Each body has a 20 × 20 × 20 mm bounding box, approximately 5,659.871 mm³ volume and 420 triangles.
- Body X centers: −31.2, −10.4, 10.4, 31.2 mm. Two Y rows near ±10.4 mm. The row coordinates have approximately 0.0068 mm asymmetry in the source; do not reproduce it as intentional clearance.
- Each connector is approximately 743.281–743.282 mm³. Typical connector bounding dimensions are 13.991 × 9.2 × 6.6 mm, with axis permutations by location.
- Four links connect outer adjacent X pairs near X ±20.8, Y ±10.4 and Z −6.7 mm.
- Two end links join Y rows near X ±31.2, Y 0 and Z +6.7 mm.
- Two center links join the middle X pair near X 0, Y ±17.1 and Z 0 mm.

The source's connector bounds and placements are measured. Pin radii, actual minimum surface gaps, retention overlap, moving pivot positions and folding path have not yet been independently fitted or verified. Bounding boxes do not prove any of those properties.

## Additional primary open-source evidence

https://github.com/jhpieper/sturdy-infinity-cube is accessible directly through GitHub's API and raw source; inspected revision `e62b577e5854079e1d672a1ccc52f34db9512ff3`. Its `LICENSE` is MIT (Copyright 2020 Jan Pieper); its SCAD header credits 2021 Jan Pieper and embeds the MIT terms. The README also states CC BY 4.0 for its STL objects. Preserve the exact MIT notice if adapting code; do not infer license terms for the other references from this repository.

`openscad/sturdy-infinity-cube.scad` provides an inspectable eight-block topology with four bottom links, two side links and two top links. Default blocks are 20 mm, spacing 1 mm, edge cut 2 mm. Source comments explicitly warn that links interfere below 16 mm blocks. These values belong to this design, not to the measured MakerWorld remix.

Its captured joints differ from the initial analytic experiment: tapered 2-to-1 mm body pins sit in 2.5-to-1.5 mm conical cavities in the link. Nominal main link radius is 4 mm and cutter radius 4.4 mm. Crucially, the source includes 0.2 mm sacrificial support strips for side links and 0.2 mm-wide support features beneath top links despite the README's “supports none” slicer setting. Those are designed breakaway geometry, not evidence that all hinge starts can float unsupported.

This source supplies usable primary evidence for printable joint orientation, captured conical bearings and explicit sacrificial supports. Compare/adopt that proven construction for the complete assembly rather than treating the simpler internal cylindrical fit coupon as the final production mechanism. Any adoption must include its attribution and license. The supplied triangle source is inspected below.

## Current conical assembly evidence

User supplied the permissioned local triangle reference on 2026-11-09: `<local>/infinitycubefidgettrianglev2stl.stl`, SHA-256 `81c6fa17900e9276b13a997047348f3cfcd34529ca3fad48ee5e0892faba7945`. It is a watertight 27,966-triangle mesh, bounds approximately 82.4 x 40.8 x 20 mm, with eight body components (about 5,717–5,730 mm3) and eight link components (about 577.294 mm3). It is not a six-prism loop. Each body has a diagonal corner cut with alternating X/Y signs: block zero's outward plane is `(x-y+z)/sqrt(3)=20/sqrt(3)`. Bottom bearing centers lie at local Y 14 mm in the first row and 6 mm in the second; end bearings have local X 6/14 mm; side bearing centers lie at Z 6 mm. The visible link width is 7.2 mm and thickness 6.6 mm. Measurements remain distinct from the new parametric construction, whose default triangle connector is 6 mm to retain the chosen 1.2 mm socket wall. The source mesh is not copied into public output.

The coupled fold also exposed the correct bevel clearance envelope. For radius `r` and edge chamfer `c`, the maximum two-corner sweep requires `2*(hypot(r,r-c)-r)` gap. Testing only 45 degrees or only the initial fold underestimates the envelope. At r=3.4, c=1.7 the bound is approximately 0.803 mm: a 0.6 mm gap collides, 0.9 mm clears. The bounded controls now use this analytic envelope and an inverse relation when the customer edits the gap.

The production candidate adapts the inspected MIT code, not the downloaded NC-SA remix mesh. It retains Jan Pieper's full notice in source and the site's local notice asset; generated 3MF provenance includes the complete notice. Binary STL's 80-byte header includes the author, MIT identifier and absolute notice URL. Development evidence exports also include a license sidecar. No original reference mesh is redistributed.

All nine production presets have fresh successful Bambu 02.08.02.61 slicing results with no warnings. Classic initially wrote a success report but its process timed out; the separate retry exited zero. Preserve both reports. Geometry uses deliberately removable supports, including bearing-tip stalks; tests inspect 0.2 mm layer starts and slicer toolpaths. These establish synthetic/slicer evidence, not physically tested release force or durability.

Independent transforms and actual mesh intersections pass the initial flat-to-cube fold, a continuation through a different cube configuration, and a 14-phase closed folding sequence returning every body and link to its initial transform. The sequence includes partial reversals; it does not imply every pivot keeps rotating in one direction. The sampled complete sequence passes triangle, rectangular and spherical bodies, writing/textures, square edges and meaningful small/large configurations. Earlier failing return paths and insufficient gaps were rejected rather than counted as proof. Tests are sampled geometric checks, not physical release or durability certification. The production fit sample uses the same conical joint construction and selected clearance as the assembly; it has not been physically printed.

## Earlier cylindrical experiment and limits

The original internal connector primitive and three-piece fit coupon have six focused tests: rejected dangerous inputs; connected/manifold connector and socket tools; actual nonoverlap and axial capture between two body solids at 0.2/0.3/0.5 mm clearances; production STL/3MF exports accepted by the existing model analyzer; independent quarter-turn socket movement at half-degree steps; and smaller/larger valid dimensions at 7.5-degree motion steps. The STL's expected `units_assumed` warning is explicitly asserted.

The first neutral-pose socket collided at approximately 47 degrees. A regression now exercises the motion independently. The corrected socket reserves a quarter-turn sector for the bridge and an arc with round ends for the moving pin. Both are constructed as 2D profiles before extrusion, rather than expensive 3D sample unions. A 0.01 mm envelope allowance covers tessellation sagitta within the bounded dimensions; axial socket clearance remains the selected value.

These checks establish single-socket quarter-turn clearance, not a complete assembly's motion or manufacturing readiness. They do not establish printability, infinite movement or equivalence to the complete references. The coupon is deliberately not registered in the public catalog. The production assembly supersedes this experiment; see the current conical assembly evidence above. Deployment and green release Actions remain release gates.
