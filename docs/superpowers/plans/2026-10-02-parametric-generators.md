# Parametric Generators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Customize section to 3dprint4.me with a generator framework and four launch generator families (route shield, Wi-Fi tag, rating card, name plate) whose output flows through the existing request, private-estimate, slicer and operator pipeline.

**Architecture:** A Vite workspace (`customizer/`) builds a browser-only app into `public/customize/`. Parameter schemas and rules are isomorphic modules under `public/assets/js/customize/` so the server can re-validate them (same pattern as `public/assets/js/print-estimation/`). Geometry (Manifold WASM) runs only in a browser Web Worker. "Continue to request" hands the generated 3MF plus provenance to `order.html` through IndexedDB; the existing order/estimate flow does the rest. No migration (the request already persists as `service_requests.payload` JSONB, and the operator work detail already returns `request`).

**Tech Stack:** Node 22 ESM, Vite, manifold-3d 3.5.4, opentype.js 2.0.0, qrcode-generator 2.0.4, fflate 0.8.3, three 0.170.0, `node:test`, Python/Playwright E2E, Vercel, Bambu Studio CLI worker (Docker).

**Spec:** `docs/superpowers/specs/2026-10-02-parametric-generators-design.md` (approved 2026-10-02: provenance/rights note instead of access control; self-hosted fonts only).

## Global Constraints

