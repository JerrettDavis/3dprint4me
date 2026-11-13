# Guided customizer UI

The approved direction is A: a dominant preview, one contextual editing rail, several related decisions per section, and visual selections. The engine and request contracts remain documented in [GENERATORS.md](GENERATORS.md).

## Audited inventory

Every route is `/customize/g/<id>/`. Counts include hidden/dependency-controlled fields; they are not the number shown at once. All builders use the shared form, worker client, draft handling, preview and request pipeline.

| Builder | Fields | Advanced | Editing sections before Review |
|---|---:|---:|---|
| vase | 17 | 0 | Profile & form; Surface & finish |
| infinity-fidget | 37 | 9 | Shape & construction; Personalize & finish |
| route-shield | 29 | 0 | Content & details; Style & size |
| wifi-tag | 31 | 0 | Content & details; Style & size |
| rating-card | 28 | 0 | Content & details; Style & size |
| name-plate | 19 | 0 | Content & details; Style & size |
| pumpkin | 60 | 37 | Design & appearance; Size & construction |
| display-sign | 253 | 0 | Text & artwork; Style & color; Size & holder |
| gridfinity-base | 13 | 9 | Size & layout; Construction & finish |
| gridfinity-bin | 14 | 2 | Size & layout; Construction & finish |

The Wi-Fi password is the one sensitive field. Review excludes it, transient inputs, and fields hidden by dependencies. It remains live only in its original masked control. Image files and own fonts retain their existing browser-only memory ownership; switching sections re-parents their containing group and does not serialize them.

## Components and tokens

- `studio-sections.js`: pure schema-to-editing-section mapping and privacy-safe review entries. Every field maps exactly once; future groups fall into the final editing section.
- `studio-shell.js`: navigation, previous/next, available-section recovery, error links, Review and All settings. It reuses the existing settings/facts nodes, with no engine or storage ownership.
- `form.js`: original native controls, validation, dependencies, debouncing and attachments. Visual radio tiles commit through the existing native select change event; swatches use the original color input. Fonts retain real typography samples. Numeric/text/profile editing remains precise.
- `option-art.js` / `face-art.js`: local SVG diagrams and actual geometry-derived pumpkin face/feature paths. Known physical options use distinct diagrams; unknown cases use honest typography instead of unrelated model imagery. Verified catalogue preset renders retain their provenance.
- `studio.css`: layout and visual states using the existing semantic `--page`, `--surface`, `--surface-2`, `--ink`, `--muted`, `--line`, `--teal` and `--focus-color` tokens. No per-builder theme or new remote font is introduced. Outline/checkmark and name/role/value supplement color.

The wide layout uses an approximately 1.8:1 preview/control ratio, adapts at 1000px, and stacks below 760px. Mobile controls follow the preview in document flow. Desktop preview sticks below the shared header. Large choice sets show featured options plus the selected value, with See all. All settings retains Category/Section inspection, field locks, Randomize and existing group collapses.

Idle/building/ready/error status and stale-preview/failure handling stay with the app and worker. The shell moves the live facts/warnings surface into Review. Errors can open another editing section and Advanced before focusing the field. Part selection routes to its containing section. Presets, Undo/reset and body-source changes refit the model; ordinary edits retain the camera.

## Maintenance and verification

Display-sign sections use in-place disclosures for each text slot, decoration, holder text, and shared category. Text 1 starts open; other content panels expand on demand. These disclosures reuse the existing controls and attachments, preserve edits across navigation, and open automatically when a validation link or model-part selection targets a field. All settings retains the full inspector.

Selected catalogue product context stays visible in both Review and editing, including the Change settings shortcut. Product-specific edits still preserve the customer's separate generator draft.

After face geometry changes, run `node scripts/build-option-art.mjs`. After any customizer change, run `npm run customizer:build && npm run assets:version`. Update the mapping or add accurate art when introducing new schema groups/options; keep the complete-mapping and distinct-art regressions green.

`tests/unit/customize-studio.test.mjs` checks mapping, safe review and art; `tests/e2e/test_guided_customize.py` exercises the default guided workflow. Existing `test_customize.py` full-form engine regressions explicitly enter All settings. These cover geometry, fonts, uploaded art, offline export, product provenance and request recovery separately from navigation tests.

Run `npm test` and `npm run screenshots`. The final customizer refresh covers 71 views; full screenshot capture covers the rest of the storefront/operator too. The contact sheet uses bounded thumbnails so its complete PNG can be decoded by normal review tooling; full-resolution captures retain all detail.

No backend, geometry semantics, pricing, parameter versions, draft keys, request payloads, CSP origins or deployment settings changed. Physical fit/printability and non-binding planning figures retain their prior limitations. This implementation does not add cloud save/share or enable otherwise unavailable actions. Merge and deployment remain separate authorized operations.
