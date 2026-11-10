# Customizable infinity fidget generator

## Intent and authorization

Build and release an offline customizer for articulated infinity fidgets on 3dprint4.me, following the existing generator studio, downloads and private request handoff. The user's requested end state is deployed on main with all GitHub Actions green. Work is authorized through release; this document records engineering choices, not additional user approvals.

## Required behavior

- An eight-block infinity mechanism with captured, freely rotating connectors. A decorative collection of disconnected cubes or a rigid fused assembly does not satisfy the request.
- Adjustable block size, connector thickness, running clearance and edge chamfer. Changes must preserve connector capture, material around the sockets and the intended folding motion.
- Rectangular, triangular and spherical shape families. The user explicitly selected the infinity-triangle folding mechanism on 2026-11-09: triangular blocks on the eight-block cube topology do not satisfy that option. Each family requires mechanically meaningful geometry and separate motion checks; changing only the label or preview is insufficient.
- Smooth, knurled, ridged, hexagonal and line surface treatments. Details must exist in downloaded geometry and stay out of connector motion envelopes.
- Per-block symbols/text, a simple local image/pixel decoration workflow, and individual block color assignments. STL exports preserve the geometry; 3MF preserves supported material assignments. The framework currently supports at most five unique material colors, including decoration and connectors. Explain and enforce that bound rather than silently recoloring output.
- Existing printable STL and multicolor 3MF download routes, order handoff, meaningful build warnings, same-origin offline operation, local drafts, theme/accessibility and narrow-screen behavior.
- Practical defaults for a 0.4 mm nozzle and 0.2 mm layers. Clearances are nominal design dimensions, not promises about a printer. A physical print test remains an explicitly reported limitation until one is performed.

## Reference evidence

The user supplied these product references:

1. https://makerworld.com/en/models/1572338-infinity-cube-fidget-toy#profileId-3029587
2. https://makerworld.com/en/models/2329694-infinity-cube-fidget-print-in-place#profileId-2545344
3. https://makerworld.com/en/models/1954658-fidget-cube-toy#profileId-2100660
4. https://makerworld.com/en/models/1396187-infinity-triangle-cube-fidget-toy#profileId-1447226
5. https://makerworld.com/en/models/752702-minecraft-creeper-fidget-cube#profileId-686612

On 2026-11-09 reference 1 was accessible in Chrome. Its description identifies eight connected cubes, infinite folding and print-in-place construction. Its license is Creative Commons Attribution-Noncommercial-Share Alike. Comments report floating hinge features and adhesion/unsupported-print failures. References 2–5 returned a “Just a moment” challenge, so their actual dimensions, connectors and licenses are not yet verified. Do not claim dimensional parity from titles or inaccessible pages.

The user confirmed on 2026-11-09 that they have permission/source files. The files and applicable permission details have been requested and remain pending. Inspect them before selecting final reference-derived topology and dimensions, and retain applicable provenance/permission evidence. The public noncommercial license alone does not document the user's separate permission. Use original sample graphics unless the supplied rights also cover the referenced artwork. Similar mechanical behavior, measured connector fidelity and comparable adjustable detail remain required.

## Architecture and engineering choices

Reuse the existing browser/worker Manifold engine, schema form, viewer, export writer and handoff. No new remote service, dependency or generator-page network origin is needed. Public isomorphic definitions contain schema and pure geometry policy; boolean solids exist only in the worker. The server registry validates provenance using the same definition.

Separate mechanical dimensions and topology from surface decoration. Every hinge declares block endpoints, axis, position, journal radius, bearing clearance, axial clearance, retention overlap and its reserved sweep envelope. Shapes and textures must not intrude into those envelopes. A collision-free neutral pose alone is insufficient: verify a full folding sequence and loop closure with independent rigid transforms, plus mesh intersections at intermediate poses.

Prefer a horizontal print layout with self-supporting bearing profiles and supported starts. If a proposed print-in-place hinge contains an isolated floating island, redesign its print orientation or geometry; do not cover the failure with generic “supports optional” guidance. A fit coupon should use the production hinge geometry and selected tolerances.

Bounds and parameter restrictions must come from the geometry. Invalid scalar values and dangerous cross-field combinations fail before allocating expensive meshes. Decoration complexity and image dimensions need explicit caps. Retain user edits and report actionable field errors instead of silently changing a shape or dropping artwork.

Per-block colors use the existing five-material limit. Distinct block color controls may reuse any of those colors. Decoration boolean partitions must not overlap block solids; a colored mark is printable geometry, not a viewer-only overlay.

## Work boundaries

1. Mechanical core: pure dimensions, hinge construction, topology and independent movement/collision verification.
2. Shape and decoration: geometry, symbols, local image path, bounded workload and material partitions.
3. Studio integration: registry/page, presets, fit coupon, exports, draft and private handoff.
4. Release: documentation, full tests, screenshots and board inspection, slicing fixtures, PR checks, main merge/deployment, production offline/export/handoff checks and green main Actions.

These are implementation stages, not reduced release scope. Keep the generator out of the public catalog until mechanical and export checks pass.

## Completion evidence

For each family and texture: validated parameters, successful closed/manifold solids, nonzero volume, correct dimensions, disconnected-part accounting, no intersecting material volumes, hinge retention, minimum gaps and independent folding-path checks. Include minimum/maximum meaningful size, chamfer, clearance and connector settings; invalid combinations must explain the affected field.

Parse actual downloaded STL and 3MF, not just builder outputs. Confirm marks and texture survive export, the STL is usable, 3MF colors survive and private handoff contains the selected model. Exercise all required features in browser, including image changes, per-block edits, offline reload/edit/download, keyboard focus, reduced motion, themes and 390 px layout.

Run `npm test`, `npm run screenshots`, inspect `screenshots/preview-board.png`, run customizer build plus asset versioning after source changes, and update generator operational docs. Slice representative shape and connector fixtures and inspect layers for floating starts, bearings, fusion and unsupported features. Publish no claim of physical fit or infinite motion based solely on synthetic mesh tests.

Release evidence must identify the deployed commit, PR and main workflow conclusions, production URLs and live download/handoff results. Any missing named option, motion proof, export check, required workflow or deployment remains unfinished.