- Only `public/` is static output; no secret enters `public/` or any browser bundle (`AGENTS.md` invariants 1-2).
- Browser values are non-binding; the server re-validates `customization` against the isomorphic schema (invariant 4).
- Deployment stays at 12 serverless functions (existing unit test guards the Vercel Hobby limit) — add **no** `api/*.js` file.
- Light, dark, system theme, keyboard focus, reduced motion and 390 px responsive behavior must hold on every new page (invariant 7).
- No public analytics/tracking and no remote fonts or third-party requests from `/customize/*`.
- Bambu export supports at most **5** unique colors (`three-mf.js` `MAX_SLOTS`); each generator's schema must keep palettes at ≤ 5 colors.
- QR minimum module size **0.82 mm** (existing floor); neighbouring QR modules overlap by 0.01 mm.
- Wi-Fi password and any `sensitive` field is **never** sent to the server, stored, emailed, webhooked or saved in drafts (see Task 6; this tightens the spec's "masked in operator view" to "never stored", because the QR in the 3MF already carries it).
- Every task runs `npm test` clean before commit; visible changes also run `npm run screenshots` and are inspected (`AGENTS.md` change workflow).
- Imports inside `public/assets/js/**` are written plainly (`./x.js`); run `npm run assets:version` to add `?v=` keys before committing (existing convention).
- Node: the site declares `22.x`; the prototype declared `>=24`. Task 1 verifies the Vite build on Node 22 before anything depends on it.

## Review Focus

1. **Multi-color slicing** — a 3-5 color 3MF through the single-filament Bambu adapter may fail (-61) or under-report purge; customers would get low estimates. Pinned in Task 0 (real container slice) and Task 0's adapter test.
2. **Sensitive values leaking** — Wi-Fi password in request payload, email, webhook, draft, downloaded JSON or operator view. Pinned in Task 6 (server redaction test, draft test) and Task 7.
3. **QR that won't scan / is too dense** — long SSID+password on a keychain-size tag. Expected: a clear error before submit, never a thin unscannable code. Pinned in Task 7.
4. **Text that does not fit** (long names, 40-char captions) — expected: size auto-shrinks to the floor, then a plain-language error; never clipped geometry. Pinned in Tasks 4, 8, 9.
5. **Unusual input in free-text fields** — emoji/RTL/combining characters, empty strings, whitespace-only, 10 000-char payloads, a font lacking glyphs. Expected: sanitized, bounded, no crash. Pinned in Tasks 2, 6, 9.
6. **Broken or hostile customer image** — huge, 0×0, animated, non-image. Expected: bounded decode and a readable error. Pinned in Task 8.

---

## File Structure

```text
customizer/                                    NEW  Vite workspace (not served)
  vite.config.js                                    multi-page build -> ../public/customize
  index.html                                        catalog page
  g/<id>/index.html                                 one page per generator (4)
  static/fonts/*.ttf, static/fonts/LICENSES.md      self-hosted OFL fonts (copied to /customize/fonts)
  framework/engine.js                               Manifold loader (browser + Node)
  framework/model.js                                buildModel(): solids -> shifted meshes -> 3MF
  framework/three-mf.js, bambu-template.js          ported from prototype (unchanged logic)
  framework/text.js                                 ported + font loading by id
  framework/qr.js                                   QR cross-section (ported)
  framework/shapes.js                               roundedRect, star, loop, ring
  framework/icons.js, image-trace.js                icon library, customer-image tracing
  framework/worker.js, worker-client.js             off-main-thread build
  framework/form.js                                 schema-driven controls
  framework/viewer3d.js                             ported
  framework/app.js, catalog.js                      page controllers
  framework/handoff.js                              IndexedDB handoff writer
  generators/<id>/build.js                          browser-only geometry (4)
public/assets/js/customize/                    NEW  isomorphic (browser + server)
  schema.js                                         field types, validate/clamp/redact
  wifi.js                                           WIFI: payload escaping
  registry.js                                       id -> generator definition
  generators/{route-shield,wifi-tag,rating-card,name-plate}.js   schema+rules+presets+metadata
public/assets/js/order/customize-handoff.js    NEW  order-page reader of the handoff
lib/customization/domain.js                    NEW  normalizeCustomization()
operator/assets/customization-detail.js        NEW  operator render
tests/unit/{customize-*,customization-*}.test.mjs   NEW
tests/e2e/test_customize.py                    NEW
docs/GENERATORS.md                             NEW
```

Modified: `package.json`, `.gitignore`, `vercel.json`, `scripts/{dev-server,version-assets,validate}.mjs`, `lib/validation.js`, `lib/notifications.js`, `lib/print-estimation/adapters/bambu-cli-slicer.js`, `public/assets/js/{site,order}.js`, `public/{index,order}.html`, `public/sitemap.xml`, `operator/assets/operator.js`, `docs/{DEPLOYMENT,PRINT-ESTIMATION}.md`, `AGENTS.md`.

Prototype sources to port (read-only reference): `G:\git\model-customizer-pages\src\{generator,limits,template,text,three-mf,bambu-template,viewer3d}.js`.

---

### Task 0: Verify multi-color slicing in the worker container

**Files:**
- Modify: `lib/print-estimation/adapters/bambu-cli-slicer.js` (only if Step 5 shows a failure)
- Create: `scripts/slicer-smoke.mjs`, `tests/fixtures/customize/three-color-bambu.3mf` (generated), `docs/superpowers/notes/2026-10-02-multicolor-slicing.md`
- Test: `tests/unit/bambu-multicolor.test.mjs`

**Interfaces:**
- Produces: `colorSlots(options) -> number` exported from `bambu-cli-slicer.js` (1-5); results note recorded for later tasks.

- [ ] **Step 1: Generate a three-color Bambu fixture from the prototype exporter**

```bash
cd G:/git/3dprint4me-generators
mkdir -p tests/fixtures/customize docs/superpowers/notes
cat > scripts/make-fixture-3mf.mjs <<'EOF'
// One-off: three touching cubes in three colors, written with the prototype's Bambu exporter.
import { writeFileSync } from "node:fs";
import { package3mf } from "../../model-customizer-pages/src/three-mf.js";
const cube = (x, s) => ({ vertices: [[x,0,0],[x+s,0,0],[x+s,s,0],[x,s,0],[x,0,s],[x+s,0,s],[x+s,s,s],[x,s,s]],
  triangles: [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]] });
const parts = [["a","#ff0000",0],["b","#00ff00",20],["c","#0000ff",40]].map(([name, color, x]) => ({ name, color, mesh: cube(x, 18) }));
writeFileSync(new URL("../tests/fixtures/customize/three-color-bambu.3mf", import.meta.url), package3mf(parts, { title: "three-color", description: "fixture", parameters: {} }));
EOF
node scripts/make-fixture-3mf.mjs && rm scripts/make-fixture-3mf.mjs && ls -l tests/fixtures/customize
```

Expected: a ~14 KB `three-color-bambu.3mf`.

- [ ] **Step 2: Build the worker image and slice the fixture**

```bash
cd G:/git/3dprint4me-generators
docker build -f deploy/slicer-worker/Dockerfile.bambu -t 3dp-slicer-test deploy/slicer-worker 2>&1 | tail -5
docker run --rm -v "$PWD/tests/fixtures/customize:/in:ro" --entrypoint node 3dp-slicer-test \
  scripts/slicer-smoke.mjs /in/three-color-bambu.3mf
```

Create `scripts/slicer-smoke.mjs` first so this runs inside the image (the Dockerfile copies the repo; if `scripts/` is not copied, mount it with `-v "$PWD/scripts:/app/scripts:ro"`):

```js
// Slices one model with the configured provider and prints the contract result as JSON.
import { readFile } from "node:fs/promises";
import { createPrintEstimationRuntime } from "../lib/print-estimation/runtime.js";
const [, , path, colors = "3"] = process.argv;
const runtime = createPrintEstimationRuntime();
if (!runtime.slicer) { console.error("No slicer configured (set SLICER_PROVIDER)."); process.exit(2); }
const bytes = new Uint8Array(await readFile(path));
const result = await runtime.slicer.estimateSlice({ bytes, filename: path, options: { material: "pla", colors: Number(colors) } });
console.log(JSON.stringify(result, null, 2));
EOF
```

Record the exact outcome (success with grams/time/toolChanges, or the `SliceError` category and message) in `docs/superpowers/notes/2026-10-02-multicolor-slicing.md`.

- [ ] **Step 3: Decide from the evidence**

- Success **and** `toolChanges > 0` **and** grams ≈ expected 3 × (18 mm cube volume × 1.24 g/cm³ × ~15 % infill + walls) → no adapter change; skip to Step 6 and keep the test below as a regression guard.
- `-61` / `slicer_failed` / `toolChanges` 0 → continue with Step 4.

- [ ] **Step 4: Write the failing test**

```js
// tests/unit/bambu-multicolor.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { colorSlots } from "../../lib/print-estimation/adapters/bambu-cli-slicer.js";

test("colorSlots clamps the requested color count to the 1-5 slot range", () => {
  assert.equal(colorSlots({ colors: 1 }), 1);
  assert.equal(colorSlots({ colors: 3 }), 3);
  assert.equal(colorSlots({ colors: 9 }), 5);
  assert.equal(colorSlots({ colors: 0 }), 1);
  assert.equal(colorSlots({}), 1);
  assert.equal(colorSlots({ colors: "2" }), 2);
});
```

Run: `node --test tests/unit/bambu-multicolor.test.mjs` → FAIL (`colorSlots` is not exported).

- [ ] **Step 5: Implement slot-aware filament loading**

In `bambu-cli-slicer.js` add and use:

```js
export function colorSlots(options = {}) {
  const n = Math.round(Number(options.colors));
  return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 1;
}
```

and change the filament argument so every slot gets the material's filament file (a multi-color job is sliced with the same material in each slot):

```js
const slots = colorSlots(options);
const filamentArg = Array.from({ length: slots }, () => filament).join(";");
// ...
"--load-filaments", filamentArg,
```

Re-run the container slice (Step 2) with `3` as the color argument and confirm success, `toolChanges > 0`, and plausible grams. Update the note with the final numbers. If grams still read 0 or the CLI rejects the slot count, stop and escalate with the note — do not guess further.

- [ ] **Step 6: Verify and commit**

Run: `node --test tests/unit/bambu-multicolor.test.mjs && npm run test:unit` → PASS.

```bash
git add lib/print-estimation/adapters/bambu-cli-slicer.js scripts/slicer-smoke.mjs tests/unit/bambu-multicolor.test.mjs tests/fixtures/customize docs/superpowers/notes
git commit -m "fix: slot-aware filament loading for multi-color slices; slicer smoke script"
```

---

### Task 1: Vite workspace, build pipeline and CSP

**Files:**
- Create: `customizer/vite.config.js`, `customizer/index.html`, `customizer/framework/app.js` (stub that sets `document.title`), `tests/unit/customize-build.test.mjs`
- Modify: `package.json`, `.gitignore`, `vercel.json`, `scripts/dev-server.mjs`, `scripts/version-assets.mjs`, `scripts/validate.mjs`, `scripts/browser-secret-scan.mjs` (if it needs the bundle path)

**Interfaces:**
- Produces: `npm run customizer:build` writes `public/customize/**`; `npm run customizer:dev`; page URLs `/customize/` and `/customize/<id>/`; CSP helper `customizeCsp()` exported from `scripts/csp.mjs`.

- [ ] **Step 1: Failing build/CSP contract test**

```js
// tests/unit/customize-build.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const vercel = JSON.parse(await readFile(new URL("../../vercel.json", import.meta.url), "utf8"));
const cspFor = source => vercel.headers.find(r => r.source === source)?.headers.find(h => h.key === "Content-Security-Policy")?.value;

test("the global CSP rule excludes /customize and keeps the strict policy", () => {
  const global = vercel.headers.find(r => r.source.includes("customize") && r.source.startsWith("/(("))
    ?? vercel.headers.find(r => r.source === "/((?!customize/).*)");
  assert.ok(global, "global header rule must exclude customize/");
  const csp = global.headers.find(h => h.key === "Content-Security-Policy").value;
  assert.ok(!csp.includes("wasm-unsafe-eval"));
  assert.ok(!csp.includes("worker-src"));
  assert.match(csp, /font-src 'self'/);
});

test("/customize/* gets its own full policy with wasm and blob workers only", () => {
  const csp = cspFor("/customize/(.*)");
  assert.ok(csp, "customize rule needs its own CSP");
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(csp, /worker-src 'self' blob:/);
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /connect-src 'self'/);
  assert.ok(!/googleapis|gstatic|unsafe-eval'(?!.*wasm)/.test(csp));
  assert.match(csp, /frame-ancestors 'none'/);
});

test("the serverless bundle includes the isomorphic customize modules", () => {
  const include = vercel.functions["api/*.js"].includeFiles;
  assert.match(include, /public\/assets\/js\/customize\/\*\*/);
});
```

Run: `node --test tests/unit/customize-build.test.mjs` → FAIL.

- [ ] **Step 2: Share one CSP definition**

Create `scripts/csp.mjs` exporting `baseCsp` (the current policy string, with the inline JSON-LD hash kept) and `customizeCsp = baseCsp` variant. Concretely, take today's value from `vercel.json` and derive:

```js
export const GLOBAL_CSP = "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'sha256-sr6+xICxiVC0kIkhYHH6w1wxMXikqOJO+XVSc0tW08Y='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://*.supabase.co https://vercel.com/api/blob/; upgrade-insecure-requests";
export const CUSTOMIZE_CSP = "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; upgrade-insecure-requests";
```

(If the site's current policy string has changed since this plan, copy the current value for `GLOBAL_CSP` and add only the two directives to `CUSTOMIZE_CSP`; the customize policy deliberately omits the home-page JSON-LD hash and the Supabase/Blob origins.)

- [ ] **Step 3: Split the `vercel.json` header rules**

Change the first `headers` entry's `source` from `"/(.*)"` to `"/((?!customize/).*)"` and add a second entry for `"/customize/(.*)"` carrying the same non-CSP headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP, CORP, HSTS) plus `Content-Security-Policy` = `CUSTOMIZE_CSP`. Add `public/assets/js/customize/**` to `functions["api/*.js"].includeFiles` (it currently lists only print-estimation; make it a comma-free glob list per Vercel's syntax: `"{public/assets/js/print-estimation/**,public/assets/js/customize/**}"`). Add `/customize/assets/(.*)` a long-cache rule (`public, max-age=31536000, immutable`; Vite hashes these).

Add a unit assertion in the same test file that `scripts/csp.mjs` constants equal the values in `vercel.json` (read both and compare) so they cannot drift.

- [ ] **Step 4: Vite workspace**

`customizer/vite.config.js`:

```js
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { readdirSync, existsSync } from "node:fs";

const here = fileURLToPath(new URL(".", import.meta.url));
const generatorPages = existsSync(`${here}g`) ? readdirSync(`${here}g`).map(id => [`g-${id}`, `${here}g/${id}/index.html`]) : [];

export default defineConfig({
  root: here,
  base: "/customize/",
  publicDir: `${here}static`,
  build: {
    outDir: fileURLToPath(new URL("../public/customize", import.meta.url)),
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: { input: Object.fromEntries([["index", `${here}index.html`], ...generatorPages]) }
  },
  worker: { format: "es" },
  plugins: [{
    // Site CSS/JS live outside the bundle; reference them unbundled and in place.
    name: "site-shell",
    enforce: "post",
    transformIndexHtml: html => html
  }]
});
```

HTML pages link the shared site shell with plain absolute references that Vite leaves alone (`<link rel="stylesheet" href="/assets/css/site.css">`, `<script type="module" src="/assets/js/site.js"></script>`). If Vite errors on the absolute module script, change the shell reference to a tag injected in `transformIndexHtml` (return `[{ tag: "script", attrs: { type: "module", src: "/assets/js/site.js" }, injectTo: "body" }]`).

`package.json` changes: add `"vite": "8.3.2"`, `"manifold-3d": "3.5.4"`, `"opentype.js": "2.0.0"`, `"qrcode-generator": "2.0.4"`, `"fflate": "0.8.3"`, `"three": "0.170.0"` to `devDependencies` (browser bundle inputs only; none are imported by `api/`/`lib/`). Scripts:

```json
"customizer:build": "vite build --config customizer/vite.config.js",
"customizer:dev": "vite --config customizer/vite.config.js",
"vercel-build": "npm run customizer:build && npm run assets:version && npm run validate",
"test": "npm run customizer:build && npm run validate && npm run test:unit && npm run test:e2e && npm run audit"
```

`.gitignore`: add `public/customize/`.

- [ ] **Step 5: Teach the scripts about the bundle**

- `scripts/version-assets.mjs`: in `walk`, when the directory is `public/customize`, only collect `.html` files (Vite's JS/CSS carry their own content hashes and use relative chunk imports that must not gain `?v=`).
- `scripts/dev-server.mjs`: in `securityHeaders(res, url)` set `Content-Security-Policy` — `CUSTOMIZE_CSP` for paths starting `/customize/`, `GLOBAL_CSP` otherwise — so E2E sees the real policy. (`Permissions-Policy`: keep identical to production's value.)
- `scripts/validate.mjs`: add `customize/index.html` to a post-build required list (`requiredBuilt`), and make the existing "local reference" check treat `/customize/assets/*` as normal public files (no change expected once the bundle exists; verify).
- `scripts/browser-secret-scan.mjs`: confirm it scans `public/` recursively (it must cover `public/customize`); add a test assertion in `customize-build.test.mjs` only if it uses an include list.

- [ ] **Step 6: Verify on Node 22 and commit**

```bash
node --version            # must be v22.x
npm install
npm run customizer:build  # expect public/customize/index.html + hashed assets, no errors
node --test tests/unit/customize-build.test.mjs && npm run validate
```

Expected: build succeeds on Node 22; tests PASS. If Vite 8 refuses Node 22, pin the newest Vite that supports `engines.node 22.x` and record why in `docs/GENERATORS.md` (created in Task 10; note it in the commit body now).

```bash
git add -A && git commit -m "build: Vite customizer workspace, split CSP for /customize, bundle-aware asset scripts"
```

---

### Task 2: Isomorphic schema runtime

**Files:**
- Create: `public/assets/js/customize/schema.js`, `tests/unit/customize-schema.test.mjs`

**Interfaces:**
- Produces:
  - `validateParams(generator, input, { skipSensitive = false }) -> { ok: boolean, errors: string[], value: object }`
  - `clampParams(generator, params, changedKey) -> object`
  - `redactSensitive(generator, params) -> object` (sensitive fields become `"[redacted]"`)
  - `sensitiveKeys(generator) -> string[]`
  - Generator definition shape (used by every generator task): `{ id, version, title, blurb, category, origin, rights: { publishable: boolean, note }, schema: { [key]: FieldDef }, rules?: (params) => { limits?: { [key]: [lo, hi] }, errors?: string[] }, presets?: { [name]: Partial<params> } }`
  - `FieldDef`: `{ type: "number", label, min, max, step, default, unit? }`, `{ type: "int", ... }`, `{ type: "enum", label, options: [{ value, label }], default }`, `{ type: "bool", label, default }`, `{ type: "text", label, max, default, multiline?, sensitive?, optional? }`, `{ type: "color", label, default }`

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/customize-schema.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { clampParams, redactSensitive, sensitiveKeys, validateParams } from "../../public/assets/js/customize/schema.js";

const gen = {
  id: "t", version: 1,
  schema: {
    width: { type: "number", label: "W", min: 10, max: 100, step: 0.5, default: 50 },
    count: { type: "int", label: "N", min: 1, max: 5, default: 2 },
    mode: { type: "enum", label: "M", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "a" },
    on: { type: "bool", label: "On", default: false },
    name: { type: "text", label: "Name", max: 12, default: "Hi" },
    secret: { type: "text", label: "Pw", max: 20, default: "", sensitive: true, optional: true },
    color: { type: "color", label: "C", default: "#112233" }
  },
  rules: p => ({ errors: p.width > 90 && p.count > 3 ? ["Too wide for that many."] : [] })
};

test("defaults fill missing fields", () => {
  const r = validateParams(gen, {});
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { width: 50, count: 2, mode: "a", on: false, name: "Hi", secret: "", color: "#112233" });
});

test("rejects unknown keys, bad enums, out-of-range numbers and bad colors", () => {
  const r = validateParams(gen, { width: 5, mode: "z", color: "red", extra: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 4);
});

test("text is trimmed, bounded, and control characters are rejected", () => {
  assert.equal(validateParams(gen, { name: "x".repeat(13) }).ok, false);
  assert.equal(validateParams(gen, { name: "a\u0000b" }).ok, false);
  assert.equal(validateParams(gen, { name: "  Hi  " }).value.name, "Hi");
  assert.equal(validateParams(gen, { name: "日本語 🚽" }).ok, true);
  assert.equal(validateParams(gen, { name: "   " }).ok, false);   // required text may not be blank
});

test("numbers must be finite and respect step", () => {
  assert.equal(validateParams(gen, { width: NaN }).ok, false);
  assert.equal(validateParams(gen, { width: "50" }).ok, false);   // no string coercion server-side
  assert.equal(validateParams(gen, { width: 50.3 }).ok, false);
});

test("cross-field rules run after field checks", () => {
  assert.deepEqual(validateParams(gen, { width: 95, count: 4 }).errors, ["Too wide for that many."]);
});

test("sensitive fields are listed, redacted, and skippable on the server", () => {
  assert.deepEqual(sensitiveKeys(gen), ["secret"]);
  assert.equal(redactSensitive(gen, { secret: "hunter2", name: "x" }).secret, "[redacted]");
  assert.equal(redactSensitive(gen, { name: "x" }).secret, undefined);
  const r = validateParams(gen, { secret: "[redacted]" }, { skipSensitive: true });
  assert.equal(r.ok, true);
});

test("clampParams pulls values into range using rule limits", () => {
  const g = { ...gen, rules: p => ({ limits: { width: [10, p.count * 10] } }) };
  assert.equal(clampParams(g, { width: 90, count: 3 }, "count").width, 30);
});
```

Run: `node --test tests/unit/customize-schema.test.mjs` → FAIL (module missing).

- [ ] **Step 2: Implement `schema.js`**

```js
// Parameter schema runtime shared by the browser (form + clamping) and the server (re-validation).
const REDACTED = "[redacted]";
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const EPS = 1e-9;

export const sensitiveKeys = generator => Object.entries(generator.schema).filter(([, d]) => d.sensitive).map(([k]) => k);

const onStep = (v, def) => {
  if (!def.step) return true;
  const base = def.min ?? 0;
  const n = (v - base) / def.step;
  return Math.abs(n - Math.round(n)) < 1e-6;
};

function checkField(key, def, raw) {
  const label = def.label ?? key;
  switch (def.type) {
    case "number": case "int": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return { error: `${label} must be a number.` };
      if (def.type === "int" && !Number.isInteger(raw)) return { error: `${label} must be a whole number.` };
      if (raw < def.min - EPS || raw > def.max + EPS) return { error: `${label} must be ${def.min}–${def.max}${def.unit ? ` ${def.unit}` : ""}.` };
      if (!onStep(raw, def)) return { error: `${label} must move in steps of ${def.step}.` };
      return { value: raw };
    }
    case "enum": return def.options.some(o => o.value === raw) ? { value: raw } : { error: `${label} has an unsupported value.` };
    case "bool": return typeof raw === "boolean" ? { value: raw } : { error: `${label} must be on or off.` };
    case "color": return typeof raw === "string" && COLOR.test(raw) ? { value: raw.toLowerCase() } : { error: `${label} must be a #rrggbb color.` };
    case "text": {
      if (typeof raw !== "string") return { error: `${label} must be text.` };
      if (CONTROL.test(raw)) return { error: `${label} contains unsupported characters.` };
      const value = def.multiline ? raw.replace(/\r\n/g, "\n").split("\n").map(s => s.trim()).join("\n").trim() : raw.trim();
      if ([...value].length > def.max) return { error: `${label} must be at most ${def.max} characters.` };
      if (!value && !def.optional) return { error: `${label} is required.` };
      return { value };
    }
    default: return { error: `${label} has an unknown field type.` };
  }
}

export function validateParams(generator, input, { skipSensitive = false } = {}) {
  const errors = [];
  const value = {};
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  for (const key of Object.keys(source)) if (!(key in generator.schema)) errors.push(`Unknown parameter "${String(key).slice(0, 40)}".`);
  for (const [key, def] of Object.entries(generator.schema)) {
    if (def.sensitive && skipSensitive) { value[key] = REDACTED; continue; }
    const raw = key in source ? source[key] : def.default;
    const result = checkField(key, def, raw);
    if (result.error) errors.push(result.error); else value[key] = result.value;
  }
  if (!errors.length && generator.rules) errors.push(...(generator.rules(value).errors ?? []));
  return { ok: errors.length === 0, errors, value };
}

export function redactSensitive(generator, params) {
  const out = { ...params };
  for (const key of sensitiveKeys(generator)) if (key in out) out[key] = REDACTED;
  return out;
}

const round = (v, step) => step ? Math.round(v / step) * step : v;

// Pull every numeric value into its (possibly rule-dependent) range; the just-changed key wins.
export function clampParams(generator, params, changedKey) {
  const out = { ...params };
  const limits = generator.rules?.(out).limits ?? {};
  for (const [key, def] of Object.entries(generator.schema)) {
    if (def.type !== "number" && def.type !== "int") continue;
    const [lo, hi] = limits[key] ?? [def.min, def.max];
    if (key === changedKey) { out[key] = Math.min(hi, Math.max(lo, out[key])); continue; }
    out[key] = Math.min(hi, Math.max(lo, out[key]));
  }
  for (const [key, def] of Object.entries(generator.schema)) {
    if ((def.type === "number" || def.type === "int") && def.step) out[key] = Number(round(out[key], def.step).toFixed(6));
  }
  return out;
}
```

- [ ] **Step 3: Run tests, version assets, commit**

Run: `node --test tests/unit/customize-schema.test.mjs` → PASS (note the `{width: 50.3}` step test: with `min 10, step 0.5`, 50.3 is off-step → rejected). Then `npm run assets:version && npm run test:unit`.

```bash
git add -A && git commit -m "feat: isomorphic generator schema runtime"
```

---

### Task 3: Framework core — engine, text, QR, shapes, model assembly

**Files:**
- Create: `customizer/framework/{engine,model,text,qr,shapes}.js`; port `three-mf.js`, `bambu-template.js` unchanged; `tests/unit/customize-framework.test.mjs`
- Port from prototype: `src/three-mf.js` → `customizer/framework/three-mf.js`, `src/bambu-template.js` → `customizer/framework/bambu-template.js` (copy files; only change relative imports)

**Interfaces:**
- Produces:
  - `loadEngine(locateFile?) -> Promise<wasm>` (`wasm.CrossSection`, `wasm.Manifold` set up; in Node no `locateFile` needed)
  - `blockText(CrossSection, text)`, `fontText(CrossSection, font, text)`, `fitCrossSection(cs, { maxWidth, maxHeight, centerX, centerY })` (ported as-is from the prototype `text.js`)
  - `qrCrossSection(CrossSection, data, size) -> { cs, module, modules }` (ported; throws "QR payload is too dense…" below 0.82 mm/module)
  - shapes: `roundedRect(CrossSection, w, h, r) -> CrossSection`, `star(CrossSection, outerR, points=5, innerRatio=0.4) -> CrossSection`, `partialStar(CrossSection, outerR, fraction) -> CrossSection` (left-to-right clip, `fraction` 0..1), `ring(CrossSection, outerR, innerR)`, `keyLoop(CrossSection, { outerR, holeR, cx, cy })`
  - `buildModel(generator, params, { wasm, font }) -> Promise<{ data: Uint8Array, parts, filename, warnings, metrics }>` — calls `generator.build(params, ctx)` which returns `{ solids: [{ name, solid, color }], warnings?: string[], title, filenameBase }`; shifts all solids to positive XY (+2 mm margin), meshes, frees WASM objects, writes the 3MF via `package3mf`.

- [ ] **Step 1: Copy ported modules and write failing tests**

```bash
mkdir -p customizer/framework && cd customizer/framework
for f in three-mf bambu-template text viewer3d; do cp ../../../model-customizer-pages/src/$f.js ./$f.js; done
```

`text.js` exports: rename `openTypeTextCrossSection` → `fontText`, `blockTextCrossSection` → `blockText` (update the exports; keep `fitCrossSection`). Extract the prototype's `qrCrossSection` verbatim into `qr.js` (add `export`), and `manifoldToMesh` plus `safeName` into `model.js`.

```js
// tests/unit/customize-framework.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { loadEngine } from "../../customizer/framework/engine.js";
import { blockText, fitCrossSection } from "../../customizer/framework/text.js";
import { qrCrossSection } from "../../customizer/framework/qr.js";
import { roundedRect, star, partialStar, ring, keyLoop } from "../../customizer/framework/shapes.js";
import { buildModel } from "../../customizer/framework/model.js";
import { analyzeModelBytes } from "../../public/assets/js/print-estimation/geometry.js";
import { inflateRawSync } from "node:zlib";

const wasm = await loadEngine();
const { CrossSection } = wasm;
const area = cs => cs.area();

test("shapes have sensible area", () => {
  assert.ok(Math.abs(area(roundedRect(CrossSection, 20, 10, 0)) - 200) < 1e-6);
  assert.ok(area(roundedRect(CrossSection, 20, 10, 3)) < 200);
  assert.ok(area(star(CrossSection, 10)) > 0);
  const full = area(partialStar(CrossSection, 10, 1)), half = area(partialStar(CrossSection, 10, 0.5));
  assert.ok(Math.abs(full - area(star(CrossSection, 10))) < 1e-6);
  assert.ok(half > full * 0.35 && half < full * 0.65);
  assert.ok(Math.abs(area(ring(CrossSection, 5, 3)) - Math.PI * (25 - 9)) < 0.5);
  assert.ok(area(keyLoop(CrossSection, { outerR: 5, holeR: 2.5, cx: 0, cy: 0 })) > 0);
});

test("QR cross-section reports module size and rejects dense payloads", () => {
  const q = qrCrossSection(CrossSection, "WIFI:T:WPA;S:Cafe;P:hunter22;;", 40);
  assert.ok(q.module >= 0.82 && q.modules >= 21 && !q.cs.isEmpty());
  assert.throws(() => qrCrossSection(CrossSection, "x".repeat(400), 20), /too dense/);
});

test("block text fits a box without distortion", () => {
  const fitted = fitCrossSection(blockText(CrossSection, "HELLO"), { maxWidth: 30, maxHeight: 6 });
  const b = fitted.bounds();
  assert.ok(b.max[0] - b.min[0] <= 30 + 1e-6 && b.max[1] - b.min[1] <= 6 + 1e-6);
});

test("buildModel produces a 3MF the site's own analyzer accepts, in positive XY", async () => {
  const gen = {
    id: "slab",
    build: (p, { wasm }) => ({
      title: "slab", filenameBase: "slab",
      solids: [
        { name: "base", color: "#ffffff", solid: wasm.Manifold.cube([20, 10, 2]) },
        { name: "top", color: "#ff0000", solid: wasm.Manifold.cube([10, 5, 1]).translate([5, 2.5, 2]) }
      ]
    })
  };
  const out = await buildModel(gen, {}, { wasm, font: null });
  assert.equal(out.parts.length, 2);
  assert.match(out.filename, /^slab.*\.3mf$/);
  const analysis = await analyzeModelBytes({ name: out.filename, bytes: out.data, inflateRaw: async (b, max) => new Uint8Array(inflateRawSync(b, { maxOutputLength: max })) });
  assert.ok(Math.abs(analysis.volumeMm3 - (20 * 10 * 2 + 10 * 5 * 1)) < 1);
  assert.equal(out.metrics.unique_colors, 2);
});
```

Run: `node --test tests/unit/customize-framework.test.mjs` → FAIL.

- [ ] **Step 2: Implement `engine.js`**

```js
import Module from "manifold-3d";

let pending;
// Browser: pass a locateFile that returns the hashed wasm URL. Node: no argument needed.
export function loadEngine(locateFile) {
  if (!pending) {
    pending = Module(locateFile ? { locateFile } : {}).then(wasm => { wasm.setup(); return wasm; });
  }
  return pending;
}
```

- [ ] **Step 3: Implement `shapes.js`**

```js
const TAU = Math.PI * 2;

export function roundedRect(CrossSection, w, h, r = 0) {
  const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3);
  if (rr <= 0) return CrossSection.square([w, h], true);
  const inner = CrossSection.square([w - 2 * rr, h - 2 * rr], true);
  return inner.offset(rr, "Round", 2, 12);
}

export function star(CrossSection, outerR, points = 5, innerRatio = 0.4) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : outerR * innerRatio;
    const a = Math.PI / 2 + (i * Math.PI) / points;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return CrossSection.ofPolygons([pts]);
}

