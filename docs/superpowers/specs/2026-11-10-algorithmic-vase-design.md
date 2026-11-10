# Algorithmic vase studio

Status: proposed design for the requested build, release, and production verification.

## Purpose and scope

Add an original offline vase generator to the existing Customize studio. Customers can shape a vessel, combine procedural forms and surface modifiers, export a printable 3MF, and pass the result to the private quote workflow. The supplied Printables pages are visual references, not sources of copied geometry or code. Reference inspection is still required before implementation.

## Product behavior

The studio starts with a usable vase and named presets, with immediate 3D feedback. Presets cover an urn, tapered planter, organic dune, blossom, faceted rose, twisted ripple, geometric cells, and zigzag crystal. Presets populate editable parameters; they do not replace the underlying generator.

Dimensions include height, maximum diameter, base diameter, mouth diameter, and wall/base thickness where applicable. A vertical profile editor uses ordered radius/height control points and a shape-preserving cubic spline. Points can be added, moved, and removed with pointer controls and equivalent labeled numeric/keyboard controls. Height order is enforced and the profile cannot cross the axis. The default profile is rotationally symmetric; angular deformation is a separate layer.

Form controls include circular or polygonal cross-section, facet count, taper/bulge from the profile, twist, lobes, and seeded organic displacement. Surface patterns include smooth, waves/ripples, dunes, scales, hex/cell relief, zigzag, and bounded multiscale/fractal relief. Amplitude, frequency, phase, seed, and blend strength are exposed where meaningful. Algorithms must be deterministic, independently authored, and bounded to preserve a positive radius and a stable base. Not every combination is printable; the UI explains detected steep slopes and thin features without promising print success.

Two explicit output modes are required:

- Hollow vessel: open mouth, continuous walls, closed flat base, configurable thickness, and a watertight printable mesh.
- Solid for slicer vase mode: closed solid envelope, no modeled internal walls, flat bottom and closed top, with guidance to enable spiral/vase mode in the slicer and choose suitable bottom layers. A solid export is deliberately solid until sliced.

The preview and exported geometry use the same evaluated model. A reset, preset selection, seed randomization, and shareable nonsensitive settings follow existing customizer conventions. Saved drafts restore the profile and all modifiers. Model metadata records generator version and validated settings using the established provenance contract.

## Architecture and constraints

Use the existing local worker, 3MF exporter, schema runtime, studio UI, registry, and order handoff. Implement a shared pure profile/pattern domain module so browser and server normalization agree. Extend the existing schema only as needed for bounded ordered profile points, with explicit parameter and computational limits. Revalidate every client field on the server. No dependencies or remote requests are added to generator pages; workers and fonts remain same-origin.

Generate a periodic angular/vertical mesh with shared seam vertices, consistent outward winding, capped base, and mode-specific inner wall/rim or top closure. Avoid independent intersecting ornamental solids. Hollow construction must account for slopes and relief when enforcing thickness; invalid offsets must be rejected or constrained explicitly, never silently exported as self-intersections. Bound resolution and memory, cancel stale worker results, and retain the last valid preview while explaining invalid input.

Keep customer models private and preserve the recoverable no-integration request. No secrets enter static assets. All service paths, theme modes, reduced motion, keyboard focus, and 390 px layouts remain functional. Keep the current API version/provenance compatibility policy and document the new generator version.

## Evidence required for release

1. Inspect the supplied visual references using the authenticated browser and record recurring design traits and any access failures.
2. Unit coverage proves spline interpolation and bounds, deterministic patterns, mode semantics, seam/cap topology, manifoldness, winding, flat base, dimension limits, and representative difficult combinations. Independently inspect exported 3MF meshes; do not rely solely on the generator's own checks.
3. Browser coverage exercises all preset families, profile editing with keyboard and pointer, modifiers, reset/draft restore, mode switching, downloads, errors, and order handoff on desktop and 390 px mobile.
4. Offline browser coverage proves generation, editing, and export with no off-origin requests. Server tests reject malformed profiles, excessive complexity, unknown settings, and incompatible provenance.
5. Slice representative hollow and solid outputs, including high-relief and faceted forms, with the correct slicer mode. Inspect layers and warnings. State that watertightness in use and physical print quality remain material/printer dependent.
6. Update generator documentation and customer print guidance. Run customizer build, asset versioning, validation, npm test, required browser/accessibility checks, and npm run screenshots; inspect the preview board and focused vase screenshots.
7. Review the final diff, land through green hosted CI on main, deploy the site and any required API registry changes, and verify the production generator's offline editing, downloads, mode semantics, and private request handoff. Check all existing service paths and provider failure behavior.

## Builder decisions

The profile stores normalized height/radius pairs, including fixed-height endpoints at zero and one. Endpoint radii control the base and mouth; corresponding dimension controls edit those same values. Maximum diameter is the final deformed envelope diameter: normalize the completed radial field globally to that diameter, then display the resulting base and mouth dimensions. Validate the complete field after normalization. Changing the maximum diameter scales all radii together.

Initially use 3–12 ordered profile points with minimum normalized height separation of 0.02. Schema validation must validate structured point data explicitly rather than accepting an unchecked JSON string. Presets and drafts carry the same canonical representation. Reject nonfinite, duplicate-height, out-of-bounds, and excessively long data on both browser and server.

Patterns comprise one selected surface algorithm with its parameters, composed with independent twist, lobes, faceting, and seeded organic displacement in a documented fixed order. Multiscale/fractal relief is a bounded octave sum, not unbounded recursive geometry. Presets remain editable combinations of these controls.

For hollow output, interpret wall thickness as a minimum geometric separation, not merely a radial subtraction. The builder must choose and document a mesh-offset method and validate actual separation and intersections across steep slopes and relief. Constrain or reject settings when that guarantee cannot be established; give a specific corrective message. Hollow geometry must also preserve a sufficiently wide opening after inward offset. This is an implementation acceptance requirement, not a promise that arbitrary combinations are valid.

Each preview request carries a monotonically increasing revision; only the current revision can update preview/export state. Use the framework's cancellation mechanism where available, otherwise replace the worker to stop obsolete expensive work. Export waits for the current valid revision and cannot export a stale shape under new settings.

The implementation may select precise safe bounds, sample density, and preset numbers through measured geometry and slicing tests. Pattern names describe original mathematical approximations, not replicas of the reference models. No physical water-retention or support-free printing guarantee is made. Release is incomplete until production evidence above is recorded.
