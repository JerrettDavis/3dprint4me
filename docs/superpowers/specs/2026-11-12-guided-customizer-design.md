# Guided customizer design

## Approved direction

The user selected wireframe A, requested several related decisions per section rather than a long wizard, required image/illustration choices for selections including face, topper and color, and authorized implementation on November 12. Preserve the large preview and one contextual editing rail. Use polished, truthful geometry-derived visuals where available and carefully drawn consistent illustrations elsewhere. No decorative dashboard density. No merge or deployment authorization.

## Layout and interaction

- Desktop: approximately 65% stable model viewport and 35% editing rail, within a generous maximum width. The viewport never sits underneath controls. Preview mode and camera tools remain available.
- Mobile: preview above section navigation and controls in normal document flow. No clipped fixed-height sheet or overlay competing with the preview. Test 375/390px and zoom/reduced motion.
- Use two or three meaningful editing sections plus Review, adapted to each schema. Each section contains several related choices. Never make a field its own mandatory step. Direct section access, previous/next controls, and an optional All settings view support experienced users.
- Presets belong in the first editing section, in a compact gallery with expansion. Keep existing replacement/Undo semantics explicit. Advanced controls remain available within the editing surface; they must retain values and remain reachable from validation.
- Review replaces the editing region, showing existing local facts, warnings and a privacy-safe configuration summary, with existing request/download actions. Do not invent estimates or imply print certainty.
- Preserve current parameters, schema bounds, dependencies, clamp/validation, image/font attachment ownership, private intake, serialization, draft keys and product provenance. Navigation and theme must not rebuild geometry or modify configuration. Sensitive values must never appear in review or new persistent UI state.

## Shared implementation

Add a pure schema-to-editing-section mapping (presentation only) and a shared DOM shell around the existing form and facts nodes. Re-parent existing controls instead of rebuilding them during navigation, preserving focus, sensitive live values, image/font widgets and debounce state. Preserve full Category/Section inspection via All settings for expert use.

Replace enum presentation with accessible image/illustration tiles and colors with labeled swatches plus custom entry. Keep original native controls as the authoritative form inputs, with events going through the existing change handler. Single choice uses native radio behavior or an equivalent tested keyboard pattern; avoid duplicate focus stops. Native font choices already render sample typography and retain their searchable/disclosed presentation. Numeric/text/profile controls retain precise input. Technical toggles receive clear illustrated affordances without losing native checkbox semantics.

Visuals use the existing same-origin product renders for available designs. Option art must correspond to the option: pumpkin faces can reuse actual face polygons, toppers use accurate silhouettes, technical choices illustrate their physical effect, colors use labeled swatches. Fallbacks must be honest visual labels or icons, never a misleading unrelated render. Keep asset payloads small and local; do not add libraries, network dependencies, or change CSP.

## Inventory at origin/main c8faae51

Ten registered builders: vase; infinity-fidget; route-shield; wifi-tag; rating-card; name-plate; pumpkin; display-sign; gridfinity-base; gridfinity-bin. All use `framework/app.js`, schema-generated `form.js`, `windows.js` and `styles.css`. Existing product designs include render metadata; other designs have swatches. The form supports persistent native nodes, field visibility, group/category changes, advanced visibility, keyed errors, profile editors and image/font attachments. Preserve these interfaces. Existing windows currently overlay a full-height viewport and become a mobile sheet; replace that default with the guided layout.

Suggested grouped sections: pumpkin appearance / proportions and construction; Gridfinity footprint and compartments / construction and finish; vase profile and form / surface and finish; fidget shape and construction / personalization and finish; text/sign/card builders content / appearance and size. Display-sign may require a third editing section for its many text and ornament slots. Every field must map once, including future schema additions through a deterministic fallback.

## Verification and delivery

Unit tests for complete/unique section mapping, safe review, accurate option art dispatch, escaping and visual control markup. Browser tests for every generator's initial build and editing navigation, visual selection, advanced errors, state preservation, keyboard operation, failed builds, offline exports and request handoff. Existing full-form regression tests may explicitly use All settings; new tests must exercise the default guided experience. Run `npm test`, `npm run screenshots`, inspect `screenshots/preview-board.png`, build/version generated assets, and update `docs/GENERATORS.md`. Deliver a reviewable branch with evidence and limitations; no production deploy or merge.