// A star clipped to the left `fraction` of its width (0..1) — for half-star ratings.
export function partialStar(CrossSection, outerR, fraction) {
  const full = star(CrossSection, outerR);
  if (fraction >= 1) return full;
  if (fraction <= 0) return new CrossSection([]);
  const b = full.bounds();
  const x = b.min[0] + (b.max[0] - b.min[0]) * fraction;
  const keep = CrossSection.square([x - b.min[0] + 1e-6, b.max[1] - b.min[1] + 2], false).translate([b.min[0], b.min[1] - 1]);
  return full.intersect(keep);
}

export function circle(CrossSection, r, segments = 48) { return CrossSection.circle(r, segments); }
export function ring(CrossSection, outerR, innerR, segments = 48) { return circle(CrossSection, outerR, segments).subtract(circle(CrossSection, innerR, segments)); }
export function keyLoop(CrossSection, { outerR, holeR, cx, cy }) {
  return ring(CrossSection, outerR, holeR).translate([cx, cy]);
}
```

(`CrossSection.square(size, center)` / `circle(radius, segments)` / `offset(delta, joinType, miterLimit, circularSegments)` are the Manifold 3.5 API; if a signature differs, the Step 4 test run shows the error — fix the call, not the test.)

- [ ] **Step 4: Implement `model.js`**

```js
import { package3mf } from "./three-mf.js";

export function manifoldToMesh(manifold) {
  const mesh = manifold.getMesh();
  const vertices = new Array(mesh.numVert);
  for (let i = 0; i < mesh.numVert; i++) { const j = i * mesh.numProp; vertices[i] = [mesh.vertProperties[j], mesh.vertProperties[j + 1], mesh.vertProperties[j + 2]]; }
  const triangles = new Array(mesh.triVerts.length / 3);
  for (let i = 0, t = 0; i < mesh.triVerts.length; i += 3, t++) triangles[t] = [mesh.triVerts[i], mesh.triVerts[i + 1], mesh.triVerts[i + 2]];
  mesh.delete?.();
  return { vertices, triangles };
}

export const safeName = s => String(s || "custom").trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "custom";

export async function buildModel(generator, params, { wasm, font = null }) {
  const built = await generator.build(params, { wasm, font });
  const { solids, warnings = [], title = generator.title ?? generator.id, filenameBase = generator.id } = built;
  if (!solids.length) throw new Error("The model has no geometry.");
  let minX = Infinity, minY = Infinity;
  for (const s of solids) { const b = s.solid.boundingBox(); minX = Math.min(minX, b.min[0]); minY = Math.min(minY, b.min[1]); }
  const delta = [-minX + 2, -minY + 2, 0];
  const parts = solids.map(s => {
    const shifted = s.solid.translate(delta);
    const mesh = manifoldToMesh(shifted);
    shifted.delete?.();
    return { name: s.name, color: s.color, mesh };
  });
  for (const s of solids) s.solid.delete?.();
  const colors = new Set(parts.map(p => String(p.color).toLowerCase()));
  if (colors.size > 5) throw new Error(`The model uses ${colors.size} colors; at most 5 are supported.`);
  const parameters = { ...params, template: `${generator.id}-v${generator.version ?? 1}`, generator: "browser/manifold-3d" };
  const data = package3mf(parts, { title, description: "Parametrically generated in-browser by 3dprint4.me.", parameters });
  return {
    data, parts, warnings,
    filename: `${filenameBase}.3mf`,
    metrics: { part_count: parts.length, unique_colors: colors.size, triangles: parts.reduce((n, p) => n + p.mesh.triangles.length, 0) }
  };
}
```

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/unit/customize-framework.test.mjs && npm run customizer:build` → PASS / builds.

```bash
git add -A && git commit -m "feat: customizer framework core (engine, text, QR, shapes, 3MF assembly)"
```

---

### Task 4: Route shield generator (port) and schema registry

**Files:**
- Create: `public/assets/js/customize/generators/route-shield.js`, `public/assets/js/customize/registry.js`, `customizer/generators/route-shield/build.js`, `customizer/generators/route-shield/template.js` (copy of prototype `template.js`), `tests/unit/customize-route-shield.test.mjs`
- Port from: prototype `limits.js` → schema/rules; `generator.js` (`buildLayout`, `fitFront`, `fitBack`, `generateModel` body) → `build.js`

**Interfaces:**
- Consumes: Task 2 schema shape; Task 3 `qrCrossSection`, `blockText`, `fontText`, `fitCrossSection`.
- Produces: `GENERATORS` object and `getGenerator(id)` from `registry.js` (`undefined` for unknown ids); `route-shield` params (all prototype options): `top_text, lower_text, back_text, qr_enabled, qr_data, width_mm, height_mm, base_thickness_mm, inlay_depth_mm, field_height_mm, text_height_mm, base_color, upper_color, lower_color, text_color, back_color, top_scale_pct, top_offset_mm, lower_scale_pct, lower_offset_mm, back_scale_pct, back_offset_mm, font_mode ("block"|"font")`. Registry also exposes `generatorBuilders` in the browser (`customizer/generators/index.js`, Step 4) mapping id → `build`.

- [ ] **Step 1: Golden test against the prototype's known-good output**

