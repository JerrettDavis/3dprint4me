# Redesign proposals — round one

Standalone throwaway prototypes for selection, not production implementation.

Run `python -m http.server 4381 --bind 127.0.0.1 --directory docs/design-concepts/2026-10-26` from the repository root, then open http://127.0.0.1:4381/catalog.html.

Three directions share a proposed product-led catalog: signs/name plates, gifts/local favorites, organizers/useful parts. Existing file printing, design, repair and consulting retain clear entry points. Categories are proposals; sellable SKUs, rights, dimensions, pricing and fulfillment have not been approved.

Each direction includes storefront, admin and partner views. The sign product opens a local lettering/color/quantity preview and review step. No data is persisted or submitted; other actions explain the proposed next screen. Sample workspace and earnings records are fictional. The user selected D as the direction on October 26 and requested blue + teal with a less generic visual character.

Production files and unrelated invoicing edits are unchanged. Screenshots are concept artifacts, not the production screenshot suite. Verification covers browser errors, viewport overflow, direction/screen switching and local product-dialog behavior; it does not establish production accessibility or integration readiness.

## Direction D — product counter

`catalog.html` proposes a more direct commerce layout with six starting points, purpose filters, product search, empty state, product detail previews, a table-based operator overview and task-led partner workspace. Product entries remain proposals; example images do not establish stock, rights or manufacturing readiness. This is a structurally different option to A–C, selected for refinement.

## Selected direction and color refinement — October 26

User feedback: “d is nice and we want to make sure our colors are blue+teal but not AI-like”. D is the chosen direction for further design work; this is not production implementation approval.

The refined concept uses fabrication blue `#174b71` for the brand and solid hero, deep blue `#102e43` for preview chrome, and working teal `#006e73` for primary actions and selected states. White carries the catalog. Teal is purposeful rather than a decorative wash. Real product photography, flat surfaces, square controls, typographic hierarchy and deliberate spacing carry the visual identity. No gradients, glow, purple accents, decorative dashboard tiles or ambient animations are added. Dark mode uses ink-blue surfaces and brighter teal controls.

These color values and role assignments are design choices proposed by the assistant, not exact brand colors supplied by the user. Existing content and concept interactions are retained. Full design specification, production integration and release checks remain future work.

## Design direction approved — October 26, 21:43 CDT

After reviewing the blue-and-teal D refinement, the user confirmed “looks good”. The selected visual direction is D, the product counter, with the blue-and-teal treatment shown in `catalog.html` across storefront, admin and partner previews.

The requested proposal/selection phase is complete. Production implementation is a separate next phase: product/catalog definitions, complete page and interaction design, integration with the existing four service paths and private workflows, and the repository's full tests and screenshot review remain necessary before release. This approval does not approve proposed products, prices, stock, payment commitments or deployment.
