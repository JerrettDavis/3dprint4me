# Parametric Generators Section Design

**Status:** Draft for review, 2026-10-02 (two items need an owner decision; see Open questions)

## Purpose

Add a **Customize** section to 3dprint4.me where customers configure a parametric model in the browser, preview it in 2D and 3D, and send it through the existing request, private-model, slicer-estimate and operator-queue pipeline. Anything that is repeatedly custom-built for customers and can be made parametric becomes a *generator* — a small plugin on a shared framework.

The browser prototype (`model-customizer-pages`, Route shield) proved the technique: Manifold WASM geometry, flush multi-color inlays, QR, text, and Bambu-compatible 3MF export. This design turns that prototype into a product surface without weakening any invariant in `AGENTS.md`.

## Success criteria

1. A customer can pick a generator, adjust validated parameters, see a live preview, and submit with no account.
2. The generated 3MF enters the existing private-estimate flow; the operator sees generator id/version, parameters, the model, and the slice estimate on the work item.
3. Adding a new generator requires only a new generator folder plus a catalog entry — no framework, page, or API changes.
4. All `AGENTS.md` invariants and the existing unit, E2E and UX/audit suites still pass; the deployment stays within 12 serverless functions.
5. The slicer worker runs on jdh-docker-00 and estimates a real generated model end to end.

## Non-goals

- Payments beyond the existing deposit flow; accounts; a customer model gallery.
- Server-side CAD. Geometry is generated in the customer's browser; the server validates parameters, not meshes.
- Hiding generator code. The site is a static bundle; nothing in it can be kept secret from a determined visitor.

## Findings that shape the design