```js
// tests/unit/customize-route-shield.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import { loadEngine } from "../../customizer/framework/engine.js";
import { buildModel } from "../../customizer/framework/model.js";
import { analyzeModelBytes } from "../../public/assets/js/print-estimation/geometry.js";
import { getGenerator } from "../../public/assets/js/customize/registry.js";
import { validateParams } from "../../public/assets/js/customize/schema.js";
import build from "../../customizer/generators/route-shield/build.js";

const wasm = await loadEngine();
const gen = { ...getGenerator("route-shield"), build };
const inflateRaw = async (b, max) => new Uint8Array(inflateRawSync(b, { maxOutputLength: max }));

test("default parameters validate and build a valid multi-part 3MF", async () => {
  const { ok, errors, value } = validateParams(gen, {});
  assert.ok(ok, errors.join("; "));
  const out = await buildModel(gen, value, { wasm, font: null });
  assert.ok(out.parts.length >= 5);
  const a = await analyzeModelBytes({ name: out.filename, bytes: out.data, inflateRaw });
  assert.ok(a.volumeMm3 > 15000 && a.volumeMm3 < 40000, `volume ${a.volumeMm3}`);
  assert.deepEqual(a.warnings.filter(w => w !== "embedded_settings_ignored"), []);
});

test("volume matches the prototype's reference sample within 2 percent", async () => {
  // samples/route-shield-core-fixed.3mf from the prototype measures 26,990 mm3 at default parameters.
  const { value } = validateParams(gen, { top_text: "ROUTE", lower_text: "66" });
  const out = await buildModel(gen, value, { wasm, font: null });
  const a = await analyzeModelBytes({ name: out.filename, bytes: out.data, inflateRaw });
  assert.ok(Math.abs(a.volumeMm3 - 26990) / 26990 < 0.02, `volume ${a.volumeMm3}`);
});

test("QR too dense for the badge fails with a readable error, never a thin code", async () => {
  const { value } = validateParams(gen, { qr_enabled: true, qr_data: "https://example.com/" + "a".repeat(180) });
  await assert.rejects(() => buildModel(gen, value, { wasm, font: null }), /too dense/);
});

test("rules reject geometry the prototype rejected", () => {
  assert.equal(validateParams(gen, { base_thickness_mm: 2.4, field_height_mm: -4 }).ok, false);
  assert.equal(validateParams(gen, { qr_enabled: true, qr_data: "" }).ok, false);
});

test("long text shrinks to fit or raises a readable error, never clips", async () => {
  const { value } = validateParams(gen, { top_text: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", top_scale_pct: 150 });
  await assert.rejects(() => buildModel(gen, value, { wasm, font: null }), /doesn't fit/);
});
```

Run: FAIL (modules missing). Confirm the 26,990 figure by running `node p-tmp.mjs`-style analysis on `samples/route-shield-core-fixed.3mf` once (documented earlier: `volumeMm3: 26990.044`); if the default-parameter volume of the ported generator differs by more than 2 %, find the divergence before proceeding (it means the port changed geometry).

- [ ] **Step 2: Schema, rules and presets (`public/assets/js/customize/generators/route-shield.js`)**

Port the constants and `computeLimits`/`validateOptions`/`clampOptions` logic from the prototype's `limits.js`, expressing fields as schema entries (`defaults`: `top_text "ROUTE"`, `lower_text "66"`, `width_mm 52`, `height_mm 58`, `base_thickness_mm 4`, `inlay_depth_mm 1.2`, `field_height_mm 0.8`, `text_height_mm 0.6`, `qr_enabled false`, `qr_data "https://3dprint4.me"`, colors from the prototype's `index.html` defaults, scale/offset fields 100 / 0). The `rules(params)` function returns `{ limits, errors }` where `limits` is the prototype's `computeLimits(params)` and `errors` is its `validateOptions(params)` (reuse the prototype function bodies verbatim, adapting the key names; they already return the messages the tests expect) plus `"QR content is required when QR is enabled."`.

```js
export default {
  id: "route-shield", version: 1, title: "Route shield", blurb: "Highway-style badge with two color fields, front text and an optional back QR code.",
  category: "badges", origin: "house", rights: { publishable: true, note: "House design." },
  schema: { /* every field above with label/min/max/step/default exactly as in the prototype */ },
  rules, presets: { default: {}, "small-66": { width_mm: 40, height_mm: 44 } }
};
```

Write the full `schema` object (no abbreviations): each of the 24 parameters listed under Interfaces with the prototype's range (`WIDTH_RANGE`, `HEIGHT_RANGE`, `BASE_RANGE`, `STEP`, `SCALE_RANGE`, `OFFSET_RANGE`, `MAX_INLAY`, `MAX_FIELD`, `MAX_TEXT`).

- [ ] **Step 3: Registry**

```js
// public/assets/js/customize/registry.js
import routeShield from "./generators/route-shield.js";
// Later tasks add: wifiTag, ratingCard, namePlate.
export const GENERATORS = Object.freeze({ [routeShield.id]: routeShield });
export const getGenerator = id => Object.prototype.hasOwnProperty.call(GENERATORS, id) ? GENERATORS[id] : undefined;
export const listPublicGenerators = () => Object.values(GENERATORS).filter(g => g.rights.publishable);
```

- [ ] **Step 4: Port the geometry (`customizer/generators/route-shield/build.js`)**

Move `buildLayout`, `fitFront`, `fitBack`, `textFits`, layout constants, and the solid-construction half of `generateModel` (everything up to and including the `solids` array and the `Back inlays` push) from the prototype. Differences from the prototype:

1. `export default async function build(params, { wasm, font })` returns `{ solids, warnings, title: "Route shield - ...", filenameBase: \`route-shield-${safeName(top)}-${safeName(lower)}\` }`.
2. Remove the 3MF writing, positive-XY shift and mesh conversion — `buildModel` does those.
3. Text uses `params.font_mode === "block" ? blockText : fontText(…, font, …)`.
4. Throw `new Error(...)` with the prototype's exact messages (`"…doesn't fit at this size/position…"`).

Add `customizer/generators/index.js`:

```js
export const loadBuilder = {
  "route-shield": () => import("./route-shield/build.js")
};
```

(each later generator adds one line; dynamic imports keep per-generator code split).

- [ ] **Step 5: Run tests, build, commit**

Run: `node --test tests/unit/customize-route-shield.test.mjs && npm run customizer:build && npm run assets:version`. Expected: PASS; if the volume-regression test fails, diff the part list against the prototype before editing the test.

```bash
git add -A && git commit -m "feat: route-shield generator ported to the framework with golden checks"
```

---

### Task 5: Customize pages (catalog, generator UI, worker, preview, local facts)

**Files:**
- Create: `customizer/index.html`, `customizer/g/route-shield/index.html`, `customizer/framework/{app,catalog,form,worker,worker-client,fonts}.js`, `customizer/framework/viewer3d.js` (ported in Task 3), `customizer/styles.css`, `customizer/static/fonts/` (empty until Task 9), `tests/unit/customize-form.test.mjs`, `tests/e2e/test_customize.py`
- Modify: `public/assets/js/site.js` (nav item `["Customize", "/customize/"]`), `public/index.html` (home link/section), `public/sitemap.xml`, `public/assets/css/site.css` (only if a shared token is missing — prefer `customizer/styles.css` using site tokens)

**Interfaces:**
- Consumes: `registry.js`, `schema.js`, `buildModel`, `loadEngine`.
- Produces: `renderForm(container, generator, params, { onChange, limits }) -> { setValues, destroy }`; `createWorkerClient() -> { build(generatorId, params, fontId?) -> Promise<{ data, parts, filename, warnings, metrics }>, terminate() }`; page state `{ generator, params, result, status }` with statuses `idle | building | ready | error`.

- [ ] **Step 1: Failing test for the schema-driven form (jsdom-free: render to a string)**

`renderFormHtml(generator, params) -> string` is a pure function used by `renderForm`; test it:

```js
// tests/unit/customize-form.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { renderFormHtml } from "../../customizer/framework/form.js";
import { getGenerator } from "../../public/assets/js/customize/registry.js";
import { validateParams } from "../../public/assets/js/customize/schema.js";

const gen = getGenerator("route-shield");
const html = renderFormHtml(gen, validateParams(gen, {}).value);

test("every schema field gets a labelled control", () => {
  for (const [key, def] of Object.entries(gen.schema)) {
    assert.ok(html.includes(`name="${key}"`), `missing control for ${key}`);
    assert.ok(html.includes(def.label), `missing label ${def.label}`);
  }
});

test("range fields expose min, max and step; text fields expose maxlength", () => {
  assert.match(html, /name="width_mm"[^>]*min="50"[^>]*max="250"/);
  assert.match(html, /name="top_text"[^>]*maxlength="/);
});

test("user-supplied defaults are HTML-escaped", () => {
  const evil = renderFormHtml(gen, { ...validateParams(gen, {}).value, top_text: '"><img src=x onerror=alert(1)>' });
  assert.ok(!evil.includes("<img"));
});

test("sensitive text fields are password-style, non-autofilled and labelled as stored only in the model", () => {
  const wifi = { schema: { pw: { type: "text", label: "Password", max: 20, default: "", sensitive: true, optional: true } } };
  const out = renderFormHtml(wifi, { pw: "" });
  assert.match(out, /type="password"/);
  assert.match(out, /autocomplete="off"/);
  assert.match(out, /only inside the model file/i);
});
```

Run → FAIL.

- [ ] **Step 2: Implement `form.js`**

`renderFormHtml` returns markup per field type using `<label for>` + `<input>`/`<select>`/`<textarea>`; numbers render `type="range"` plus a paired `type="number"` (both `name`-less except the number input carries `name`; the range carries `data-for`), enums render a `<select>`, bools a checkbox, colors `<input type="color">`, text `maxlength`, sensitive text `type="password" autocomplete="off"` with the note "This is stored only inside the model file you send us — never on our servers or in your saved draft." Escape every interpolated value with a local `esc()` (`& < > " '`). `renderForm` wires `input` events (debounced 150 ms) to `onChange(key, value)`, applies `clampParams` limits to the `min`/`max` attributes after each change via `generator.rules(params).limits`, and exposes inline error text from `validateParams`.

- [ ] **Step 3: Worker and client**

```js
// customizer/framework/worker.js
import { loadEngine } from "./engine.js";
import wasmUrl from "manifold-3d/manifold.wasm?url";
import { buildModel } from "./model.js";
import { getGenerator } from "../../public/assets/js/customize/registry.js";
import { loadBuilder } from "../generators/index.js";
import { loadFont } from "./fonts.js";

self.onmessage = async ({ data: { id, generatorId, params, fontId, fontBytes } }) => {
  try {
    const def = getGenerator(generatorId);
    if (!def || !loadBuilder[generatorId]) throw new Error("Unknown generator.");
    const wasm = await loadEngine(() => wasmUrl);
    const { default: build } = await loadBuilder[generatorId]();
    const font = await loadFont({ fontId, fontBytes });
    const out = await buildModel({ ...def, build }, params, { wasm, font });
    self.postMessage({ id, ok: true, result: out }, [out.data.buffer]);
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.message ?? error).slice(0, 300) });
  }
};
```

`worker-client.js` wraps it: one worker, monotonically increasing request ids, **latest-wins** (a newer `build` call supersedes older results by id), a 30 s timeout that terminates and recreates the worker, and rejects with `Error(message)`. `fonts.js` exports `loadFont({ fontId, fontBytes })`: `fontId` in the curated list fetches `/customize/fonts/<file>` (same-origin), parses with `opentype.js`, caches by id; `fontBytes` (customer file) is parsed directly; neither → `null`.

- [ ] **Step 4: Pages**

