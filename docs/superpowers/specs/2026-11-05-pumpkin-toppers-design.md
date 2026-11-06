# Reference pumpkin and festive toppers

The standing user goal authorizes implementation, validation, committee review, and release to green main. This document records implementation decisions; no additional deployment approval is needed.

## Required result

Extend the pumpkin generator with detailed witch, Santa, and baseball hats, using a reusable round-peg mount and a moulded underside. Festive variants default to the exact shape, size, face and socket of the supplied `PumpkinHappyEyesstl.stl`. Preserve the existing parametric pumpkin as an explicit alternative. Default reference geometry is not an approximate fitted equation.

## Measured reference

The user-supplied binary STL has SHA-256 recorded by the reproducible import script. Bounds are X −22.816495895..23.130826950, Y −22.988401413..23.000032425, Z −11.009614944..18.945226669 mm. Its actual dimensions are 45.947322845 × 45.988433838 × 29.954841614 mm. Z is up; the face points toward −Y. Socket center is [0,0], independently of the slightly asymmetric bounding box. The round socket is Ø4 mm, through the approximately 2 mm crown (Z≈16.898..18.945).

Extracting the largest connected component removes 98 microscopic debris triangles while preserving all coordinates of the 94,074-triangle main shell. That shell is watertight, consistently wound, and accepted by Manifold without coordinate repair. Only translate Z to the bed; do not recenter the socket or rescale the reference default.

## Architecture decisions

- Store compressed exact mesh data in a worker-only module, decoded with the existing fflate dependency. No runtime request or new dependency; the compiled generator remains offline and same-origin.
- Add a reference/parametric body selector. Reference is the new default; legacy designs explicitly select the parametric body. Bump generator version and preserve prior version defaults for server provenance.
- Reference mode hides shape, face, stem and surface parameters that it does not consume. Expose hat style, accessory colors, peg clearance and export choice (pumpkin + hat, hat only, pumpkin only). Explain the fixed reference dimensions in the form.
- Keep the reference shell and round socket unchanged across hats. A shared mount derives its mould from the actual outer crown, with 0.2 mm seating clearance; fill the cavity in the cutting envelope so the hat has no trapped material below its seat. Peg is round, tapered at the tip, nominal Ø3.7 mm, and extends through the socket into the hollow body. Printer fit remains unverified until printed.
- Each hat builder returns one connected printable solid, with durable raised detail rather than disconnected decoration. Witch: swept/bent cone, broad curved brim, band, buckle and raised celestial accent. Santa: folded fabric cone, folded tip, scalloped fur cuff and textured pompom. Baseball: domed paneled crown, visor, button, stitched seams and eyelets. Use colors as printable volumes only when they share boundaries cleanly; single-color geometry must retain detail.
- Realistic preview assembles the hat on the pumpkin. Printable export separates the hat and body on the bed, with slicer support settings and honest support guidance for the mould, brim and folded details. Do not claim support-free printing.
- Extend through a style registry and one shared mount contract; future hats do not alter the body or socket.

## Verification and release gates

Reference tests pin the source checksum, exact bounds, unchanged coordinate set, watertight shell, crown socket diameter and single connected component. Hat tests exercise all styles and export choices, assembled fit (no intersection except intentional peg insertion into empty socket), mould clearance, connected geometry, analyzer-clean 3MF and absence of resource leaks. Preserve legacy generator tests using explicit parametric mode.

Exercise offline edit/download and request hand-off, light/dark/system, keyboard/reduced-motion and 390px layout. Run `npm test`, `npm run screenshots`, inspect `screenshots/preview-board.png`, and render closeups/front/back/underside of every hat. At least three committee subagents independently inspect actual generated output screenshots for accuracy, style, detail and aesthetics; resolve material objections and record the evidence.

Update generator docs, build customizer, refresh asset versions, publish via reviewed PR, verify main CI and production deployment, and test live offline downloads and hand-offs before declaring completion. Physical fit is a stated limitation, never silently treated as verified.