- The prototype generator is monolithic: outline, layout, UI wiring and the shield-specific limits are hardcoded in `generator.js` / `app.js`. Reusable already: Manifold loader, `text.js` (block + OpenType), QR builder, `three-mf.js` (Bambu packages, ≤5 colors), `viewer3d.js`, and the *pattern* in `limits.js` (ranges plus cross-parameter clamping).
- The site CSP forbids what the prototype needs: no `wasm-unsafe-eval`, no `worker-src`, `font-src 'self'` only (the prototype's Google Fonts/Fontsource modes cannot work).
- The site has no bundler; the customizer needs one (Vite).
- Print estimation already accepts a browser-held model file (`chooseModelFile` → private upload → verified immutable estimate → queued slice job) and is shared browser/server code under `public/assets/js/print-estimation/`. The generator handoff reuses it unchanged.

### Verified during design (2026-10-02)

- The site's geometry analyzer (`public/assets/js/print-estimation/geometry.js`) parses both the prototype's core 3MF and a full Bambu package from `three-mf.js` correctly: component-based assemblies, volumes and bounds are right, and embedded Bambu settings are flagged and ignored (`embedded_settings_ignored`).
- `bambu-cli-slicer.js` passes **one** filament file to the CLI (the material's, else the default). Behavior with a 3-5 color 3MF is unverified: it may fail (-61 filament/plate mismatch) or silently ignore purge/tool-change waste, making multi-color estimates too low. Docker is available locally, so this is tested first (Milestone 1) before any generator depends on it.
- `scripts/dev-server.mjs` sets only a few security headers and **not** the CSP, so E2E tests currently never see the real policy.
- `scripts/version-assets.mjs` walks every HTML/CSS/JS file under `public/` and rewrites relative `./*.js|css` references; it must exclude the Vite output or it will corrupt hashed bundles.

## Architecture

### Layout

```text
customizer/                      Vite workspace (source; not served)
  framework/                     engine loader, preview, 3MF export, form renderer, handoff
  generators/<id>/
    schema.js                    ISOMORPHIC: params, ranges, defaults, cross-field rules, presets
    build.js                     BROWSER-ONLY: params -> parts[] (Manifold)
    preview.js                   optional 2D preview/svg + ui hints
  catalog.js                     id, title, blurb, category, access, version
public/customize/                build output (hashed assets), produced by `vercel-build`
public/assets/js/customize/      shared isomorphic schema runtime + generator schemas
                                 (included in serverless bundle, like print-estimation)
```

Schemas live where server code can import them (the existing pattern for print-estimation modules); geometry never ships to the server.

### Generator contract

```js
export default {
  id: 'rating-card', version: 3,
  schema,            // typed params: number{min,max,step}, enum, bool, text{max, sensitive?}, color, icon, image
  rules(params),     // cross-field limits (the computeLimits/clampOptions pattern, generalized)
  presets,           // named starting points (e.g. "business card", "keychain")
  build(params, ctx) // ctx: manifold, text(), qr(), icon(), image(); returns [{ name, color, mesh }]
}
```

The framework renders the form from `schema`, enforces `rules` for the UI, runs `build` in a Web Worker (keeps the page responsive), drives the shared 2D/3D preview, and exports through the shared 3MF writer. Parameter values are plain JSON.

### Shared primitives (extracted from the prototype)

Manifold engine loader; text (block font, curated self-hosted fonts, local font upload); QR (with the 0.82 mm/module floor and scan-safe overlap); extrude/inlay helpers (flush color insets, raised/cut text, minimum-web rules); star/ratings and icon shapes; 3MF + Bambu package writer; validation helpers.

### Launch generator set

| Id | Notes |
|---|---|
| `route-shield` | Port of the prototype; proves the framework against known-good output |
| `wifi-tag` | WIFI QR (`WIFI:T:WPA;S:..;P:..;;`, correctly escaped) with presets: placard, keychain (loop/hole), business-card size (85.6 × 54 mm) |
| `rating-card` | Business-card size; customizable icon (curated library, e.g. toilet) or traced image; 0–5 stars in half steps (clipped star shapes); caption text, e.g. "Would poop here again" |
| `name-plate` | Stylized names: curated decorative fonts, outline/shadow/extrude styles, optional keychain loop |

Each generator ships independently behind its own catalog entry; the framework plus `route-shield` ships first.

### Images and icons

- Curated icon library: original or clearly licensed SVGs, converted to paths at build time.
- Customer image: loaded and traced **in the browser** (threshold → contour tracing → simplification) with bounded dimensions and point counts; only the resulting vector enters the 3MF. The source image is not uploaded unless the customer attaches it to the request. Failure returns a clear message, never a raw error.

### Fonts

Default: a curated set of OFL-licensed fonts, self-hosted and listed with licenses, plus local font upload (bytes stay in the browser). The prototype's remote Google Fonts/Fontsource modes would need a `connect-src` allowance scoped to `/customize/*` (opentype.js fetches font bytes) and disclose the customer's visit to a third party; whether to keep them is an open question.

### Provenance and rights

Each catalog entry records `origin` (house design, or the client commission it derives from) and `rights` (publishable: yes/no, with a note). A design commissioned under a contract that does not permit reuse is not added to the public catalog; the framework itself needs no access-control feature for that. Whether any generator should also be reachable only by direct URL is an open question (below), not a built feature.

### Sensitive parameters

Schema fields may be flagged `sensitive` (e.g. the Wi-Fi password). Sensitive values are **never sent to the server**: the browser redacts them before hand-off, the server redacts them again defensively, and they are excluded from email, webhook payloads, local drafts and the downloadable JSON. The operator sees "withheld (in the model's QR code)". The 3MF necessarily embeds the QR, so the model file follows the existing private-asset retention rules, and the customer is told this in plain language before submitting. Nothing sensitive is stored in the request, so no retention-sweep change is needed.

## Request handoff

**Source of truth:** the uploaded 3MF is the object that is estimated and printed. The parameters are provenance and a convenience, not the model: the server cannot prove a mesh matches them, and models that used a local font file or a traced customer image cannot be rebuilt from parameters alone.

**Flow (decided; single intake):**

1. The generator page holds the model in memory and shows local, non-binding facts (dimensions, volume, rough weight/time via the shared browser geometry module). It does not upload, so parameter changes never touch the rate-limited estimate sessions (3 assets and bounded estimates per session).
2. **Continue to request** builds the 3MF, stores `{ file, customization }` in IndexedDB, and opens `/order.html?service=print&from=customize`. The order page loads the file through the existing `chooseModelFile` path, pre-selects the print service, and lets the customer finish intake. The private upload, verified estimate snapshot and queued slice job happen there, once, with all existing fallbacks (no integration: local draft, email handoff, download). The price range is first shown on the order page, as for any uploaded model.
3. The request carries `customization = { generatorId, generatorVersion, params }` (sensitive fields per above). The server re-validates it against the generator's isomorphic schema and rules (bounded size; unknown generators/keys rejected); browser values stay non-binding.
4. No new serverless function: validation hooks into the existing request handler. The operator work detail shows generator, version and parameters beside the model and estimate; "reopen in customizer" loads the parameters for a best-effort comparison and says clearly when inputs (local font, traced image) are unavailable.
5. Storage: no migration. `customization` is part of the request payload already persisted as `service_requests.payload` JSONB and returned to the operator as `request` in work detail.

## Slicing

The Bambu Studio CLI worker (merged in #22-#24) is the estimator. Before production:

1. **First task of the project:** build the worker image locally and slice a real 3-5 color 3MF (the verified Bambu package above, then each generator's output); confirm `result.json` parsing, tool-change/purge reporting, and preset-versus-embedded-settings priority. If the adapter's single-filament handling is wrong for multi-color, extend it (one filament preset per color slot) before any estimate is trusted; confirm result.json parsing, tool-change/purge reporting, and that preset-priority over embedded Bambu settings behaves.
2. Prepare the Portainer stack for jdh-docker-00 and the `SLICER_PROVIDER` setting. **The production steps (credentials, Vercel env, Portainer) are executed only with explicit owner confirmation.**
3. Generator parts map to color roles; ≤5 colors per model (existing exporter limit) is a schema-level rule.

## Site integration

- New pages: `/customize/` (catalog) and `/customize/<id>/`, linked from the main nav, sitemap (public generators only) and the home page; theme (light/dark/system), keyboard focus, reduced motion and 390 px behavior match the site system.
- CSP: the global header rule is changed to exclude `/customize/*` (negative-lookahead source) and `/customize/(.*)` gets its own complete policy adding `'wasm-unsafe-eval'` and `worker-src 'self' blob:`; no reliance on header precedence between two rules. `dev-server.mjs` is extended to apply the same CSP so E2E exercises it.
- `vercel-build` runs the Vite build first, then `assets:version` and `validate`. `version-assets.mjs` excludes `public/customize/` (Vite hashes its own files); `validate.mjs` and the secret scan are extended to cover it. `npm run dev` and the pytest E2E suite build the bundle first. `vercel.json` `includeFiles` gains the isomorphic schema directory (the same omission broke print-estimation once; fixed in df19e09).
- No secrets in the bundle; `browser-secret-scan.mjs` covers it.

## Error handling

Geometry failures (empty cross-section, text that cannot fit, QR payload too dense, invalid images) surface as plain-language messages next to the offending control; the request cannot be submitted with an invalid model. Worker crash or WASM load failure shows a retry state and a manual-request fallback that keeps the parameters. Slicer outage never blocks submission (existing contract).

## Testing

- Unit: each `schema`/`rules` (limits, clamping, WIFI escaping, star clipping), framework form rendering, parameter validation on the server, handoff payload.
- Geometry: golden checks per generator (manifold validity, bounding box, color-part count, minimum-web and QR-module floors) run in Node against Manifold WASM; 3MF round-trip through the site's own `three-mf.js` parser.
- E2E (Playwright, existing harness): catalog → generator → submit → operator detail shows parameters and estimate; no-integration fallback; mobile 390 px.
- UX/a11y audit and screenshots per `AGENTS.md`; CSP and secret-scan checks.
- Slicer: documented manual verification against the container for each generator.

## Milestones

1. Framework + `route-shield` port, output verified against the prototype's known-good 3MF.
2. Site section, theme, CSP, build integration.
3. Request handoff, server validation, migration, operator view.
4. `wifi-tag`, then `rating-card`, then `name-plate`.
5. Local slicer verification with generated models; docs (`docs/GENERATORS.md`, DEPLOYMENT/PRINT-ESTIMATION updates).
6. Production rollout (worker on jdh-docker-00, Vercel env) with owner sign-off.

## Open items (decided here, change on review)

- Source moves into `customizer/` of this repo; `model-customizer-pages` is retained as the archived prototype.
- Generator versions are integers; a request pins the version that produced its model.

## Open questions for the owner

1. **"As the negotiated contract permits":** read as a rights limit on what becomes a public generator (a client's commission is only published if their contract allows it), handled by the provenance/rights note above. Or should some generators also be hidden from the catalog and reachable only by direct URL for a specific client (discovery control only; the code is static)?
2. **Fonts:** self-hosted curated set only (recommended; matches the site's privacy and CSP stance), or also allow the prototype's remote font search, with a scoped `connect-src` and a privacy disclosure?