`customizer/index.html` — catalog grid (rendered by `catalog.js` from `listPublicGenerators()`): card per generator with title, blurb, category, link to `/customize/g/<id>/`. Generator page `customizer/g/<id>/index.html` — shared site header/footer shell (copy the structure from `public/services.html`: skip-link, `<header>`, `<main id="main">`, footer), title `"<Generator title> | Customize | 3dprint4.me"`, `<meta name="description">`, `<link rel="canonical">`, `<meta name="robots" content="index,follow">`; a two-column layout (preview left, controls right on ≥ 900 px; stacked on mobile) with Front/Back/3D preview tabs (ported `viewer3d.js` for 3D; the 2D view reuses the 3D viewer's top-down orthographic camera to keep one renderer), a "Local facts" panel (dimensions, volume, rough weight/time from `analyzeModelBytes` on the built 3MF — **no network**), a color-count badge ("3 colors"), warnings list, and **Continue to request** (disabled until a model builds without errors). All text copy is plain and honest ("Planning figures only; we confirm before printing.").

`app.js`: reads `<meta name="generator-id">`, loads the schema, restores last params from `sessionStorage` (try/catch; sensitive fields excluded), renders the form, runs `worker-client.build` on every change (latest-wins), shows `building…` / error text in an `aria-live="polite"` region, and renders the preview.

- [ ] **Step 5: Site integration**

- `public/assets/js/site.js`: add `["Customize", "/customize/"]` to `navItems` (before "About"); the active-state logic uses `currentFile()` — extend it so `/customize/…` marks the Customize item active.
- `public/index.html`: add a short "Customize a model" section linking to `/customize/` using existing section/card classes; if inline JSON-LD changes, run `npm run validate` and update the CSP hash as the guide says.
- `public/sitemap.xml`: add `/customize/` and each public generator URL (a build-time generated list is unnecessary — add the entries by hand per generator task, and extend `scripts/validate.mjs` with a check that every `listPublicGenerators()` id appears in the sitemap).
- Remember the Vite pages are static HTML and **must not** include inline scripts (CSP has no hash for them).

- [ ] **Step 6: E2E (Playwright, existing harness) and checks**

```python
# tests/e2e/test_customize.py
import re
from playwright.sync_api import expect

def test_catalog_lists_route_shield(page, base_url):
    page.goto(f"{base_url}/customize/")
    expect(page.get_by_role("link", name=re.compile("Route shield"))).to_be_visible()

def test_route_shield_builds_and_enables_continue(page, base_url):
    page.goto(f"{base_url}/customize/g/route-shield/")
    page.get_by_label("Upper text").fill("ROUTE")
    expect(page.get_by_text(re.compile(r"\d+ colors"))).to_be_visible(timeout=30000)
    expect(page.get_by_role("button", name="Continue to request")).to_be_enabled(timeout=30000)

def test_csp_allows_wasm_and_blocks_remote(page, base_url):
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(f"{base_url}/customize/g/route-shield/")
    expect(page.get_by_role("button", name="Continue to request")).to_be_enabled(timeout=30000)
    assert not [e for e in errors if "Content Security Policy" in e], errors
```

(Match the fixture names the existing `tests/e2e/conftest.py`/`tests/support` use — read an existing E2E test first and mirror its `page`/server fixtures exactly.)

Run: `node --test tests/unit/customize-form.test.mjs`, `npm run customizer:build`, `python -m pytest tests/e2e/test_customize.py -q`, then `npm run screenshots` (add `/customize/` and the generator page to `scripts/capture_screenshots.py`, desktop light/dark and 390 px) and inspect the images. Also run `npm run audit` (accessibility, contrast, keyboard, reduced motion) and fix findings.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: Customize section — catalog, generator page, worker build, local preview"
```

---

### Task 6: Handoff to the order page, server validation, notifications, operator view

**Files:**
- Create: `customizer/framework/handoff.js`, `public/assets/js/order/customize-handoff.js`, `lib/customization/domain.js`, `operator/assets/customization-detail.js`, `tests/unit/customization-domain.test.mjs`, `tests/unit/customize-handoff.test.mjs`
- Modify: `lib/validation.js`, `lib/notifications.js`, `public/assets/js/order.js`, `public/assets/js/order/model.js` (include `customization` in the request), `operator/assets/operator.js` (mount the section), `tests/e2e/test_customize.py`

**Interfaces:**
- Consumes: `validateParams`, `redactSensitive`, `getGenerator`.
- Produces:
  - `normalizeCustomization(input) -> { generatorId, generatorVersion, params, redacted: string[] } | null` (throws `HttpError(400, …)` on invalid; returns `null` for absent input).
  - `normalizeProjectRequest` output gains `customization` (or `null`).
  - Browser handoff record in IndexedDB db `3dp-customize`, store `handoff`, key `"pending"`: `{ file: Blob, filename, generatorId, generatorVersion, params (sensitive fields already redacted), createdAt }`.
  - `writeHandoff(record) -> Promise<void>` (customizer side) and `takeHandoff() -> Promise<record|null>` (order side; deletes the record; ignores records older than 30 minutes).

- [ ] **Step 1: Failing server-normalization tests**

```js
// tests/unit/customization-domain.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCustomization } from "../../lib/customization/domain.js";
import { normalizeProjectRequest } from "../../lib/validation.js";

const base = { projectTitle: "Tag", service: "print", description: "Print it", modelUrl: "https://example.com/a.stl", contact: { name: "T", email: "t@example.com" }, consent: true };

test("absent customization is null", () => assert.equal(normalizeCustomization(undefined), null));

test("a valid route-shield customization is accepted and pinned to a known version", () => {
  const out = normalizeCustomization({ generatorId: "route-shield", generatorVersion: 1, params: { top_text: "ROUTE" } });
  assert.equal(out.generatorId, "route-shield");
  assert.equal(out.params.top_text, "ROUTE");
});

test("unknown generators, future versions and bad params are rejected with 400", () => {
  for (const bad of [
    { generatorId: "nope", generatorVersion: 1, params: {} },
    { generatorId: "route-shield", generatorVersion: 99, params: {} },
    { generatorId: "route-shield", generatorVersion: 1, params: { width_mm: 9999 } },
    { generatorId: "route-shield", generatorVersion: 1, params: { __proto__: 1, toString: 1 } },
    "route-shield", 7, []
  ]) assert.throws(() => normalizeCustomization(bad), err => err.status === 400, JSON.stringify(bad));
});

test("oversized parameter payloads are rejected", () => {
  assert.throws(() => normalizeCustomization({ generatorId: "route-shield", generatorVersion: 1, params: { back_text: "x".repeat(20000) } }), err => err.status === 400);
});

test("the request normalizer carries the customization through", () => {
  const r = normalizeProjectRequest({ ...base, customization: { generatorId: "route-shield", generatorVersion: 1, params: {} } });
  assert.equal(r.customization.generatorId, "route-shield");
  assert.equal(normalizeProjectRequest(base).customization, null);
});
```

(A Wi-Fi redaction test is added in Task 7 once that generator exists — Task 7's test list names it.)

Run → FAIL.

- [ ] **Step 2: Implement `lib/customization/domain.js`**

```js
import { HttpError } from "../http.js";
import { getGenerator } from "../../public/assets/js/customize/registry.js";
import { validateParams, redactSensitive, sensitiveKeys } from "../../public/assets/js/customize/schema.js";

const MAX_JSON = 8000;

/** Re-validates browser-supplied generator provenance. Sensitive fields are never kept. */
export function normalizeCustomization(input) {
  if (input == null) return null;
  if (typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "Customization details are invalid.");
  const generator = typeof input.generatorId === "string" ? getGenerator(input.generatorId) : undefined;
  if (!generator) throw new HttpError(400, "The selected generator is not available.");
  const version = input.generatorVersion;
  if (!Number.isInteger(version) || version < 1 || version > generator.version) throw new HttpError(400, "The generator version is not supported.");
  if (JSON.stringify(input.params ?? {}).length > MAX_JSON) throw new HttpError(400, "The customization parameters are too large.");
  const { ok, errors, value } = validateParams(generator, input.params ?? {}, { skipSensitive: true });
  if (!ok) throw new HttpError(400, `Customization is invalid: ${errors[0]}`);
  return { generatorId: generator.id, generatorVersion: version, params: redactSensitive(generator, value), redacted: sensitiveKeys(generator) };
}
```

(`HttpError` must carry `.status`; if its property is named differently, adapt the test assertion to the real name — read `lib/http.js` first.)

In `lib/validation.js` add `import { normalizeCustomization } from "./customization/domain.js";` and `customization: normalizeCustomization(input.customization),` in the returned object of `normalizeProjectRequest`. Check `scripts/check-architecture.mjs` passes (lib importing from public is allowed; a `domain.js` must not import providers).

`lib/notifications.js`: where the email/webhook bodies list the request, add a short block when `request.customization` exists: `Customizer: <generatorId> v<version>` and the (already-redacted) parameters as readable lines. Add a test in `tests/unit/notifications.test.mjs` asserting the block appears and that the string `"hunter2"`-style sensitive values never do (Task 7 adds that concrete assertion).

- [ ] **Step 3: Browser handoff + order page**

```js
// customizer/framework/handoff.js  (writer)  — and the same module shape in public/assets/js/order/customize-handoff.js (reader)
const DB = "3dp-customize", STORE = "handoff", KEY = "pending", MAX_AGE_MS = 30 * 60 * 1000;
const open = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const tx = (db, mode, run) => new Promise((resolve, reject) => {
  const t = db.transaction(STORE, mode); const r = run(t.objectStore(STORE));
  t.oncomplete = () => resolve(r.result); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
});
export async function writeHandoff(record) { const db = await open(); try { await tx(db, "readwrite", s => s.put({ ...record, createdAt: Date.now() }, KEY)); } finally { db.close(); } }
export async function takeHandoff() {
  const db = await open();
  try {
    const record = await tx(db, "readonly", s => s.get(KEY));
    await tx(db, "readwrite", s => s.delete(KEY));
    return record && Date.now() - record.createdAt <= MAX_AGE_MS ? record : null;
  } finally { db.close(); }
}
```

The writer file exports only `writeHandoff`; the reader only `takeHandoff` (two small files, one concern each). Test the pair with `fake-indexeddb` **or** by injecting an `indexedDB` double — add `fake-indexeddb` as a devDependency only if no existing test double exists; the test asserts: write → take returns the record once; second take returns `null`; a record aged 31 minutes returns `null`.

Customizer **Continue to request**: redact sensitive fields (`redactSensitive`), `writeHandoff({ file: new Blob([data], { type: "model/3mf" }), filename, generatorId, generatorVersion, params: redacted })`, then `location.assign("/order.html?service=print&from=customize")`. If IndexedDB is unavailable (private window), fall back to **downloading the 3MF** and navigating to the order page with a message ("Your browser blocked the direct hand-off; attach the file you just downloaded"). The order page must work identically without a handoff.

Order page: in `order.js` after `restoreDraft`, if `new URLSearchParams(currentSearch()).get("from") === "customize"`, `const record = await takeHandoff()`; when present: `chooseModelFile(new File([record.file], record.filename, { type: "model/3mf" }))`, set `activeCustomization = { generatorId, generatorVersion, params }`, prefill the project title/description with a generated line ("Custom <generator title> — see attached model"), show a notice "Loaded from the customizer — review and continue." `projectRequestFromData` (in `order/model.js`) adds `customization: activeCustomization ?? undefined` to the request. The draft store (`draft-store.js`) must **not** persist `customization.params` — only `{generatorId, generatorVersion}` — and drafts never include sensitive fields because the handoff already redacted them.

- [ ] **Step 4: Operator view**

`operator/assets/customization-detail.js` exports `renderCustomization(request) -> HTMLElement|null` using `textContent` only (mirror `print-detail.js` helpers `el`, `facts`): heading "Customizer", rows `Generator`, `Version`, then one row per parameter (humanized key → value; redacted values shown as "withheld (in the model's QR code)"), plus the note "The attached 3MF is the model to print; these values are provenance." Mount it in `operator.js` next to the print-estimate section (search for the call that mounts `print-detail.js` and add the new call beside it, guarded by `detail.request?.customization`).

- [ ] **Step 5: Tests and commit**

Run: `node --test tests/unit/customization-domain.test.mjs tests/unit/customize-handoff.test.mjs && npm run test:unit`. Extend the E2E file: customizer → **Continue to request** → URL contains `service=print` → the order page shows the model chip (`.3mf`) and the notice; submit through the local dev API (follow the existing intake test pattern) and assert `data/dev-requests.ndjson`/the local operator store contains `customization.generatorId`. Run `npm run screenshots`, `npm run audit`, `npm test`.

```bash
git add -A && git commit -m "feat: customizer hand-off to order intake with server-side validation and operator view"
```

---

### Task 7: Wi-Fi tag generator

**Files:**
- Create: `public/assets/js/customize/wifi.js`, `public/assets/js/customize/generators/wifi-tag.js`, `customizer/generators/wifi-tag/build.js`, `customizer/g/wifi-tag/index.html`, `tests/unit/customize-wifi.test.mjs`
- Modify: `public/assets/js/customize/registry.js`, `customizer/generators/index.js`, `public/sitemap.xml`, `tests/unit/customization-domain.test.mjs`, `tests/unit/notifications.test.mjs`

**Interfaces:**
- Produces: `escapeWifiField(s)`, `wifiPayload({ ssid, password, security, hidden }) -> string`. `wifi-tag` params: `format` (`placard|keychain|card`), `ssid`, `password` (**sensitive**, optional), `security` (`WPA|WEP|nopass`), `hidden` (bool), `title` (default "WiFi"), `show_text` (bool: print SSID text), `base_color`, `qr_color`, `text_color`, `corner_radius_mm`, `thickness_mm`, `qr_depth_mm`, `hole` (bool, keychain default true).
- Format dimensions (mm): placard 90 × 120, keychain 45 × 60 (+ loop), card 85.6 × 54.

- [ ] **Step 1: Failing tests**

```js
// tests/unit/customize-wifi.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { escapeWifiField, wifiPayload } from "../../public/assets/js/customize/wifi.js";
import { loadEngine } from "../../customizer/framework/engine.js";
import { buildModel } from "../../customizer/framework/model.js";
import { getGenerator } from "../../public/assets/js/customize/registry.js";
import { validateParams } from "../../public/assets/js/customize/schema.js";
import build from "../../customizer/generators/wifi-tag/build.js";
import { normalizeCustomization } from "../../lib/customization/domain.js";

test("special characters are escaped per the WIFI: URI convention", () => {
  assert.equal(escapeWifiField('a;b,c:d"e\\f'), 'a\\;b\\,c\\:d\\"e\\\\f');
});
test("payload shapes", () => {
  assert.equal(wifiPayload({ ssid: "Cafe", password: "pw", security: "WPA", hidden: false }), "WIFI:T:WPA;S:Cafe;P:pw;;");
  assert.equal(wifiPayload({ ssid: "Open", password: "", security: "nopass", hidden: false }), "WIFI:T:nopass;S:Open;;");
  assert.equal(wifiPayload({ ssid: "H", password: "x", security: "WPA", hidden: true }), "WIFI:T:WPA;S:H;P:x;H:true;;");
});

const wasm = await loadEngine();
const gen = { ...getGenerator("wifi-tag"), build };

for (const format of ["placard", "keychain", "card"]) {
  test(`${format} builds with a scannable QR at defaults`, async () => {
    const { ok, errors, value } = validateParams(gen, { format, ssid: "Guest Network", password: "correct-horse-battery" });
    assert.ok(ok, errors.join(";"));
    const out = await buildModel(gen, value, { wasm, font: null });
    assert.ok(out.parts.length >= 2 && out.metrics.unique_colors <= 3);
    assert.ok(out.warnings.every(w => !/too dense/i.test(w)));
  });
}

test("a very long SSID+password on a keychain fails clearly instead of producing a tiny QR", async () => {
  const { value } = validateParams(gen, { format: "keychain", ssid: "S".repeat(32), password: "p".repeat(63) });
  await assert.rejects(() => buildModel(gen, value, { wasm, font: null }), /too dense|larger tag/i);
});

test("the server never keeps the password", () => {
  const out = normalizeCustomization({ generatorId: "wifi-tag", generatorVersion: 1, params: { ssid: "Cafe", password: "hunter2" } });
  assert.equal(out.params.password, "[redacted]");
  assert.ok(!JSON.stringify(out).includes("hunter2"));
});

test("an SSID is required and control characters rejected", () => {
  assert.equal(validateParams(gen, { ssid: "" }).ok, false);
  assert.equal(validateParams(gen, { ssid: "a\nb" }).ok, false);
});
```

Add to `notifications.test.mjs`: build a request containing `customization` produced by `normalizeCustomization` for `wifi-tag` with password `hunter2`, run the email/webhook body builders, and assert `hunter2` appears nowhere. Run all → FAIL.

- [ ] **Step 2: Implement `wifi.js`**

```js
export const escapeWifiField = value => String(value).replace(/([\\;,:"])/g, "\\$1");
export function wifiPayload({ ssid, password = "", security = "WPA", hidden = false }) {
  const parts = [`T:${security}`, `S:${escapeWifiField(ssid)}`];
  if (security !== "nopass" && password) parts.push(`P:${escapeWifiField(password)}`);
  if (hidden) parts.push("H:true");
  return `WIFI:${parts.join(";")};;`;
}
```

- [ ] **Step 3: Schema (`generators/wifi-tag.js`) and registry entry**

Fields with ranges: `ssid` text max 32 (not optional; no control characters is enforced by the schema runtime), `password` text max 63 `sensitive: true, optional: true`, `security` enum, `hidden` bool, `format` enum, `title` text max 20 optional, `show_text` bool default true, colors default `#ffffff`/`#111111`/`#111111` (base/qr/text — the QR inlay and text may share a color so palettes stay ≤ 3), `corner_radius_mm` 0–12 step 0.5 default 4, `thickness_mm` 2–6 step 0.2 default 3, `qr_depth_mm` 0.6–1.6 step 0.2 default 1.0 (always less than `thickness_mm − 0.8` via `rules`), `hole` bool. `presets`: `placard`, `keychain` (`format: "keychain", show_text: false, hole: true`), `card` (`format: "card"`). `rules` returns `limits.qr_depth_mm = [0.6, min(1.6, thickness_mm − 0.8)]` and errors for `security !== "nopass"` with an empty password ("Enter the network password, or choose 'No password'.").

Register in `registry.js` (`import wifiTag from "./generators/wifi-tag.js"`) and `generators/index.js` (`"wifi-tag": () => import("./wifi-tag/build.js")`).

- [ ] **Step 4: Geometry (`customizer/generators/wifi-tag/build.js`)**

Layout rules, all derived from `FORMAT = { placard: [90,120], keychain: [45,60], card: [85.6,54] }`:

```js
import { roundedRect, keyLoop, circle } from "../../framework/shapes.js";
import { qrCrossSection } from "../../framework/qr.js";
import { blockText, fontText, fitCrossSection } from "../../framework/text.js";
import { wifiPayload } from "../../../public/assets/js/customize/wifi.js";

const FORMAT = { placard: [90, 120], keychain: [45, 60], card: [85.6, 54] };
const MARGIN = 4, TEXT_GAP = 3;

export default async function build(p, { wasm, font }) {
  const { CrossSection, Manifold } = wasm;
  const [w, h] = FORMAT[p.format];
  const loop = p.format === "keychain" && p.hole;
  const loopR = 6, holeR = 2.75;                       // 12 mm boss, 5.5 mm hole
  let body = roundedRect(CrossSection, w, h, p.corner_radius_mm);
  const loopCenter = [0, h / 2 + loopR - 3];            // overlaps the body edge by 3 mm
  if (loop) body = body.add(keyLoop(CrossSection, { outerR: loopR, holeR: 0, cx: loopCenter[0], cy: loopCenter[1] }))
    .subtract(circle(CrossSection, holeR).translate(loopCenter));

  // Reserve a text band below the QR when text is shown; QR is a square centered in the rest.
  const showText = p.show_text && p.format !== "keychain";
  const textBand = showText ? 12 : 0;
  const qrSize = Math.min(w - 2 * MARGIN, h - 2 * MARGIN - textBand - (loop ? 0 : 0)) ;
  const qrCenterY = (textBand / 2) + (loop ? -2 : 0);
  const q = qrCrossSection(CrossSection, wifiPayload({ ssid: p.ssid, password: p.password, security: p.security, hidden: p.hidden }), qrSize);
  const qr = q.cs.translate([0, qrCenterY]);

  const warnings = [];
  if (q.module < 0.9) warnings.push(`QR module size is ${q.module.toFixed(2)} mm; a 0.4 mm nozzle and good first layer are recommended.`);

  // QR and text are flush inlays: the base is a bottom skin with them removed plus a full core.
  const make = t => (!t.trim() ? new CrossSection([]) : (font ? fontText(CrossSection, font, t) : blockText(CrossSection, t)));
  let label = new CrossSection([]);
  if (showText) {
    const line = `${p.title ? p.title + " · " : ""}${p.ssid}`;
    label = fitCrossSection(make(line), { maxWidth: w - 2 * MARGIN, maxHeight: textBand - TEXT_GAP, centerX: 0, centerY: -h / 2 + textBand / 2 + 1 });
  }
  const inlay = qr.add(label).intersect(body.offset(-1.2));
  const T = p.thickness_mm, D = p.qr_depth_mm;
  const skin = body.subtract(inlay).extrude(D);
  const core = body.extrude(T - D).translate([0, 0, D]);
  const base = Manifold.union([skin, core]);
  // Inlay is built on the BACK side (z = 0) and mirrored so it reads from the back after flipping: keep QR on the visible face instead.
  const solids = [
    { name: "Tag body", solid: base, color: p.base_color },
    { name: "QR and text inlay", solid: inlay.extrude(D).translate([0, 0, 0]), color: p.qr_color }
  ];
  return { solids, warnings, title: `Wi-Fi tag - ${p.format}`, filenameBase: `wifi-tag-${p.format}` };
}
```

**Orientation:** the inlay must be on the face the customer holds up to a phone. The Bambu build plate prints z=0 down, so the visible QR face is the **top** surface for a tag lying flat. Therefore place the inlay at the top: `skin` = full-thickness body minus inlay cut from the **top** `D` mm, i.e. build `core = body.extrude(T − D)` and `topSkin = body.subtract(inlay).extrude(D).translate([0, 0, T − D])`, with `inlay.extrude(D).translate([0, 0, T − D])`. Use that form (replace the skin/core lines above) and note the choice in the file header. The QR must **not** be mirrored in this orientation.

Keychain: when `p.format === "keychain"` omit the text band entirely (the schema default `show_text: false` is forced for that format by `rules`).

Dense-payload guard: let `qrCrossSection` throw its "too dense" error; the builder wraps it for the customer: `catch (e) { if (/too dense/.test(e.message)) throw new Error(\`${e.message} Use a shorter network name/password or choose a larger tag format.\`); throw e; }`.

- [ ] **Step 5: Page and sitemap**

Copy `customizer/g/route-shield/index.html` to `customizer/g/wifi-tag/index.html` (change `generator-id`, `<title>`, description). The Wi-Fi page adds the privacy line under the form: "The password is encoded in the QR code inside your model file. We don't store it separately." Add the URL to `public/sitemap.xml`.

- [ ] **Step 6: Run, inspect, commit**

Run: `node --test tests/unit/customize-wifi.test.mjs tests/unit/customization-domain.test.mjs tests/unit/notifications.test.mjs && npm test`. **Scan check:** decode the QR from the default tag — add a Node test that rasterizes the QR cross-section modules (`q.modules` grid) back to a boolean matrix with `qrcode-generator` and asserts it equals the matrix for the payload (guards the Y-flip/mirror mistakes the prototype hit). Take a screenshot and visually confirm in the page that a phone could scan it (print one tag and scan it as the manual acceptance check; note result in the commit body).

```bash
git add -A && git commit -m "feat: Wi-Fi tag generator (placard, keychain, business card) with redacted password"
```

---

### Task 8: Rating card generator, icon library and image tracing

**Files:**
- Create: `customizer/framework/{icons,image-trace}.js`, `public/assets/js/customize/generators/rating-card.js`, `customizer/generators/rating-card/build.js`, `customizer/g/rating-card/index.html`, `tests/unit/customize-icons.test.mjs`, `tests/unit/customize-rating-card.test.mjs`
- Modify: `registry.js`, `customizer/generators/index.js`, `public/sitemap.xml`

**Interfaces:**
- Produces: `ICONS: { [id]: { label, contours: [[x,y]...][] } }` in a 0–100 box, `iconCrossSection(CrossSection, id) -> CrossSection` (area-normalized to a 100-unit box, origin-centered), `traceImage({ pixels: Uint8ClampedArray, width, height, threshold, invert, maxCells = 96 }) -> contours[]` (pure; the browser decodes via canvas, tests pass raw RGBA), `imageCrossSection(CrossSection, contours) -> CrossSection`. `rating-card` params: `rating` (0–5, step 0.5, default 3.5), `caption` (text max 40, default "Would poop here again"), `icon` (enum: `toilet|heart|house|mug|custom`), `image_threshold` (int 0–255, default 128), `image_invert` (bool), `image_scale_pct` (30–120), `show_stars` (bool), `base_color` (#ffffff), `icon_color` (#6b4a2f), `star_color` (#f5b301), `empty_star_color` (#d9d9d9), `text_color` (#111111), `thickness_mm` (1.2–3, default 1.6), `relief_mm` (0.4–1.2 step 0.2, default 0.6), `corner_radius_mm` (0–8, default 3). Business-card size fixed 85.6 × 54 mm.
- Custom image bytes **never** leave the browser; only the traced contours feed geometry. The page keeps the decoded contours in the worker message (`imageContours`), not in `params`.

- [ ] **Step 1: Failing tests**

```js
// tests/unit/customize-icons.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { loadEngine } from "../../customizer/framework/engine.js";
import { ICONS, iconCrossSection } from "../../customizer/framework/icons.js";
import { traceImage, imageCrossSection } from "../../customizer/framework/image-trace.js";

const { CrossSection } = await loadEngine();

test("every bundled icon is a non-empty, bounded shape", () => {
  assert.deepEqual(Object.keys(ICONS).sort(), ["heart", "house", "mug", "toilet"]);
  for (const id of Object.keys(ICONS)) {
    const cs = iconCrossSection(CrossSection, id);
    const b = cs.bounds();
    assert.ok(cs.area() > 200, `${id} area`);
    assert.ok(b.max[0] - b.min[0] <= 100.01 && b.max[1] - b.min[1] <= 100.01);
  }
});

test("tracing a black square on white yields one contour near the square", () => {
  const W = 40, H = 40, px = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) { const i = (y * W + x) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
  const contours = traceImage({ pixels: px, width: W, height: H, threshold: 128, invert: false });
  const cs = imageCrossSection(CrossSection, contours);
  assert.ok(Math.abs(cs.area() - 400) / 400 < 0.1, `area ${cs.area()}`);
});

test("hostile images are bounded or rejected", () => {
  assert.throws(() => traceImage({ pixels: new Uint8ClampedArray(0), width: 0, height: 0, threshold: 128 }), /empty/i);
  assert.throws(() => traceImage({ pixels: new Uint8ClampedArray(16), width: 1000000, height: 1000000, threshold: 128 }), /too large/i);
  const blank = new Uint8ClampedArray(40 * 40 * 4).fill(255);
  assert.throws(() => traceImage({ pixels: blank, width: 40, height: 40, threshold: 128 }), /nothing to trace|no shape/i);
});
```

```js
// tests/unit/customize-rating-card.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { loadEngine } from "../../customizer/framework/engine.js";
import { buildModel } from "../../customizer/framework/model.js";
import { getGenerator } from "../../public/assets/js/customize/registry.js";
import { validateParams } from "../../public/assets/js/customize/schema.js";
import build from "../../customizer/generators/rating-card/build.js";
import { inflateRawSync } from "node:zlib";
import { analyzeModelBytes } from "../../public/assets/js/print-estimation/geometry.js";

const wasm = await loadEngine();
const gen = { ...getGenerator("rating-card"), build };
const inflateRaw = async (b, max) => new Uint8Array(inflateRawSync(b, { maxOutputLength: max }));

test("the canonical card builds at business-card size with five or fewer colors", async () => {
  const { ok, value } = validateParams(gen, { icon: "toilet", rating: 3.5, caption: "Would poop here again" });
  assert.ok(ok);
  const out = await buildModel(gen, value, { wasm, font: null });
  const a = await analyzeModelBytes({ name: out.filename, bytes: out.data, inflateRaw });
  assert.ok(Math.abs(a.dimensionsMm[0] - 85.6) < 0.5 && Math.abs(a.dimensionsMm[1] - 54) < 0.5, a.dimensionsMm.join("x"));
  assert.ok(out.metrics.unique_colors <= 5);
});

test("half stars: 3.5 has a different filled area than 3 and 4", async () => {
  const vol = async r => { const { value } = validateParams(gen, { rating: r }); const o = await buildModel(gen, value, { wasm, font: null });
    return (await analyzeModelBytes({ name: o.filename, bytes: o.data, inflateRaw })).volumeMm3; };
  const [v3, v35, v4] = [await vol(3), await vol(3.5), await vol(4)];
  assert.ok(v3 < v35 && v35 < v4);
});

test("rating 0 and 5 are valid; 5.5 and 3.3 are not", () => {
  assert.equal(validateParams(gen, { rating: 0 }).ok, true);
  assert.equal(validateParams(gen, { rating: 5 }).ok, true);
  assert.equal(validateParams(gen, { rating: 5.5 }).ok, false);
  assert.equal(validateParams(gen, { rating: 3.3 }).ok, false);
});

test("a 40-character caption fits by shrinking and an empty caption is allowed", async () => {
  const long = validateParams(gen, { caption: "W".repeat(40) });
  assert.ok(long.ok);
  await buildModel(gen, long.value, { wasm, font: null });
  assert.equal(validateParams(gen, { caption: "" }).ok, true);
});

test("a custom image is used when icon is custom and refused when absent", async () => {
  const { value } = validateParams(gen, { icon: "custom" });
  await assert.rejects(() => buildModel(gen, value, { wasm, font: null, imageContours: null }), /choose an image/i);
});
```

(`buildModel` must forward extra context keys (`imageContours`) to `generator.build` — change `buildModel(generator, params, ctx)` in Task 3 to pass the whole `ctx` through: `generator.build(params, ctx)`; update the Task 3 signature accordingly when implementing this task.)

- [ ] **Step 2: Implement icons**

`customizer/framework/icons.js` — author each icon as contour arrays in a 100×100 box, with `iconCrossSection` unioning contours via `CrossSection.ofPolygons(contours, "NonZero")` and centering on the origin. Concrete geometry:

```js
const circlePts = (cx, cy, r, n = 40) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]);
const heartPts = () => Array.from({ length: 60 }, (_, i) => { const t = (i / 60) * 2 * Math.PI;
  return [50 + 3.0 * 16 * Math.sin(t) ** 3, 52 + 3.0 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]; });

export const ICONS = {
  toilet: { label: "Toilet", contours: [
    [[22,95],[22,60],[78,60],[78,95]],                     // tank (back)
    [[12,60],[88,60],[84,40],[70,22],[50,16],[30,22],[16,40]],   // bowl (top view side profile)
    [[40,16],[60,16],[64,5],[36,5]]                        // base
  ] },
  heart: { label: "Heart", contours: [heartPts()] },
  house: { label: "House", contours: [[[10,50],[50,90],[90,50],[78,50],[78,10],[22,10],[22,50]]] },
  mug: { label: "Mug", contours: [[[15,15],[70,15],[70,85],[15,85]], circlePts(82, 50, 14)] }
};
```

Because icons are simple filled silhouettes, avoid internal holes except where explicitly subtracted — the `ofPolygons` positive-winding rule requires **counter-clockwise** outers (the prototype hit this; reuse its `positiveContour()` normalization from `template.js` before `ofPolygons`). The test asserts only area/bounds; the visual check in Step 6 refines proportions (tune coordinates until the toilet reads clearly at 24 mm height; keep the test bounds).

`image-trace.js`:

```js
const MAX_PIXELS = 16_000_000;
export function traceImage({ pixels, width, height, threshold = 128, invert = false, maxCells = 96 }) {
  if (!(width > 0 && height > 0) || pixels.length === 0) throw new Error("The image is empty.");
  if (width * height > MAX_PIXELS || pixels.length < width * height * 4) throw new Error("The image is too large or malformed.");
  // Box-downsample to at most maxCells on the long edge, then threshold on luminance (alpha-aware).
  const scale = Math.min(1, maxCells / Math.max(width, height));
  const cw = Math.max(1, Math.round(width * scale)), ch = Math.max(1, Math.round(height * scale));
  const dark = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    const x0 = Math.floor(cx / scale), x1 = Math.min(width, Math.floor((cx + 1) / scale)), y0 = Math.floor(cy / scale), y1 = Math.min(height, Math.floor((cy + 1) / scale));
    let sum = 0, n = 0;
    for (let y = y0; y < Math.max(y1, y0 + 1); y++) for (let x = x0; x < Math.max(x1, x0 + 1); x++) {
      const i = (y * width + x) * 4; const a = pixels[i + 3] / 255;
      sum += (0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]) * a + 255 * (1 - a); n++;
    }
    const lum = sum / n;
    dark[cy * cw + cx] = (invert ? lum >= threshold : lum < threshold) ? 1 : 0;
  }
  // Run-length rectangles per row; Manifold unions them. Y is flipped so the image is upright.
  const contours = [];
  for (let y = 0; y < ch; y++) {
    let x = 0;
    while (x < cw) {
      if (!dark[y * cw + x]) { x++; continue; }
      const start = x; while (x < cw && dark[y * cw + x]) x++;
      const top = ch - y, bottom = ch - y - 1;
      contours.push([[start, bottom], [x, bottom], [x, top], [start, top]]);
    }
  }
  if (!contours.length) throw new Error("There is nothing to trace — adjust the threshold or choose an image with a dark subject.");
  return contours;
}
export function imageCrossSection(CrossSection, contours) {
  const cs = CrossSection.ofPolygons(contours.map(c => c.map(([x, y]) => [x - 0.003, y - 0.003])), "NonZero")
    .offset(0.15, "Round", 2, 8);
  return cs.simplify(0.05);
}
```

The page decodes uploads with `createImageBitmap` onto a bounded canvas (reject files > 8 MB or > 4096 px on a side, animated formats use the first frame), passes `getImageData` to `traceImage` on the main thread, and sends the resulting `contours` (plain arrays) to the worker as `imageContours`.

- [ ] **Step 3: Schema and rules (`generators/rating-card.js`)**

Define the fields above. `rules(p)`: `limits.relief_mm = [0.4, Math.min(1.2, p.thickness_mm − 0.8)]`; error `"Choose an image or pick a built-in icon."` is raised **at build time**, not in the schema (the image isn't a parameter). Presets: `toilet`, `heart`, `house`, `mug` mapping `icon`. `origin: "house"`, `rights.publishable: true`.

- [ ] **Step 4: Geometry (`customizer/generators/rating-card/build.js`)**

Layout on a 85.6 × 54 card (origin-centered, y up): icon region left, 30 × 30 mm square at `(-27, 5)`; star row top-right, five stars with outer radius 4.5 mm at pitch 10.4 mm starting `x = −5` (centers `x = -5 + i*10.4`, `y = 14`); caption band bottom, full width minus 6 mm margins, height 14 mm centered at `y = −17`. Build:

```js
export default async function build(p, ctx) {
  const { wasm, font, imageContours = null } = ctx;
  const { CrossSection, Manifold } = wasm;
  const W = 85.6, H = 54, T = p.thickness_mm, R = p.relief_mm;
  const card = roundedRect(CrossSection, W, H, p.corner_radius_mm);

  // icon
  let iconCS;
  if (p.icon === "custom") {
    if (!imageContours) throw new Error("Choose an image first, or pick a built-in icon.");
    iconCS = imageCrossSection(CrossSection, imageContours);
  } else iconCS = iconCrossSection(CrossSection, p.icon);
  iconCS = fitCrossSection(iconCS, { maxWidth: 30 * p.image_scale_pct / 100, maxHeight: 30 * p.image_scale_pct / 100, centerX: -27, centerY: 5 });

  // stars: empty star under every slot, filled (full or half) star on top
  const slots = 5, filledUnits = Math.round(p.rating * 2);          // half-star units 0..10
  let empty = new CrossSection([]), full = new CrossSection([]);
  for (let i = 0; i < slots; i++) {
    const c = [-5 + i * 10.4, 14];
    empty = empty.add(star(CrossSection, 4.5).translate(c));
    const units = Math.max(0, Math.min(2, filledUnits - i * 2));
    if (units > 0) full = full.add(partialStar(CrossSection, 4.5, units / 2).translate(c));
  }
  if (!p.show_stars) { empty = new CrossSection([]); full = new CrossSection([]); }

  // caption
  const mk = t => font ? fontText(CrossSection, font, t) : blockText(CrossSection, t);
  const caption = p.caption ? fitCrossSection(mk(p.caption), { maxWidth: W - 12, maxHeight: 11, centerX: 0, centerY: -17 }) : new CrossSection([]);

  // Relief on top of a base plate: base, icon, empty stars (sit below filled), filled stars, text.
  const base = card.extrude(T - R);
  const raised = (cs, z0, h) => cs.isEmpty() ? null : cs.intersect(card.offset(-1)).extrude(h).translate([0, 0, z0]);
  const solids = [{ name: "Card base", solid: base.add ? base : base, color: p.base_color }];
  const push = (name, solid, color) => { if (solid) solids.push({ name, solid, color }); };
  push("Icon", raised(iconCS, T - R, R), p.icon_color);
  push("Empty stars", raised(empty.subtract(full), T - R, R), p.empty_star_color);
  push("Filled stars", raised(full, T - R, R), p.star_color);
  push("Caption", raised(caption, T - R, R), p.text_color);
  return { solids, warnings: [], title: `Rating card - ${p.caption}`.trim(), filenameBase: `rating-card-${safeName(p.caption)}` };
}
```

(Relief on a plate means each color piece sits flush on the base top and rises `R` above; the base thickness is `T − R` so total height is `T`. Import `safeName` from `../../framework/model.js`; the `base.add ? base : base` line above is a typo guard — write `solid: base`.) Overlaps between colored pieces must not occur: icon, stars and caption regions are disjoint by construction (assert in the test via total volume = sum of parts, within 0.5 %).

- [ ] **Step 5: Page, registry, sitemap**

Page adds an image picker (`<input type="file" accept="image/png,image/jpeg,image/webp">`) shown when `icon = custom`, with threshold and invert controls and a small trace preview; copy states "Your image stays in your browser. Only the traced outline goes into the model." Customer images are **not** uploaded unless the customer attaches the original on the order page. Register `rating-card`, add `generators/index.js` entry and sitemap URL.

- [ ] **Step 6: Run, inspect, commit**

Run: `node --test tests/unit/customize-icons.test.mjs tests/unit/customize-rating-card.test.mjs && npm test`. Render the canonical toilet + 3.5-star card in the browser, screenshot it, and **look at it**: the toilet reads as a toilet, the half star is half, the caption is centered with margin. Tune icon coordinates and layout until it does (this visual pass is part of the task).

```bash
git add -A && git commit -m "feat: rating card generator with icon library, half stars and customer image tracing"
```

---

### Task 9: Name plate generator and self-hosted fonts

**Files:**
- Create: `public/assets/js/customize/generators/name-plate.js`, `customizer/generators/name-plate/build.js`, `customizer/g/name-plate/index.html`, `customizer/static/fonts/*.ttf`, `customizer/static/fonts/LICENSES.md`, `public/assets/js/customize/fonts.js`, `tests/unit/customize-name-plate.test.mjs`
- Modify: `registry.js`, `customizer/generators/index.js`, `public/sitemap.xml`, `customizer/framework/fonts.js`

**Interfaces:**
- Produces: `FONTS` from `public/assets/js/customize/fonts.js`: `[{ id, label, file, license }]` for 8 curated OFL fonts — Pacifico, Lobster, Bebas Neue, Righteous, Permanent Marker, Rubik Mono One, Bangers, Chewy. `name-plate` params: `name` (text 1–20, default "Alex"), `font` (enum of the 8 ids plus `block`), `style` (`raised|outline|shadow|inlay`), `plate` (`none|pill|rect`), `keychain_loop` (bool), `height_mm` (14–60, default 24), `thickness_mm` (2–6, default 3), `relief_mm` (0.6–2, default 1.2), colors `text_color`, `outline_color`, `plate_color` (≤ 3 colors total).

- [ ] **Step 1: Download and verify fonts**

```bash
cd G:/git/3dprint4me-generators/customizer/static/fonts
base=https://github.com/google/fonts/raw/main/ofl
curl -fsSL -o Pacifico-Regular.ttf        $base/pacifico/Pacifico-Regular.ttf
curl -fsSL -o Lobster-Regular.ttf         $base/lobster/Lobster-Regular.ttf
curl -fsSL -o BebasNeue-Regular.ttf       $base/bebasneue/BebasNeue-Regular.ttf
curl -fsSL -o Righteous-Regular.ttf       $base/righteous/Righteous-Regular.ttf
curl -fsSL -o PermanentMarker-Regular.ttf $base/permanentmarker/PermanentMarker-Regular.ttf
curl -fsSL -o RubikMonoOne-Regular.ttf    $base/rubikmonoone/RubikMonoOne-Regular.ttf
curl -fsSL -o Bangers-Regular.ttf         $base/bangers/Bangers-Regular.ttf
curl -fsSL -o Chewy-Regular.ttf           $base/chewy/Chewy-Regular.ttf
ls -l *.ttf && sha256sum *.ttf > SHA256SUMS && head -c 4 Pacifico-Regular.ttf | xxd | head -1
```

Expected: each file is a real TrueType (starts `00 01 00 00` or `true`) and non-trivial size. For each font, fetch its `OFL.txt` from the same directory in `google/fonts` and record family, copyright line and "SIL OFL 1.1" in `LICENSES.md` (the license text file itself ships beside it as `OFL-<family>.txt`). If any font 404s, substitute another static OFL display font from `google/fonts/ofl` and update the list/test; do not ship a font without its license recorded.

- [ ] **Step 2: Failing tests**

```js
// tests/unit/customize-name-plate.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "opentype.js";
import { loadEngine } from "../../customizer/framework/engine.js";
import { buildModel } from "../../customizer/framework/model.js";
import { getGenerator } from "../../public/assets/js/customize/registry.js";
import { validateParams } from "../../public/assets/js/customize/schema.js";
import { FONTS } from "../../public/assets/js/customize/fonts.js";
import build from "../../customizer/generators/name-plate/build.js";

const wasm = await loadEngine();
const gen = { ...getGenerator("name-plate"), build };
const loadFontFile = async id => { const f = FONTS.find(x => x.id === id); const b = await readFile(new URL(`../../customizer/static/fonts/${f.file}`, import.meta.url)); return parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };

test("the font list matches the files on disk and each has a recorded license", async () => {
  const licenses = await readFile(new URL("../../customizer/static/fonts/LICENSES.md", import.meta.url), "utf8");
  for (const f of FONTS) { await loadFontFile(f.id); assert.ok(licenses.includes(f.label), `license entry for ${f.label}`); }
});

for (const font of ["pacifico", "bebas-neue", "permanent-marker"]) for (const style of ["raised", "outline", "shadow", "inlay"]) {
  test(`${font} / ${style} builds a valid multi-part model`, async () => {
    const { ok, errors, value } = validateParams(gen, { name: "Jordan", font, style });
    assert.ok(ok, errors.join(";"));
    const out = await buildModel(gen, value, { wasm, font: await loadFontFile(font) });
    assert.ok(out.parts.length >= 2 && out.metrics.unique_colors <= 3);
  });
}

test("names with emoji or glyphs the font lacks do not crash the build", async () => {
  const { value } = validateParams(gen, { name: "Zoë 🚽", font: "bebas-neue" });
  const out = await buildModel(gen, value, { wasm, font: await loadFontFile("bebas-neue") });
  assert.ok(out.parts.length >= 1);
});

test("the 20-character limit and required name are enforced", () => {
  assert.equal(validateParams(gen, { name: "N".repeat(21) }).ok, false);
  assert.equal(validateParams(gen, { name: " " }).ok, false);
});

test("a keychain loop adds a hole and keeps one connected body", async () => {
  const plain = await buildModel(gen, validateParams(gen, { keychain_loop: false }).value, { wasm, font: null });
  const loop = await buildModel(gen, validateParams(gen, { keychain_loop: true }).value, { wasm, font: null });
  assert.ok(loop.metrics.triangles > plain.metrics.triangles);
});
```

Run → FAIL.

- [ ] **Step 3: Font list, schema and geometry**

`fonts.js`: `export const FONTS = [{ id: "pacifico", label: "Pacifico", file: "Pacifico-Regular.ttf", license: "OFL-1.1" }, …]` for all eight (ids kebab-case: `pacifico lobster bebas-neue righteous permanent-marker rubik-mono-one bangers chewy`). The schema's `font` enum is `[{ value: "block", label: "Block (built-in)" }, …FONTS.map(f => ({ value: f.id, label: f.label }))]`.

`build.js`: text outline from `font ? fontText : blockText`, fit into `height_mm` tall box with width cap 150 mm, then by `style`:

```js
const text = fitCrossSection(mk(p.name), { maxWidth: 150, maxHeight: p.height_mm, centerX: 0, centerY: 0 });
const T = p.thickness_mm, R = p.relief_mm;
const pad = 3;
const plateCS = p.plate === "none" ? null
  : p.plate === "pill" ? text.offset(pad + 2, "Round", 2, 24).add(roundRectFrom(text, pad)) /* convex-ish backing */ 
  : roundedRectAround(text, pad);
```

Implement concretely:
- `plate "rect"`: `const b = text.bounds(); roundedRect(CrossSection, w + 2*pad, h + 2*pad, 3).translate(center)`; `plate "pill"`: `roundedRect(…, radius = (h+2*pad)/2)`; `none`: the plate is the **outline offset** of the text (`text.offset(1.6, "Round", 2, 24)`) so letters stay one connected piece (required for a keychain; if `plate==="none"` force `style` ≠ `inlay`).
- Styles: `raised` = plate base `T − R`, text raised `R` in `text_color`; `outline` = text raised plus an `outline_color` ring (`text.offset(1.2).subtract(text)`) at the same height; `shadow` = text copy offset `[0.9, −0.9]` in `outline_color` at height `R/2` under the raised text; `inlay` = text flush inset into the plate (plate cut `R`, text fills it).
- `keychain_loop`: boss `keyLoop` (outerR 6, hole 2.75) placed at the left end `(b.min[0] − 3, centerY)`, unioned into the plate (or into the base outline when `plate === "none"`), hole subtracted from every solid.

Verification is by test: every style must yield ≥ 2 parts, ≤ 3 unique colors, and one connected plate — assert connectedness through `manifold.decompose().length === 1` for the base solid **inside the builder** (`if (base.decompose().length > 1) throw new Error("The letters aren't connected — choose a plate or a bolder font.")`) so a disconnected script font fails with a readable message rather than printing as loose letters.

- [ ] **Step 4: Register, page, sitemap; font loading in the browser**

`customizer/framework/fonts.js` `loadFont({ fontId })`: look up in `FONTS`, `fetch(\`/customize/fonts/${file}\`)`, `parse` with opentype.js; `fontId === "block"` returns `null`; customer-supplied font file is supported behind an "Use my own font" file input on the name-plate page (bytes parsed locally, never uploaded; the file is not remembered). The page's font picker shows each option **rendered in its own font** using a CSS `@font-face` pointing at `/customize/fonts/<file>` (same-origin, allowed by `font-src 'self'`).

- [ ] **Step 5: Run, inspect, commit**

Run: `node --test tests/unit/customize-name-plate.test.mjs && npm test`; screenshot each style in the browser and inspect (letters connected, outline visible, shadow offset sane, loop clear of letters).

```bash
git add -A && git commit -m "feat: name plate generator with self-hosted OFL fonts"
```

---

### Task 10: End-to-end, hardening, documentation

**Files:**
- Create: `docs/GENERATORS.md`
- Modify: `tests/e2e/test_customize.py`, `docs/PRINT-ESTIMATION.md`, `docs/DEPLOYMENT.md`, `docs/VERIFICATION.md`, `docs/ARCHITECTURE.md`, `AGENTS.md`, `README.md`, `CHANGELOG.md`, `scripts/capture_screenshots.py`, `scripts/validate.mjs`

- [ ] **Step 1: Full-matrix E2E**

Extend `test_customize.py` with one flow per generator: open page → change a field → "N colors" badge → Continue → order page shows the `.3mf` chip and the customizer notice → submit through the local API → local operator store holds `customization.generatorId`. Add: (a) the Wi-Fi flow asserts the submitted payload text does not contain the typed password (read the request from `data/dev-requests.ndjson`); (b) IndexedDB-blocked fallback (`page.add_init_script` that makes `indexedDB.open` throw) shows the download + message; (c) a 390 px viewport run for each generator page (no horizontal scroll: `scrollWidth <= innerWidth`); (d) CSP: zero console CSP violations on each page; (e) offline-ish: block `**/*` except same-origin and confirm builds still succeed (nothing remote is needed).

- [ ] **Step 2: Validation gates**

In `scripts/validate.mjs` add: every registry generator has `customizer/g/<id>/index.html` built output, a sitemap entry, a `rights` note, ≤ 5 colors declared by its default params (build each default in `tests/unit/customize-all-generators.test.mjs` and assert), and no `fetch(`/`XMLHttpRequest` to a non-same-origin host in `public/customize/**` (extend `browser-secret-scan.mjs`'s scan with a remote-URL pattern allowlist: `data:`, `blob:`, same-origin, and the W3C namespace strings used by the 3MF writer).

Create `tests/unit/customize-all-generators.test.mjs` iterating `Object.values(GENERATORS)`: defaults validate, defaults build (loading the generator's builder via `loadBuilder`), parts ≤ 5 colors, analyzer reports no warnings other than `embedded_settings_ignored`, build time under 20 s (Node), and each preset validates.

- [ ] **Step 3: Documentation**

`docs/GENERATORS.md`: what a generator is; the contract (schema field types, `rules`, `build` return shape); how to add a generator (checklist: schema file, build file, registry + `loadBuilder` entries, page HTML, sitemap, tests, `rights` note); sensitive-field policy; rights/provenance policy; image and font rules; build pipeline, CSP split and the Node 22 note; troubleshooting (WASM blocked ⇒ check CSP header on `/customize/*`). Update `PRINT-ESTIMATION.md` (customizer files arrive through the same flow; multi-color slot handling from Task 0), `ARCHITECTURE.md` (new bounded context "Customizer" with its dependency rules), `AGENTS.md` (primary files + invariant: "no remote requests from `/customize/*`; sensitive generator fields never leave the browser"), `VERIFICATION.md` (updated check counts: run the suites and record real numbers), `CHANGELOG.md`.

- [ ] **Step 4: Final verification and commit**

Run: `npm test` (all suites), `npm run screenshots`, inspect `screenshots/preview-board.png` and the new customize screenshots, `npm run audit`. Run `npm run validate` on a clean clone-like state (`git stash -u` is **not** needed — just `rm -rf public/customize && npm run vercel-build` and confirm it passes from scratch).

```bash
git add -A && git commit -m "docs+test: generator section end-to-end coverage, validation gates, documentation"
```

---

### Task 11: Production rollout (owner-gated)

**Files:** `docs/DEPLOYMENT.md` (record the executed steps), no code.

Nothing here runs without the owner's explicit go-ahead for each outward-facing action; credentials are entered by the owner.

- [ ] **Step 1: Pre-flight (read-only)** — confirm migration 005 applied in production (it is a prerequisite of the rate-limited estimate API) and that `/api/health` reports `printEstimation: true`; confirm the Vercel project and branch settings (`mcp__claude_ai_Vercel` tools: `get_project`, `list_deployments`).
- [ ] **Step 2: Preview deployment** — push `feat/generator-section`, open a PR (title "Customize section: parametric generators"), let Vercel build a preview; open it and run the four generator flows against the preview (print one Wi-Fi tag and scan it).
- [ ] **Step 3: Worker on jdh-docker-00** — with the owner: deploy the Portainer git stack from `deploy/slicer-worker/docker-compose.yml` (branch `main` after merge; env `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `SLICER_PROFILE_ID` entered by the owner in Portainer); run the one-batch check (`docker compose … run --rm slicer-worker node scripts/print-estimate-worker.mjs --once`).
- [ ] **Step 4: Enable slicing** — owner (or Vercel MCP with approval) sets `SLICER_PROVIDER=bambu-cli` in Production and redeploys.
- [ ] **Step 5: Merge and smoke** — merge the PR; run `npm run smoke:live`; submit one real customizer request end to end and confirm the operator sees the model, the parameters and a slicer-backed estimate. Record each executed step and its result in `docs/DEPLOYMENT.md`.
- [ ] **Step 6: Rollback note** — code rollback = redeploy the previous Vercel deployment (no migration to undo); worker rollback = `docker compose down` (jobs stay queued).

---

## Self-Review

**Spec coverage:** framework + registry (Tasks 2-4); site section, CSP, build order, `version-assets`, `includeFiles` (Tasks 1, 5); handoff via IndexedDB with fallback, single intake, no early upload, price on order page (Task 6); source-of-truth wording and operator "provenance" note (Task 6 operator view); sensitive parameters (Tasks 2, 6, 7 — tightened to never-stored; spec amended in the same commit); provenance/rights (Task 2 definition shape, Task 4 schema, Task 10 gate); fonts self-hosted (Task 9, Global Constraints); images/icons (Task 8); four generators (Tasks 4, 7, 8, 9); slicer multi-color risk first (Task 0) and rollout owner-gated (Task 11); tests/E2E/screenshots/docs (Tasks 5, 10). Migration: none needed (payload JSONB) — the spec's "additive migration" line is superseded and corrected in the spec in this commit.

**Placeholder scan:** the only intentionally tuned values are icon coordinates (Task 8) and Wi-Fi layout offsets (Task 7), each with a mandatory visual acceptance step and fixed test bounds; no TBD/TODO text remains.

**Type consistency:** `validateParams/clampParams/redactSensitive/sensitiveKeys` (Task 2) are the names used in Tasks 5-9; `buildModel(generator, params, ctx)` forwards `ctx` (noted in Task 8 as a Task 3 amendment — apply it when implementing Task 3); generator definitions use `{ id, version, schema, rules, presets, origin, rights }` everywhere; builders return `{ solids, warnings, title, filenameBase }`; handoff record keys match between writer, reader and order page; `loadBuilder` map keys equal registry ids.

**Review Focus:** items 1-6 map to Task 0 (slots + real slice), Tasks 6/7 (redaction tests incl. notifications), Task 7 (dense QR and QR-matrix equality), Tasks 4/8/9 (fit-or-error tests), Tasks 2/9 (control characters, emoji, blank, 20 000-char payload), Task 8 (hostile images).
