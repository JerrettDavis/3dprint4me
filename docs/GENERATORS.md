# Parametric generators (Customize)

A **generator** is a small plugin that turns a handful of validated parameters into a printable,
multi-color 3MF, entirely in the customer's browser. The Customize section (`/customize/`) lists
the public generators; each has a page (`/customize/g/<id>/`) with a schema-driven form, a 2D/3D
preview, local planning facts, and **Continue to request**, which hands the built model to the
ordinary print request on `/order.html`. The server never builds geometry; it re-validates the
parameters as provenance. The uploaded 3MF is the object that is estimated and printed.

Launch set: `route-shield`, `wifi-tag`, `rating-card`, `name-plate`.

This document describes the contract **as implemented**. Where the design spec
([2026-10-02-parametric-generators-design.md](superpowers/specs/2026-10-02-parametric-generators-design.md))
differs, this document and the code win (see [Differences from the design spec](#differences-from-the-design-spec)).

## Where the code lives

| Path | Role | Runs in |
|---|---|---|
| `public/assets/js/customize/registry.js` | `GENERATORS` (id → definition), `getGenerator`, `listPublicGenerators` | browser, worker, server |
| `public/assets/js/customize/generators/<id>.js` | The generator **definition**: schema, rules, presets, rights, hooks | browser, worker, server |
| `public/assets/js/customize/schema.js` | `validateParams`, `clampParams`, `redactSensitive`, `sensitiveKeys` | browser, worker, server |
| `public/assets/js/customize/{color,fonts,wifi}.js` | Shared isomorphic helpers (contrast, curated font list, WIFI: payload) | browser, worker, server |
| `customizer/generators/index.js` | `loadBuilder` (id → dynamic `import()` of the builder) | worker |
| `customizer/generators/<id>/build.js` | The generator **builder**: params → solids (Manifold) | worker only |
| `customizer/framework/` | Engine loader, text/QR/shapes/icons/image tracing, 3MF writer, `buildModel`, worker + client, form, page app, catalog, hand-off writer | browser / worker |
| `customizer/framework/{app,form,windows,viewer3d,sections,motion,ui-state}.js`, `customizer/styles.css` | The page UI: the studio layout, tool windows, section grouping, part picking, transitions (see [Page layout](#page-layout-the-studio)) | browser |
| `customizer/g/<id>/index.html` | The generator page (Vite entry) | — |
| `customizer/static/fonts/` | Self-hosted OFL fonts, licenses, `SHA256SUMS`, `fonts.css` | served at `/customize/fonts/` |
| `public/assets/js/order/customize-handoff.js` | Order-page reader of the hand-off record | browser |
| `lib/customization/domain.js` | `normalizeCustomization` (server re-validation) | server |
| `operator/assets/customization-detail.js` | Operator work-detail "Customizer" section | operator PWA |

The definition is isomorphic: it must import nothing browser-only, because `lib/validation.js`
imports it through the registry (the Vercel function bundle includes `public/assets/js/**`).
Geometry code never ships to the server.

## Definition

`public/assets/js/customize/generators/<id>.js` default-exports a plain object:

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | URL-safe id; the registry key, page folder, `loadBuilder` key and draft key (`3dp-customize:<id>:v<version>`). |
| `version` | yes | Positive integer. A request pins the version that produced its model; the server accepts `1..version`. Bump it when a parameter's meaning changes. |
| `title`, `blurb` | yes | Catalog card text; `title` also prefills the order's project title ("Custom <title>"). |
| `category` | yes | Catalog label key (`badges`, `tags`, `cards`, `plates`; anything else is title-cased). |
| `origin` | yes | Where the design comes from (`"house"`, or the commission it derives from). |
| `rights` | yes | `{ publishable: boolean, note: string }`. Only `publishable: true` generators appear in the catalog and sitemap (see [Provenance and rights](#provenance-and-rights)). |
| `schema` | yes | Parameter fields (next section). |
| `rules(params)` | no | Cross-field rules; returns `{ limits, errors, fieldErrors }`. |
| `presets` | no | Named partial parameter sets. Today they are **data only**: the page does not offer a preset picker; the all-generators test builds every preset. |
| `errorField(message)` | no | Maps a build (geometry) error message to the schema key it belongs next to, or `null` for the Settings summary. An unkeyed error keeps **Try again** visible. |
| `onParamChange(key, params)` | no | Runs only for a committed edit of `key`; returns values derived from it (e.g. a format's own defaults), or `null`/`{}`. |
| `image` | no | `{ when: { <field>: <value> }, threshold: <int field>, invert: <bool field> }` — while `when` holds, the page shows a local image picker under that field and traces the image (rating card). |
| `font` | no | The shared font spec `FONT_SPEC` (`public/assets/js/customize/fonts.js`): `{ key: "font", custom: "custom", system: "system", ack: "font_license_ack", curated: true }`. Every generator that prints text sets it; see *Fonts*. |
| `publicParams(params)` | no | Last-chance filter for the parameters written into 3MF metadata (applied after redaction). No launch generator uses it. |
| `sections` | no | `{ sectionKey: "Label", … }`, **ordered**: the model regions the Settings panel can group by (see [Sections and focus](#sections-and-focus)). |
| `focus` | no | `[{ part: "<solid name or prefix>", section: "<sectionKey>" }, …]`: which built solid belongs to which section, so the preview can be hovered and clicked. |

### Schema fields

`schema` maps a key to a field definition. Common options: `type`, `default` (required), `label`,
`help` (replaces the generated help text; for a number it is shown under the slider, e.g.
"0 = automatic / centered"), `group` (the **category** fieldset: `text`, `size`, `layout`, `back`,
`colors`, `font`, or any word, title-cased), `section` (the **model region** the field belongs
to, a key of `sections`) and `visibleWhen`.

| `type` | Options | Validation (`validateParams`) | Control |
|---|---|---|---|
| `number` | `min`, `max`, `step`, `unit` | finite, within `[min, max]`, on the step grid counted from `min` | slider + number box |
| `int` | same | as `number`, plus whole | slider + number box |
| `enum` | `options: [{ value, label, face?, group? }]`, `picker: "font"` | value is one of the options | `<select>`; `picker: "font"` renders the font picker (each option drawn in its own face; an option's `group` is a category heading, see [Fonts](#fonts)) |
| `bool` | — | boolean | checkbox |
| `color` | — | `#rrggbb` (stored lower-case) | color input |
| `text` | `max`, `optional`, `multiline`, `preserveWhitespace`, `sensitive` | string; no control characters (newlines allowed only when `multiline`; CRLF is normalized); at most `max` visible characters (zero-width characters are not counted; raw length is capped at `4 × max`); trimmed unless `preserveWhitespace`; whitespace alone never satisfies a required (non-`optional`) field | text box; `multiline` → textarea; `sensitive` → masked single-line box (never a textarea) with a fixed privacy note |

`visibleWhen` hides a control (and the page ignores it) unless it holds: an object
`{ key: value }` or `{ key: [values…] }` (all entries must match), or a function
`params => boolean`. Visibility is presentation only; hidden fields are still validated and sent.

`validateParams(generator, input, { skipSensitive })` returns `{ ok, errors, value, fieldErrors }`.
Unknown keys and arrays are rejected; missing keys take their defaults. `rules()` runs only when
every field is individually valid. With `skipSensitive` (the server), sensitive fields are not
validated and become `"[redacted]"`.

`clampParams(generator, params, changedKey)` is what the form applies on a committed edit: it runs
`onParamChange`, snaps the changed number to its own field range and step, then makes every other
number yield to the `limits` that `rules()` computes from the updated values ("the moved parameter
wins"). Without `changedKey` every number is clamped to the current limits.

### Sections and focus

`group` stays the **category** (text, size, colors…). `section` names the **region of the model** a
field changes, so the colors, fonts and sizes of one region sit together. All of it is optional
and isomorphic (plain data, no browser imports); a generator without it keeps the Category
grouping and no hover/click linking.

```js
export default {
  sections: { top: "Upper text", lower: "Lower text", back: "Back", qr: "QR code" }, // ORDERED: panel order
  focus: [                       // built solid name (or name prefix) -> section
    { part: "Upper text", section: "top" },
    { part: "Lower text", section: "lower" },
    { part: "Back", section: "back" }
  ],
  schema: {
    top_text: { type: "text", label: "Upper text", group: "text", section: "top", /* … */ },
    top_color: { type: "color", label: "Upper text color", group: "colors", section: "top", /* … */ },
    width_mm: { type: "number", label: "Width", group: "size", /* no section: "General" */ }
  }
};
```

- `sections` is an ordered object `{ key: "Label" }`. Keys that no field or `focus` entry uses are
  dropped; a key used by a field or `focus` but not declared gets a title-cased label.
  Fields without `section` go to **General**, placed last unless `sections` has a `general` key
  (then it sits where you put it). The Section grouping is offered only when at least one field
  has a `section`.
- `focus[].part` is matched against the `name` of each solid the builder returns (the `name` in
  `build()`'s `solids`, also the part name in the 3MF). An exact name wins; otherwise the longest
  prefix wins; ties go to the first entry. Several solids may map to one section, and a section
  may have settings but no part (or the reverse: a part with no settings just gets the tooltip).
- Pure helpers (unit-tested, `customizer/framework/sections.js`): `sectionList`, `sectionLabel`,
  `fieldSection`, `hasSections`, `partSection`, `partsOfSection`; `groupFields(generator, mode)`
  in `form.js` returns the groups for `"section"` or `"category"`. Both modes list the same fields.

### `rules(params)`

Return `{ limits, errors, fieldErrors }`, all optional:

- `limits`: `{ key: [min, max] }` — rule-derived ranges for numeric fields; the form also uses them
  as the control's `min`/`max`.
- `errors`: messages for the Settings summary (a rule error blocks the build and Continue).
- `fieldErrors`: `{ key: message }` — shown under that control (`aria-invalid`,
  `aria-describedby`); unknown keys are ignored.

`rules` receives the working object and may **normalize** it in place (the Wi-Fi tag forces
`show_text = false` for keychains); the same code runs in the browser, the build and on the
server, so all three agree. Keep messages free of parameter values that could be sensitive.

## Builder

`customizer/generators/<id>/build.js` default-exports
`async build(params, ctx) → { solids, warnings?, title?, filenameBase? }`:

- `params`: the validated value from `validateParams` (sensitive fields included — the builder is
  the only place a secret is used, e.g. encoded into QR geometry).
- `ctx = { wasm, font, imageContours }`: the initialised Manifold module (`wasm.Manifold`,
  `wasm.CrossSection`), an opentype.js `Font` or `null` (built-in block font), and a traced
  customer image as plain `[[x, y], …]` contours or `null`.
- `solids`: `[{ name, color, solid }]` where `solid` is a Manifold. Parts that share a color print
  in the same filament; **at most 5 distinct colors** (`buildModel` throws `too-many-colors`).
- `warnings`: plain-language strings shown under the facts (never containing sensitive values).
- `title`, `filenameBase`: 3MF title and download name (`safeName` keeps `[A-Za-z0-9_-]`, 40 chars).
  Never derive them from a sensitive field.

Throw an `Error` with a customer-readable message for geometry that cannot be made (text that
does not fit, a QR code too dense for the tag, disconnected letters); `errorField` decides where it
is shown. Do not throw raw library errors.

`buildModel(generator, params, ctx)` (`customizer/framework/model.js`) calls `build`, validates
colors, moves the model onto the plate corner, removes zero-area triangles (Manifold `simplify`
with a 1e-6 mm tolerance; otherwise the site's analyzer would warn "the mesh may need repair".
Surfaces may move by up to that tolerance: measured over every default and preset, the relative
volume change is at most 2e-7 and bounds shift at most 1e-6 mm), writes the
Bambu-compatible 3MF with `three-mf.js`, and **frees every solid it was given**, on success and on
error. It returns `{ data, parts, warnings, filename, metrics: { part_count, unique_colors, triangles } }`.

### Manifold rules (R11)

- Never write `new CrossSection([])`: it throws in manifold-3d 3.5.4. Use `CrossSection.union([])`
  for an empty cross-section.
- WASM objects are not garbage-collected. Collect every temporary and delete it in a `finally`
  (the pattern in `customizer/generators/route-shield/build.js`); only the returned solids may stay
  alive, and nothing may stay alive after a throw.
- Prove it with the leak guard: `trackLiveObjects(wasm)` in `tests/support/manifold-live.mjs`
  instruments `Manifold`/`CrossSection` and returns `{ live, ctxWasm, restore }`. Build with
  `ctx.wasm = ctxWasm`, then assert `live.size === solids.length` (and `0` after a failed build).
  `new Manifold`, `decompose()` results and getters are not visible to the wrapper.

### Worker and queue

Builds run in a module Web Worker (`customizer/framework/worker.js`): it loads the engine once
(the hashed `.wasm` URL from Vite), the builder through `loadBuilder`, and a font through
`loadFont`, then posts the 3MF bytes back (transferred). `worker-client.js` keeps **one request in
flight and at most one queued**: a newer edit supersedes older ones (their promises reject with
`SupersededError` and are ignored), so rapid edits cost at most one extra build. A build that takes
more than 30 s, or a worker crash, terminates and recreates the worker and shows **Try again**
(retryable). Font bytes and image contours are cloned only for the request that actually runs.

Failures are classified (`worker-core.js`, `build-status.js`). If the builder itself does not
load (the Manifold WASM, the generator's builder module, or a curated font from `/customize/fonts/`
fails to fetch or parse), the worker answers `{ retryable: true, code: "load-failed" }`, and the
client replaces the worker, because a failed module import can stay cached inside it. A worker
that does not start or that crashes gives `code: "worker-failed"`. In both cases the page says
"We couldn't load the model builder. Check your connection and try again." with **Try again**,
and the Settings panel shows no error. A timeout (`code: "timeout"`) keeps its own message.
Everything else (geometry, rule, or the customer's own unreadable font file) is a build error:
the message goes next to the field it concerns, and the status says "The model couldn't be built
with these settings".

On the page (`app.js`): a field edit is validated first (field and rule errors appear without a
build); typing rebuilds after a 150 ms debounce; a committed edit (change, slider release, select)
is clamped, and a commit that changes nothing does not rebuild (`applyEdit`). Facts (size,
volume, rough weight/time, color count) come from analysing the built 3MF with the site's own
`print-estimation/geometry.js`. Drafts are kept in `sessionStorage` without sensitive fields.

## Page layout (the studio)

A generator page is one full-height workspace under the site header (`customizer/g/<id>/index.html`
is the same markup for every generator; only title, intro and the generator-specific notes differ):

- **Top bar**: back link, title (`h1.cz-title`), the **Front / Back / 3D** view tabs (`[data-view]`,
  roving `tabindex`, arrow keys), **Print bed** (3D only; `#cz-bed-toggle`), and **Continue to
  request** (`#cz-continue`). Changing view eases in (a camera tween for 3D framing changes, a quick
  fade/flip of the canvas between views).
- **Canvas** (`#cz-stage`): the preview fills the whole area; the model is centred in the space the
  floating windows leave free (`viewer.setInset`). Dark in both themes so light model colors stay
  visible. `#cz-status` (state chip), the Try again strip (`#cz-fallback`) and the Continue note
  (`#cz-continue-note`) float over it; a separate visually hidden live region (`#cz-announce`)
  announces section selections.
- **Tool windows** (`framework/windows.js`): **Settings** (left: group-by toggle, Reset to defaults,
  the form, image/font areas, privacy note) and **Local facts** (right: color badge, facts,
  warnings, "About this design" with the intro and font-license link). Each title bar is a real
  button (`aria-expanded`) that collapses the window; collapsed state is remembered. **Escape**
  inside a window moves focus to its title button; Escape on the title button collapses it; Escape
  elsewhere clears the selected section. Windows are docked, not draggable.
- **At 899 px and below** the windows are one **bottom sheet** with a **Settings | Facts** tab
  strip and a chevron that collapses it to the strip; the preview keeps the rest of the screen and
  the model is centred above the sheet. Sheet motion is `transform`/`opacity` only (no horizontal
  overflow at 390 px).
- **Group by: Section | Category** (Settings window, persisted per user): Section groups by
  `section` (labels from `sections`), Category by `group` (the original fieldsets). Every group is a
  collapsible `h3 > button` with `aria-expanded`; switching re-parents the same field nodes (values,
  secrets and attached areas survive) with a short fade. Hidden when no field has a `section`.
- **Preview ⇄ settings linking** (needs `focus`): hovering a part outlines and tints it, shows a
  label tooltip (the section's label) and softly marks that section's settings; hovering or focusing
  a section's settings tints its parts. Clicking or tapping a part selects its section: the window
  opens, the section expands and scrolls into view with a brief pulse, keyboard focus moves to its
  first control (Category mode: the section's fields; touch does not move focus, to avoid the
  on-screen keyboard), and `#cz-announce` says which section was selected. Dragging (more than 6 px,
  a long press, or two fingers) orbits/pans and never picks. Parts are per-solid meshes tagged with
  the solid's `name`; picking is a raycast in both the 3D and the flat views.
- **Motion**: panel and group expand/collapse (height + opacity), mode switch, field errors opening
  and closing, new warnings, status changes, model swap (cross-fade and scale-in), view and camera
  changes, bottom-sheet tab switch. Everything uses WAAPI/transitions on `transform`/`opacity` (one
  height transition for collapsing), never gates state (`hidden`/`aria-*` are set at once), and is
  instant under `prefers-reduced-motion: reduce` (`motion.js`, the `--cz-dur*` tokens).
- **Remembered per user** (`localStorage` key `3dp-customize:ui:v1`, try/catch, no parameter
  values): window collapsed state, the sheet tab, the group-by mode and collapsed groups.

Stable hooks (tests, `customize-handoff`, screenshots): `#cz-form`, `#cz-status`, `#cz-facts-list`,
`#cz-color-badge`, `#cz-warnings`, `#cz-continue`, `#cz-continue-note`, `#cz-retry`, `#cz-fallback`,
`#cz-stage`, `#cz-stage-message`, `#cz-reset`, `#cz-bed-toggle`, `[data-view]`, `#cz-image-area` and
its children, `#cz-font-*`, `.cz-preview`, `.cz-summary`, `body[data-build-state]`, `[data-field]`.

## Hand-off to the order page and server validation

**Continue to request** (`continue.js`) stores one record in IndexedDB (`3dp-customize` /
`handoff` / `pending`): `{ file (Blob), filename, generatorId, generatorVersion, generatorTitle,
params, createdAt }`, where `params` holds only the schema's own keys with sensitive fields
replaced by `"[redacted]"`. It then opens `/order.html?service=print&from=customize`.

The order page reads the record once (read-and-delete in one transaction; older than 30 minutes or
malformed reads as "no hand-off"), attaches the file through the normal model path, prefills an
empty title/description, and shows "Loaded from the customizer — review and continue." From there
the request is an ordinary print request: private upload, verified estimate, queued slice job,
every existing fallback. The customization is dropped when the customer removes or replaces the
handed-off file, and it is only ever sent for the print service.

If IndexedDB is unavailable or throws, the 3MF is **downloaded** instead and the order page opens
with `&handoff=download` and asks the customer to attach it.

Server: `lib/validation.js` calls `normalizeCustomization(input.customization)` for print requests
only (other services always get `null`). It rejects a non-object, an unknown generator, a version
outside `1..version`, non-object params, params over 8000 bytes of JSON, unknown keys and any
schema/rule violation (HTTP 400). A version mismatch or a schema/rule violation is usually a stale
design, made before the generator changed. For those, the message ends with "This design was made
with an older version of the generator. Remove the attached model and open the customizer again."
and the response carries `details.code: "customization-stale"`; it never includes a submitted
value. The order page then shows that message inside the handed-off model's row in the file list,
next to its Remove button. Otherwise it returns
`{ generatorId, generatorVersion, params (sensitive → "[redacted]"), redacted: [keys] }`. That
object is stored inside the request payload (`service_requests.payload` JSONB; no migration), sent
in owner email and webhooks with sensitive values shown as withheld, and rendered on the operator
work detail ("Customizer": generator, version, parameters, and "The attached 3MF is the model to
print; these values are provenance."). The customer's local submitted copy keeps only
`{ generatorId, generatorVersion }`.

## Sensitive fields

Mark a text field `sensitive: true` when its value must not leave the browser (the Wi-Fi
password). Then:

- It is **never stored**: not in the draft, the hand-off record, the request, the local dev log,
  the operator store, email, webhooks or the customer's downloadable JSON. The browser sends
  `"[redacted]"`, and the server replaces whatever arrives with `"[redacted]"` again.
- `buildModel` redacts it from the 3MF metadata (`redactSensitive` via `generator.schema`).
- The builder may use it only as geometry (the Wi-Fi password exists solely as QR modules).
  Filenames, titles, part names and warnings must not contain it.
- The form masks it, never writes it into markup, and shows a fixed note saying where it goes.
  The control is **not** `type="password"`: a password box next to a text field reads as a login
  form, so browsers would offer to save the Wi-Fi password as this site's password and autofill a
  saved site login into the form. It is a `type="text"` box masked by CSS (`.cz-secret`,
  `-webkit-text-security: disc`, supported by Chromium, Safari and Firefox 114+). It has no form
  `name` (it is found by `data-key`) and carries `autocomplete="off"` plus the LastPass, 1Password
  and Dashlane opt-outs. `#cz-form` has `autocomplete="off"` and never submits. A browser
  without CSS masking gets `type="password"` with `autocomplete="new-password"` at runtime, which
  is never autofilled.
- The 3MF itself necessarily encodes it, so the file follows the private-upload retention rules,
  and the page says so before Continue.

Tests that hold this line: `customize-all-generators.test.mjs` (a canary in every sensitive field
never appears in any inflated 3MF entry, the filename or part names), `customize-wifi.test.mjs`,
`customization-domain.test.mjs`, `project-request.test.mjs` (persisted, recorded, emailed and
webhooked copies are redacted) and the E2E Wi-Fi flows (the typed password is absent from
`data/dev-requests.ndjson`, the operator store and browser storage).

## Provenance and rights

Every definition records `origin` and `rights: { publishable, note }`. A design commissioned under
a contract that does not allow reuse gets `publishable: false`: it stays out of the catalog and
sitemap (validation fails if it is listed), though its page still builds and is reachable by
direct URL. The site is static: nothing in a generator can be kept secret from a visitor, so do
not add a generator whose geometry itself is confidential. All four launch generators are
`origin: "house"`, `rights: { publishable: true, note: "House design." }`.

## Fonts

- Only fonts under the **SIL Open Font License 1.1**, self-hosted under `customizer/static/fonts/`
  and served same-origin from `/customize/fonts/` (CSP `font-src 'self'`, `connect-src 'self'`).
  No remote font services.
- `LICENSES.md` lists each family, its upstream source and its license file; the OFL text ships
  beside each font; `SHA256SUMS` pins every file. `customize-name-plate.test.mjs` checks all three.
- A customer's own font is parsed in the browser (opentype.js) and never uploaded or stored.
  There are two sources, both behind a license confirmation (below): a **font file** they pick,
  and a **font installed on their computer**, listed through the Local Font Access API
  (`window.queryLocalFonts`: Chromium on a computer; the choice is disabled elsewhere with a note
  pointing to the file option). The browser asks permission, and only from a click on
  "Choose an installed font…", which stays disabled until the confirmation is checked.

### One font control for every generator

`fontSchema(group, used)`, `fontRule`, `FONT_OPTIONS` and `FONT_SPEC` in
`public/assets/js/customize/fonts.js` are the single definition. A generator spreads
`...fontSchema("text", used)` into its schema, calls `fontRule(params, used(params))` from `rules()`,
sets `font: FONT_SPEC` and maps font errors (`/font file|installed font/`) to the `font` field.
`used` says when the design prints text at all (the Wi-Fi tag's keychain format and a rating card
without a caption have none, so the controls and the confirmation disappear). The choices, in
order: `block` (built-in), the curated fonts, `system` (installed font), `custom` (font file).
`customize-shared-font.test.mjs` fails if any generator drifts from this.

- **License confirmation.** `system` and `custom` bring a font we did not vet, so the form shows a
  `font_license_ack` checkbox ("I have the right to use this font to make a printed item.") and the
  rule `fontRule` refuses the model until it is checked. Nothing in the own-font panel is usable
  before that. The confirmation is a schema field, so it is validated by the server and recorded
  with the request's customization parameters (provenance), but it is `transient`: never written to
  a draft. A draft that had a font from the customer's computer comes back with the default font
  (the font has to be picked again anyway).
- **Page.** `framework/font-area.js` builds the panel for both sources from the generator's
  `font` spec (no per-page markup); `framework/system-fonts.js` lists, filters (60 shown at a
  time) and reads installed fonts. The bytes go to the worker as `fontBytes` with a `fontKey`
  (`system:<PostScript name>` or the file's name/size/date) and live in page memory only. Samples in
  the list use the installed family by name (`font-family`), so no `blob:` font URL or CSP change is
  needed.
- **Text in a real font.** `framework/text.js` `fontTextLines` fits a one- or two-line label in a
  box (used by the Wi-Fi tag title and network name and the rating card caption); characters the
  font lacks are skipped with a warning, and a label with none drawable is an error next to its
  field. The "capital letters only" notes apply to the block font only.
- A font collection (`.ttc`) or some variable fonts do not parse; the customer is told to try
  another font or a font file.

### Per-location fonts

A text location (the upper line, the back text, a plate's second line…) may use its own font:

- **Schema**: `...locationFontField("top_font", "Upper text font", { group: "text", section: "top", visibleWhen })`
  (`public/assets/js/customize/fonts.js`) adds an enum whose options are `LOCATION_FONT_OPTIONS`:
  `inherit` ("Same as main font", the default), `block`, then every curated font. Overrides never
  offer the customer's own font or an installed font (those stay the single, license-confirmed main
  font). Keys should end in `_font`; the page renders them with the same font picker.
- **Build**: `locationFont(options, ctx, "top_font")` (`customizer/framework/text.js`) returns
  `{ mode, font }`: `inherit` (or a missing field) resolves to the main font, `block` to the
  built-in font (`font: null`), any other id to `ctx.fonts[id]` (loaded by the worker; it throws a
  readable "The selected font isn't loaded" otherwise).
- **Load**: `locationFontIds(generator, params)` lists the curated ids the overrides ask for (it finds
  the fields by the `locationFont: true` flag `locationFontField` sets, not by option identity: the module can be
  loaded twice, with and without `?v=`); the page sends them through `worker-client.js` to the worker as
  `locationFontIds`, which loads them into `ctx.fonts`.

### The font picker (`picker: "font"`)

Options keep definition order and may carry `group` (a category such as "Script"): the list draws a
heading whenever the group changes (an ungrouped option after grouped ones gets a plain divider), so
arrow-key order is always option order. The list scrolls inside a bounded box, supports type-ahead
(type a name; repeat a letter to cycle) and the usual arrow/Enter/Escape keys. Each option is drawn
in its own `cz-ff-<face>` class, but only the first ten are styled when the list opens; the rest get
their face as they scroll into view (IntersectionObserver), so a 35-font list does not download
every font file at once. Every face is same-origin (`fonts.css`, `font-display: swap`).

### QR size and printability

`public/assets/js/customize/qr.js` is shared by the page, the builders and the server:
`qrScaleField(group = "back", extra)` adds a `QR code size` number (25-100 %, default 100, step 5)
and `qrModuleStatus(moduleMm)` returns `{ level: "ok" | "marginal" | "unprintable", message }` for a
module (cell) width: below 0.6 mm (`QR_FLOOR_MODULE_MM`) a code cannot be printed (the builder
throws a readable error that `errorField` points at the QR fields; `framework/qr.js` already
refuses codes under the floor), from 0.6 to 1.0 mm (`QR_COMFORT_MODULE_MM`) it prints but may not
scan reliably (the builder returns `status.message` as a warning, shown under the facts), and from
1.0 mm it is fine.

To add a curated font: download the unmodified TTF from the OFL folder of the Google Fonts
repository (`https://github.com/google/fonts/raw/main/ofl/<family>/`; check the license is OFL,
not Apache), add the file and its `OFL.txt` (as `OFL-<family>.txt`) to `customizer/static/fonts/`,
add a line to `SHA256SUMS` (`sha256sum`), a section to `LICENSES.md`, an `@font-face` with family `cz-<id>` to
`fonts.css` (the picker draws each option in its own face; the test checks one rule per font),
and an entry to `FONTS` in
`public/assets/js/customize/fonts.js`. Run the name-plate tests and look at the picker.

## Generator parameter notes (current versions)

| Generator | Version | Notes |
|---|---|---|
| `route-shield` | 3 | `top_font`/`lower_font`/`back_font` overrides (default `inherit`); `qr_scale_pct` (25-100, default 100). `top_offset_mm`/`lower_offset_mm` are measured from the **auto-centered** position (0 = glyph ink centered in its color field, positive = up). Back parts are named "Back text", "QR code", "3dprint4.me mark" (same color, three parts). |
| `wifi-tag` | 2 | `qr_scale_pct`; border (`border_style` none/raised/engraved, `border_width_mm`, `border_inset_mm`); QR frame (`qr_frame`, `qr_frame_width_mm`, `qr_frame_gap_mm`); dividers (`title_divider`, `network_divider`, `divider_width_mm`, `divider_length_pct`); `decor_height_mm`, `decor_color`; `title_font`, `network_font`. All default to off/100, so the v1 look is unchanged. Parts "Title text inlay" and "Network name inlay" replace "Label text inlay". |
| `rating-card` | 2 | `corner_style` (round/chamfer/notch), `border_style`, `frame_style`, widths/insets, `groove_depth_mm`, `divider` (none/caption/icon/both), `caption_font`. Raised decorations print in `icon_color` (the card already uses five colors). |
| `name-plate` | 2 | New default plate `hug` ("Contour"): the letters grown by exactly `plate_margin_mm` (1-10, default 3) with round joins, clipped to ink ± margin, holes filled; constant thickness everywhere, never thicker above/below any letter. `none` keeps its hard-edged rectangular connector bars; they start/end inside each neighbour across the whole centre band (rows sampled), so slanted letters (A, V) are overlapped in every row. Old `none`/`pill`/`rect` values stay valid. |
| `name-plate` (office sign) | 2 (no bump) | `size: "office"` makes the standard 8 × 2 in desk sign (203.2 × 50.8 mm): a rounded rectangle regardless of `plate`, the name centered in the room inside a 5 mm margin (at most `height_mm` tall), no keychain loop. `plate_image: "custom"` (office only; `onParamChange` resets it when the size goes back to `fit`) adds the customer's image at the left, traced in the browser like the rating card (`image` spec, `ctx.imageContours`, never a parameter), as an extra "Image" part in `image_color`, raised or inlaid with the style. Defaults (`fit`, no image) keep old requests identical. |

Old drafts and requests stay valid: missing keys take their defaults, and the server accepts versions 1..current.

## Images

The rating card's "My own image" is decoded and traced in the browser (`image-input.js`,
`image-trace.js`); only the traced contours go to the worker and into the model. Nothing is
uploaded, logged or stored, and the image is never a parameter.

- The file is refused before reading when empty or over 8 MB, and before **decoding** when its
  declared size (read from the header — PNG IHDR, GIF screen, WebP VP8/VP8L/VP8X, JPEG first SOF;
  at most 512 KB of header is read, enough for large EXIF/ICC segments) exceeds 4096 px on a side
  or 64 MP. The type is sniffed from the bytes, never trusted from the name or MIME type.
- The browser decodes it resized to at most 512 px on the long side; tracing is bounded
  (200 000 contour points) and failures are readable messages next to the control.

## Build pipeline

- `npm run customizer:build` — Vite (8.3.2, Rolldown) builds `customizer/` into
  `public/customize/` (gitignored): hashed `assets/`, the catalog and one page per
  `customizer/g/<id>/`, the Manifold `.wasm`, and `customizer/static/` (fonts) copied verbatim.
  `npm run customizer:dev` serves it with hot reload.
- `npm run assets:version` must run **after** the Vite build: it versions only the HTML under
  `public/customize/` (Vite hashes its own assets) and rewrites `?v=` keys in tracked public files.
  The release key includes the built customize HTML, so customizer changes can change `?v=` in
  tracked files: commit those changes.
- `npm run vercel-build` = `customizer:build && assets:version && validate`; `npm test` builds first.
- Node: `package.json` pins `22.x`; Vite 8.3.2 and Rolldown require Node `^20.19.0 || >=22.12.0`
  (verified on 22.22.0). esbuild was bumped from `^0.25.12` to `^0.28.0` because Vite 8.3.2's
  optional peer range (`^0.27 || ^0.28`) conflicted at install (npm ERESOLVE); esbuild still builds
  the operator auth bundle (`npm run operator:build`).
- **CSP split** (`vercel.json`, source of truth `scripts/csp.mjs`, drift-tested): the global header
  rule matches `/((?!customize/).*)`; `/customize/(.*)` has its own complete policy adding
  `'wasm-unsafe-eval'` and `worker-src 'self' blob:`, with `connect-src 'self'` only. The dev server
  applies the same split, so the E2E tests run under the real policy. `/customize/assets/*` is
  cached immutably; `/customize/fonts/*` for a day.

## Validation gates

`npm run validate` (part of `vercel-build` and `npm test`) fails when a registered generator lacks
`customizer/g/<id>/index.html` with `<meta name="generator-id" content="<id>">`, a `loadBuilder`
entry, a built page, an `origin`, a positive integer `version`, or a `rights` record with a
boolean `publishable` and a non-empty `note`; when a publishable generator is missing from the
sitemap, the catalog or `scripts/capture_screenshots.py`; when an unpublishable one is listed; and
when anything under `public/customize/` contains a remote URL or a remote request
(`scanRemoteRequests` in `scripts/browser-secret-scan.mjs`: every absolute URL literal must be one
of a short list of XML/SVG namespace strings or opentype.js message links, or start with
`https://3dprint4.me/`; `fetch`, XHR, `import()`, `importScripts`, `sendBeacon`, `WebSocket`,
`EventSource` and `Worker` calls with a literal remote or protocol-relative target are flagged, as is any `//host` URL in an HTML resource attribute, a CSS `url()`/`@import` or a JS string literal). The shared site assets the generator pages load (site.css, shared.css, site.js and the modules it imports, favicon, manifest) are checked for remote *requests* only, since site.js legitimately contains profile links. The gate logic is `scripts/generator-gates.mjs` (`checkGenerators`, `checkCustomizeNetwork`), unit-tested on fixtures.

`tests/unit/customize-all-generators.test.mjs` builds every generator's defaults and every preset
on real Manifold and requires: validation passes (defaults may fail only on sensitive fields, then
must pass with a value there), a build under 20 s, 1–5 colors, no analyzer warning other than
`embedded_settings_ignored`, and no sensitive canary anywhere in the 3MF text, filename or part
names. The E2E matrix in `tests/e2e/test_customize.py` runs every generator page end to end.

## Adding a generator

1. **Definition** — `public/assets/js/customize/generators/<id>.js` (schema, rules, presets,
   `origin`, `rights` with a real note, hooks). Isomorphic imports only, with `?v=` suffixes like
   its neighbours (`npm run assets:version` maintains them).
2. **Builder** — `customizer/generators/<id>/build.js` per [Builder](#builder): `CrossSection.union([])`
   for empties, temporaries freed in `finally`, readable errors, ≤ 5 colors.
3. **Registry** — import it in `registry.js` and add it to `GENERATORS`; add
   `"<id>": () => import("./<id>/build.js")` to `customizer/generators/index.js`.
4. **Page** — copy `customizer/g/<existing>/index.html` to `customizer/g/<id>/index.html`; set
   `<meta name="generator-id">`, title, canonical, `<h1 class="cz-title">` (top bar), the
   `<p class="cz-intro">` in the "About this design" block and any generator-specific notes (a
   note under `#cz-form`, an area attached with `form.attach`). Keep the studio markup and ids
   intact ([Page layout](#page-layout-the-studio)). No inline scripts (CSP). Vite picks the
   folder up automatically. Declare `sections`/`focus` in the definition and a `section` on each
   field to get the Section grouping and the click-a-part behavior.
5. **Sitemap** — add `<url><loc>https://3dprint4.me/customize/g/<id>/</loc>…</url>` to
   `public/sitemap.xml` (publishable generators only).
6. **Screenshots** — add views of the page to `scripts/capture_screenshots.py`.
7. **Tests** — a `tests/unit/customize-<id>.test.mjs` with schema/rules cases, golden geometry
   checks (bounds, part count, volumes, minimum web), a leak-guard test and failure messages; add
   the generator's flow to `edit_and_wait` in `tests/e2e/test_customize.py` (the matrix fails until
   you do); extend `customize-pages.test.mjs` if the page has special copy.
8. **Rights** — confirm the design may be published and say why in `rights.note`.
9. **Build and check** — `npm run customizer:build && npm run assets:version`, then `npm test`,
   `npm run screenshots`, and look at the screenshots. Commit any `?v=` changes.

## Troubleshooting

| Symptom | Check |
|---|---|
| "Preparing the model builder…" never ends, or **Try again** right away; console `Refused to compile or instantiate WebAssembly` / `Refused to create a worker` | The page did not get the customize CSP. Inspect the `Content-Security-Policy` response header on `/customize/...`: it must include `'wasm-unsafe-eval'` and `worker-src 'self' blob:`. Link generator pages **with the trailing slash** — `/customize` without it falls under the global rule. |
| A build fails with "too dense" (Wi-Fi tag, route shield QR) | The QR payload needs more modules than fit at the 0.82 mm/module floor. Shorten the network name/password or URL, or choose a larger format. |
| A curated font shows "couldn't be loaded" | The worker fetches `/customize/fonts/<file>` same-origin. Check that the file is in `public/customize/fonts/` after the build, that it returns `200` with `font/ttf`, and that nothing (extension, proxy) blocks it. The page offers **Try again**. |
| `npm run validate` reports a remote URL in `public/customize/` | A dependency or new code added an absolute URL. Remove it; if it is a harmless name (an XML namespace), add the exact string to `allowedUrlStrings` with a comment saying why. |
| `npm run validate` says `?v=` keys are stale | Run `npm run customizer:build && npm run assets:version` and commit the changed files. |
| The order page warns about the model's mesh | Run the all-generators test; `buildModel` should leave no zero-area triangles. |

## Differences from the design spec

- Layout: the definition lives in `public/assets/js/customize/generators/<id>.js`, not
  `customizer/generators/<id>/schema.js`; there is no `preview.js` or `catalog.js` per generator
  (the catalog is the registry).
- `build` returns `{ solids: [{ name, color, solid }], … }` (Manifolds, freed by `buildModel`), not
  meshes; `ctx` is `{ wasm, font, imageContours }`, not `text()/qr()/icon()/image()` helpers (those
  are imported from `customizer/framework/`).
- Adding a generator needs a page, a sitemap entry, registry and `loadBuilder` lines and a screenshot
  entry — not "only a folder plus a catalog entry" (success criterion 3).
- Presets are not offered in the UI yet.
- "Reopen in customizer" from the operator detail is not implemented.

## Known notes

- **Route shield maker mark reads mirrored in the 3D preview.** The fixed "3dprint4.me" mark is
  inlaid in the lower vertical edge. The builder mirrors it (`mirror([1, 0])`) before rotating it
  onto that face, exactly as the ported prototype does (`customizer/generators/route-shield/build.js`,
  "Fixed 3dprint4.me mark"). In the 3D preview, seen from the front, the edge text therefore
  reads right-to-left (see `screenshots/customize-route-shield-3d-desktop-dark.png`). The
  behaviour was kept as-is to match the prototype's known-good output. Whether the mark should
  read correctly on the printed edge is an open product decision; check it on a physical print
  before changing the geometry, and update the route-shield golden checks if it changes.
