# Parametric Generators Section Design

**Status:** Draft for review, 2026-10-02

## Purpose

Add a **Customize** section to 3dprint4.me where customers configure a parametric model in the browser, preview it in 2D and 3D, and send it through the existing request, private-model, slicer-estimate and operator-queue pipeline. Anything that is repeatedly custom-built for customers and can be made parametric becomes a *generator* — a small plugin on a shared framework.

The browser prototype (`model-customizer-pages`, Route shield) proved the technique: Manifold WASM geometry, flush multi-color inlays, QR, text, and Bambu-compatible 3MF export. This design turns that prototype into a product surface without weakening any invariant in `AGENTS.md`.

## Success criteria

1. A customer can pick a generator, adjust validated parameters, see a live preview, and submit with no account.
2. The generated 3MF enters the existing private-estimate flow; the operator sees generator id/version, parameters, the model, and the slice estimate on the work item.
3. Adding a new generator requires only a new generator folder plus a catalog entry — no framework, page, or API changes.
4. All `AGENTS.md` invariants and the existing 220 unit / 61 E2E / 193 UX checks still pass; the deployment stays within 12 serverless functions.
5. The slicer worker runs on jdh-docker-00 and estimates a real generated model end to end.

## Non-goals

- Payments beyond the existing deposit flow; accounts; a customer model gallery.
- Server-side CAD. Geometry is generated in the customer's browser; the server validates parameters, not meshes.
- Hiding generator code. The site is a static bundle, so "restricted" generators are **unlisted, not secret** (see Access).

## Findings that shape the design

- The prototype generator is monolithic: outline, layout, UI wiring and the shield-specific limits are hardcoded in `generator.js` / `app.js`. Reusable already: Manifold loader, `text.js` (block + OpenType), QR builder, `three-mf.js` (Bambu packages, ≤5 colors), `viewer3d.js`, and the *pattern* in `limits.js` (ranges plus cross-parameter clamping).
- The site CSP forbids what the prototype needs: no `wasm-unsafe-eval`, no `worker-src`, `font-src 'self'` only (the prototype's Google Fonts/Fontsource modes cannot work).
- The site has no bundler; the customizer needs one (Vite).
- Print estimation already accepts a browser-held model file (`chooseModelFile` → private upload → verified immutable estimate → queued slice job) and is shared browser/server code under `public/assets/js/print-estimation/`. The generator handoff reuses it unchanged.

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
  schema,            // typed params: number{min,max,step}, enum, bool, text{max}, color, icon, image
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

A curated set of OFL-licensed fonts, self-hosted and listed with licenses; local font upload remains (bytes stay in the browser). Remote font services are removed to satisfy the CSP and the privacy stance.

### Access ("as the negotiated contract permits")

Catalog `access`: `public` (listed, indexed) or `unlisted` (not in catalog or sitemap, `noindex`, reachable only by its URL, optionally carrying a customer reference code that is stored on the request). This is discovery control, not security: the bundle is static. If a contract needs the code to be genuinely private, the generator must be delivered to that customer separately. The spec makes no stronger claim.

## Request handoff

1. `Submit` builds the 3MF in the worker, then calls the existing `chooseModelFile(file)`; private upload, server verification, geometry analysis, estimate snapshot and slice job follow the existing flow and its no-integration fallbacks (local draft, email handoff, downloadable JSON).
2. The request additionally carries `customization = { generatorId, generatorVersion, params, accessRef? }`.
3. The server **re-validates** `params` against the generator's isomorphic schema and rules (bounded size, unknown generators/keys rejected). Browser values stay non-binding. No new serverless function: validation hooks into the existing request handler; the operator work detail renders the parameters and a "reopen in customizer" link that reloads the parameters in the browser (the operator regenerates the model locally).
4. Storage: additive migration for a `customization` JSONB column on the request (details in the plan); rollback leaves it unused.

## Slicing

The Bambu Studio CLI worker (merged in #22-#24) is the estimator. Before production:

1. Slice a real multi-color generated 3MF (all four generators) in the worker container locally; confirm result.json parsing, tool-change/purge reporting, and that preset-priority over embedded Bambu settings behaves.
2. Prepare the Portainer stack for jdh-docker-00 and the `SLICER_PROVIDER` setting. **The production steps (credentials, Vercel env, Portainer) are executed only with explicit owner confirmation.**
3. Generator parts map to color roles; ≤5 colors per model (existing exporter limit) is a schema-level rule.

## Site integration

- New pages: `/customize/` (catalog) and `/customize/<id>/`, linked from the main nav, sitemap (public generators only) and the home page; theme (light/dark/system), keyboard focus, reduced motion and 390 px behavior match the site system.
- CSP: `script-src` gains `'wasm-unsafe-eval'` and `worker-src 'self' blob:` **only on `/customize/*`**; `font-src` stays `'self'`.
- `vercel-build` runs the Vite build into `public/customize/`; `validate.mjs`, `version-assets.mjs` and the secret scan are extended to understand the bundle. Node 22 compatibility of the Vite 8 build is verified (the prototype declares Node 24).
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
- Unlisted generators are a catalog flag, not an authorization system.
