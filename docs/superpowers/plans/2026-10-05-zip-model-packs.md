# ZIP Model Packs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept a ZIP of print models on the Print service, extract the STL/3MF parts safely, let the customer pick parts and quantities, estimate and slice the selection, and show the operator the pack with per-part detail and downloads.

**Architecture:** One shared, dependency-free archive inspector (browser and server) wraps the existing bounded ZIP reader. The browser reads the ZIP locally for the picker and a non-binding range; the server re-validates, extracts every candidate model into child `print_assets` (server-generated paths), measures each, and on `estimate-pack` queues one slice job per selected part and rolls the parts up into one estimate priced once. Submit attaches the ZIP and selected children only; unselected children are purged by the retention sweep.

**Tech Stack:** Node 22 ES modules, `node:test`, `@electric-sql/pglite` (real-SQL tests), Neon Postgres, private Vercel Blob, vanilla browser JS, Playwright (Python) e2e.

**Spec:** `docs/superpowers/specs/2026-10-05-zip-model-packs-design.md`

## Spec amendments decided while planning

1. The inspector lives in `public/assets/js/print-estimation/archive.js` (shared by browser and server, like `three-mf.js`), not `lib/.../archive/inspect-archive.js`, so the picker and the server run identical rules. It computes CRC-32 itself (no `node:zlib` dependency).
2. `parent_asset_id` uses the default `NO ACTION` foreign key (not `RESTRICT`) so a single `DELETE ... WHERE session` statement can remove parent and children together.
3. The ignored-file list is stored on the ZIP asset's `geometry_metrics` (`{ format: "zip", pack: { ignored } }`); no extra column.
4. The per-session part cap is `2 x maxPackParts` (a customer may re-upload a corrected ZIP); a single ZIP is still capped at `maxPackParts`.
5. `estimate-pack` carries `purpose` (`preview` or `submission`); the browser calls it for both, so `finalize` is rejected for ZIP assets.
6. After slicing, the pack total shown to the operator remains the submission snapshot (geometry-based unless every part was sliced at submit); the operator sees each part's slicer result in the jobs table. Re-pricing a finished slice into a new pack snapshot is out of scope.

## Global Constraints

- Only `public/` is static output; no secret enters `public/` (AGENTS.md invariant 1-2).
- Customer uploads stay private by default; extracted children are private Blob objects only (invariant 3).
- Browser estimates are non-binding; the server revalidates every field (invariant 4).
- The no-integration mode keeps a customer-recoverable request: without Neon and private Blob the ZIP travels as a normal attachment (invariants 5-6).
- Light, dark, system theme, keyboard focus, reduced motion and 390-pixel layout stay intact (invariant 7).
- Failure copy never exposes credentials or raw internal errors (invariant 8).
- Archive limits: entries `<= 256` (`PRINT_ESTIMATE_MAX_3MF_ENTRIES`), total expansion `<= 134217728` bytes (`PRINT_ESTIMATE_MAX_3MF_UNCOMPRESSED_BYTES`), each model `<= 26214400` bytes (`PRINT_ESTIMATE_MAX_BYTES`), compression ratio `<= 200`, model entries per ZIP `<= PRINT_ESTIMATE_MAX_PACK_PARTS` (default 16, max 32), part quantity 1 to 99.
- Only `.stl` and `.3mf` entries are extracted; nested archives are never opened; no entry name is ever used as a storage path, command or URL.
- Run `npm run assets:version` after editing anything under `public/` and keep `npm run validate` green. Production CSP hash does not change (no inline script is added).
- Existing STL/3MF flows are unchanged.
- Known environment note: the 9 `customize-*` unit tests and `tests/e2e/test_customize.py` fail on a clean checkout unless the customizer bundle is built; run e2e with `--ignore=tests/e2e/test_customize.py`.

## Review Focus

1. A ZIP whose entries lie about their size or CRC (declared smaller or larger than the real inflate, wrong CRC) must fail the whole pack with no children stored (Task 2, Task 5).
2. A part that cannot be measured (corrupt STL inside an otherwise valid ZIP) must not sink the pack; it shows as unavailable and cannot be selected (Task 5, Task 9).
3. Re-running `analyze` on the same ZIP must return the same pack and never create duplicate children (Task 5).
4. A `partId` from another session or another ZIP, a quantity of 0 or 100, duplicates, or an empty selection must be rejected by `estimate-pack` (Task 6).
5. Unselected children must never be attached to a request and must be deleted from Blob by the sweep; a selected child must stay downloadable by the operator and a part of a different request must not be (Task 7, Task 8).

---

### Task 1: ZIP test fixtures and directory metadata

**Files:**
- Create: `tests/support/zip-fixtures.mjs`
- Modify: `public/assets/js/print-estimation/three-mf.js` (`readZipDirectory`, export `readZipEntry`)
- Test: `tests/unit/zip-directory.test.mjs`

**Interfaces:**
- Produces: `buildZip(entries, { count }?) -> Uint8Array` where each entry is `{ name, data?, method?: "store"|"deflate", crc?, declaredSize?, compressedSize?, flags?, madeBy?, externalAttributes? }` (overrides write lying headers). `readZipDirectory(bytes, limits)` entries now also carry `crc32: number`, `isDirectory: boolean`, `special: boolean`; duplicate (NFC + case-folded) names throw `ModelAnalysisError("zip_duplicate")`. `readZipEntry(bytes, entry, budget, limits, inflateRaw)` is exported.

- [ ] **Step 1: Write the fixture helper**

Create `tests/support/zip-fixtures.mjs`:

```js
import { crc32, deflateRawSync } from "node:zlib";

const u16 = value => { const buffer = Buffer.alloc(2); buffer.writeUInt16LE(value & 0xffff); return buffer; };
const u32 = value => { const buffer = Buffer.alloc(4); buffer.writeUInt32LE(value >>> 0); return buffer; };

/**
 * Builds a ZIP archive. Entry fields override the real header values so tests can write
 * archives whose headers lie (size, CRC, flags, unix mode).
 */
export function buildZip(entries, { count } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = Buffer.from(entry.data ?? "");
    const method = entry.method === "deflate" ? 8 : 0;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(entry.name);
    const crc = entry.crc ?? crc32(raw);
    const declared = entry.declaredSize ?? raw.length;
    const compressed = entry.compressedSize ?? body.length;
    const flags = entry.flags ?? 0;
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(flags), u16(method), u16(0), u16(0), u32(crc), u32(compressed), u32(declared), u16(name.length), u16(0), name, body]);
    const central = Buffer.concat([u32(0x02014b50), u16(entry.madeBy ?? 20), u16(20), u16(flags), u16(method), u16(0), u16(0), u32(crc), u32(compressed), u32(declared), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(entry.externalAttributes ?? 0), u32(offset), name]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const directory = Buffer.concat(centrals);
  const total = count ?? entries.length;
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(total), u16(total), u32(directory.length), u32(offset), u16(0)]);
  return new Uint8Array(Buffer.concat([...locals, directory, eocd]));
}

export const UNIX_MADE_BY = (3 << 8) | 20;
export const unixMode = mode => ((mode << 16) >>> 0);
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/zip-directory.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { ModelAnalysisError, resolveModelLimits } from "../../public/assets/js/print-estimation/mesh.js";
import { readZipDirectory } from "../../public/assets/js/print-estimation/three-mf.js";
import { buildZip, UNIX_MADE_BY, unixMode } from "../support/zip-fixtures.mjs";

const limits = resolveModelLimits();

test("directory entries expose crc, directory and special-file flags", () => {
  const bytes = buildZip([
    { name: "stl/", data: "" },
    { name: "stl/a.stl", data: "solid a", method: "deflate" },
    { name: "link.stl", data: "x", madeBy: UNIX_MADE_BY, externalAttributes: unixMode(0o120777) },
    { name: "plain.stl", data: "y", madeBy: UNIX_MADE_BY, externalAttributes: unixMode(0o100644) }
  ]);
  const entries = [...readZipDirectory(bytes, limits).values()];
  assert.deepEqual(entries.map(entry => [entry.name, entry.isDirectory, entry.special]), [
    ["stl/", true, false], ["stl/a.stl", false, false], ["link.stl", false, true], ["plain.stl", false, false]
  ]);
  assert.equal(typeof entries[1].crc32, "number");
});

test("names equal under case folding or Unicode normalization are duplicates", () => {
  for (const names of [["a.stl", "A.STL"], ["caf\u00e9.stl", "cafe\u0301.stl"]]) {
    assert.throws(() => readZipDirectory(buildZip(names.map(name => ({ name, data: "x" }))), limits), error => error instanceof ModelAnalysisError && error.code === "zip_duplicate", names.join(" vs "));
  }
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test tests/unit/zip-directory.test.mjs`
Expected: FAIL (`entry.crc32`/`special` undefined, duplicate code is `malformed`).

- [ ] **Step 4: Implement the metadata**

In `public/assets/js/print-estimation/three-mf.js`, inside `readZipDirectory`, replace the per-entry block so it reads three more header fields and builds the richer entry. Change the reads:

```js
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc32 = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const madeBy = view.getUint16(cursor + 4, true);
    const externalAttributes = view.getUint32(cursor + 38, true);
    const localOffset = view.getUint32(cursor + 42, true);
```

and replace the duplicate check and `entries.set` with:

```js
    const key = name.normalize("NFC").toLowerCase();
    if (entries.has(key)) throw new ModelAnalysisError("zip_duplicate", "The archive contains duplicate entry names.");
    const unixType = (madeBy >> 8) === 3 ? ((externalAttributes >>> 16) & 0o170000) : 0;
    const special = unixType !== 0 && unixType !== 0o100000 && unixType !== 0o040000;
    entries.set(key, { name, method, crc32, compressedSize, uncompressedSize, localOffset, isDirectory: name.endsWith("/"), special });
```

Also change `async function readZipEntry(` to `export async function readZipEntry(`.

- [ ] **Step 5: Run the test and the existing geometry/3MF suites**

Run: `node --test tests/unit/zip-directory.test.mjs` then `grep -rn "duplicate entry names\|\"malformed\".*duplicate" tests | head` then `node --test tests/unit/*.test.mjs 2>&1 | grep -E "^# (pass|fail)"`
Expected: new tests PASS; if an existing test asserted the old duplicate code, update it to `zip_duplicate`; the only failures are the 9 `customize-*` environment tests.

- [ ] **Step 6: Commit**

```bash
git add tests/support/zip-fixtures.mjs tests/unit/zip-directory.test.mjs public/assets/js/print-estimation/three-mf.js
npm run assets:version
git add -A public
git commit -m "feat(print): ZIP directory exposes crc, entry type and NFC duplicate detection"
```

---

### Task 2: Shared archive inspector

**Files:**
- Create: `public/assets/js/print-estimation/archive.js`
- Modify: `public/assets/js/print-estimation/mesh.js` (add `maxPackParts: 16` to `MODEL_ANALYSIS_LIMITS`), `lib/print-estimation/geometry/analyze-model.js` (env mapping)
- Test: `tests/unit/archive-inspector.test.mjs`

**Interfaces:**
- Consumes: Task 1 `readZipDirectory`, `readZipEntry`, `buildZip`.
- Produces: `inspectArchive({ bytes, limits, inflateRaw }) -> Promise<{ models: [{ index, name, format, bytes }], ignored: [{ name, kind }] }>`; `archiveEntryKind(name) -> "image"|"document"|"source"|"archive"|"other"`; `crc32(bytes) -> number`; `isArchiveName(name) -> boolean`. Throws `ModelAnalysisError` with codes `zip_limit`, `zip_unsafe_path`, `zip_duplicate`, `zip_encrypted`, `zip_unsupported`, `malformed`, `no_models`, `too_many_parts`. `serverModelLimits()` now honors `PRINT_ESTIMATE_MAX_PACK_PARTS` (capped at 32).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/archive-inspector.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { archiveEntryKind, crc32, inspectArchive, isArchiveName } from "../../public/assets/js/print-estimation/archive.js";
import { resolveModelLimits } from "../../public/assets/js/print-estimation/mesh.js";
import { nodeInflateRaw } from "../../lib/print-estimation/geometry/analyze-model.js";
import { buildZip, UNIX_MADE_BY, unixMode } from "../support/zip-fixtures.mjs";

const limits = resolveModelLimits();
const inspect = (bytes, overrides = {}) => inspectArchive({ bytes, limits: resolveModelLimits(overrides), inflateRaw: nodeInflateRaw });
const stl = (name, extra = {}) => ({ name, data: `solid ${name}\nendsolid ${name}`, method: "deflate", ...extra });

test("a clean pack yields its models and lists everything else as ignored", async () => {
  const bytes = buildZip([
    { name: "stl/", data: "" }, stl("stl/base.stl"), stl("stl/lid.STL"),
    { name: "views/1.png", data: "png" }, { name: "ASSEMBLY.md", data: "# hi" }, { name: "pack.scad", data: "cube(1);" }, { name: "inner.zip", data: "PK" }
  ]);
  const { models, ignored } = await inspect(bytes);
  assert.deepEqual(models.map(model => [model.index, model.name, model.format]), [[0, "stl/base.stl", "stl"], [1, "stl/lid.STL", "stl"]]);
  assert.deepEqual(ignored.map(entry => [entry.name, entry.kind]), [["views/1.png", "image"], ["ASSEMBLY.md", "document"], ["pack.scad", "source"], ["inner.zip", "archive"]]);
  assert.match(new TextDecoder().decode(models[0].bytes), /solid stl\/base\.stl/);
});

test("symlinks and special files are skipped, never extracted", async () => {
  const bytes = buildZip([stl("ok.stl"), { name: "link.stl", data: "target", madeBy: UNIX_MADE_BY, externalAttributes: unixMode(0o120777) }]);
  const { models, ignored } = await inspect(bytes);
  assert.deepEqual(models.map(model => model.name), ["ok.stl"]);
  assert.deepEqual(ignored, [{ name: "link.stl", kind: "special" }]);
});

const refusals = [
  ["parent traversal", () => buildZip([stl("../evil.stl")]), "zip_unsafe_path"],
  ["absolute path", () => buildZip([stl("/abs.stl")]), "zip_unsafe_path"],
  ["backslash path", () => buildZip([stl("a\\b.stl")]), "zip_unsafe_path"],
  ["drive letter", () => buildZip([stl("C:evil.stl")]), "zip_unsafe_path"],
  ["dot segment", () => buildZip([stl("a/./b.stl")]), "zip_unsafe_path"],
  ["control character", () => buildZip([stl("a\u0000.stl")]), "zip_unsafe_path"],
  ["duplicate by case", () => buildZip([stl("a.stl"), stl("A.stl")]), "zip_duplicate"],
  ["encrypted entry", () => buildZip([stl("a.stl", { flags: 1 })]), "zip_encrypted"],
  ["no models", () => buildZip([{ name: "readme.md", data: "x" }]), "no_models"],
  ["crc mismatch", () => buildZip([stl("a.stl", { crc: 1 })]), "malformed"],
  ["declared size too small (bomb liar)", () => buildZip([{ name: "a.stl", data: "x".repeat(5000), method: "deflate", declaredSize: 10 }]), "zip_limit"],
  ["declared size too large", () => buildZip([{ name: "a.stl", data: "abc", method: "deflate", declaredSize: 4000 }]), "malformed"],
  ["compression-ratio bomb", () => buildZip([{ name: "a.stl", data: Buffer.alloc(12 * 1024 * 1024), method: "deflate" }]), "zip_limit"],
  ["truncated archive", () => buildZip([stl("a.stl")]).slice(0, -12), "malformed"]
];
for (const [label, build, code] of refusals) {
  test(`refuses the whole archive: ${label}`, async () => {
    await assert.rejects(inspect(build()), error => error.name === "ModelAnalysisError" && error.code === code, label);
  });
}

test("entry-count, part-count, model-size and total-expansion limits", async () => {
  const many = Array.from({ length: 257 }, (_, index) => ({ name: `p${index}.stl`, data: "x" }));
  await assert.rejects(inspect(buildZip(many)), error => error.code === "zip_limit");
  const parts = Array.from({ length: 17 }, (_, index) => stl(`p${index}.stl`));
  await assert.rejects(inspect(buildZip(parts)), error => error.code === "too_many_parts");
  assert.equal((await inspect(buildZip(parts.slice(0, 16)))).models.length, 16);
  await assert.rejects(inspect(buildZip([stl("a.stl")]), { maxModelBytes: 5 }), error => error.code === "zip_limit");
  await assert.rejects(inspect(buildZip([stl("a.stl"), stl("b.stl")]), { maxZipUncompressedBytes: 40 }), error => error.code === "zip_limit");
});

test("crc32, kinds and archive names", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(archiveEntryKind("x.JPG"), "image");
  assert.equal(archiveEntryKind("x.bin"), "other");
  assert.equal(isArchiveName("Pack.ZIP"), true);
  assert.equal(isArchiveName("model.3mf"), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/unit/archive-inspector.test.mjs`
Expected: FAIL (module `archive.js` not found).

- [ ] **Step 3: Add the limit**

In `mesh.js`, add `maxPackParts: 16,` after `maxModelParts: 16,` in `MODEL_ANALYSIS_LIMITS`. In `analyze-model.js` add to `ENV_LIMITS`: `maxPackParts: "PRINT_ESTIMATE_MAX_PACK_PARTS"` and change `serverModelLimits` to cap it:

```js
export function serverModelLimits(env = process.env) {
  const overrides = {};
  for (const [key, name] of Object.entries(ENV_LIMITS)) if (env[name]) overrides[key] = Number(env[name]);
  if (overrides.maxPackParts) overrides.maxPackParts = Math.min(32, Math.floor(overrides.maxPackParts));
  return resolveModelLimits(overrides);
}
```

- [ ] **Step 4: Write the inspector**

Create `public/assets/js/print-estimation/archive.js`:

```js
import { modelFormat } from "./geometry.js";
import { ModelAnalysisError } from "./mesh.js";
import { readZipDirectory, readZipEntry } from "./three-mf.js";

// Shared, dependency-free ZIP model-pack inspector (browser and server run the same rules).
// Entries are untrusted: only the central directory is believed, only STL/3MF entries are
// inflated (each with a hard output bound), and the first violation fails the whole archive.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let index = 0; index < bytes.length; index++) c = CRC_TABLE[(c ^ bytes[index]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const KINDS = [
  ["image", /\.(png|jpe?g|gif|webp|svg|bmp)$/i],
  ["document", /\.(md|txt|pdf|docx?|rtf)$/i],
  ["source", /\.(scad|step|stp|f3d|fcstd|py|js|json|ini|gcode)$/i],
  ["archive", /\.(zip|7z|rar|gz|tgz|tar|bz2)$/i]
];
export function archiveEntryKind(name) {
  return KINDS.find(([, pattern]) => pattern.test(name))?.[0] ?? "other";
}
export const isArchiveName = name => /\.zip$/i.test(String(name ?? ""));

/** `inflateRaw(bytes, maxOutput)` must enforce maxOutput (Node `zlib` or browser DecompressionStream). */
export async function inspectArchive({ bytes, limits, inflateRaw }) {
  if (!(bytes instanceof Uint8Array)) throw new ModelAnalysisError("malformed", "Archive input must be bytes.");
  const entries = [...readZipDirectory(bytes, limits).values()];
  let declared = 0;
  const candidates = [];
  const ignored = [];
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    declared += entry.uncompressedSize;
    if (declared > limits.maxZipUncompressedBytes) throw new ModelAnalysisError("zip_limit", "The archive expands beyond the analysis limit.");
    if (entry.special) { ignored.push({ name: entry.name.slice(0, 255), kind: "special" }); continue; }
    const format = modelFormat(entry.name);
    if (!format) { ignored.push({ name: entry.name.slice(0, 255), kind: archiveEntryKind(entry.name) }); continue; }
    if (entry.uncompressedSize > limits.maxModelBytes) throw new ModelAnalysisError("zip_limit", "A model in the archive exceeds the size limit.");
    candidates.push({ entry, format });
  }
  if (!candidates.length) throw new ModelAnalysisError("no_models", "The archive contains no STL or 3MF models.");
  if (candidates.length > limits.maxPackParts) throw new ModelAnalysisError("too_many_parts", `The archive has ${candidates.length} models; the limit is ${limits.maxPackParts}.`);
  const budget = { remaining: limits.maxZipUncompressedBytes };
  const models = [];
  for (const [index, { entry, format }] of candidates.entries()) {
    const data = await readZipEntry(bytes, entry, budget, limits, inflateRaw);
    if (crc32(data) !== entry.crc32) throw new ModelAnalysisError("malformed", "An archive entry failed its checksum.");
    models.push({ index, name: entry.name, format, bytes: data });
  }
  return { models, ignored };
}
```

- [ ] **Step 5: Run the tests**

Run: `node --test tests/unit/archive-inspector.test.mjs`
Expected: all PASS. If "declared size too large" yields `zip_limit` instead of `malformed`, the inflate bound raised first; assert whichever the code produces ONLY if it is a refusal from `{malformed, zip_limit}` and record why in the test comment (both refuse the archive, which is the requirement).

- [ ] **Step 6: Commit**

```bash
npm run assets:version
git add -A public lib tests
git commit -m "feat(print): shared bounded ZIP model-pack inspector"
```

---

### Task 3: Migration 006 and repositories

**Files:**
- Create: `neon/migrations/006_model_packs.sql`
- Modify: `lib/print-estimation/adapters/neon-print-repository.js`, `lib/print-estimation/adapters/local-print-repository.js`
- Test: `tests/unit/model-pack-repository.test.mjs`

**Interfaces:**
- Produces on both repositories (and `assetFromRow`): asset fields `parentAssetId: string|null`, `archiveEntry: string|null`, `quantity: number`, `selected: boolean`; `createAsset(asset)` accepts optional `parentAssetId`, `archiveEntry`; `sessionUsage(sessionId) -> { assets, parts, estimates }` (`assets` counts rows with no parent); `listChildren(parentId) -> asset[]` ordered by `archiveEntry, id`; `selectParts(parentId, selections: [{ partId, quantity }]) -> asset[]` (listed children get `selected = true` and their quantity, all other children of that parent `selected = false`); `orphanedParts({ limit }) -> asset[]` (children with `selected = false`, not deleted, whose session is `attached`).

- [ ] **Step 1: Write the migration**

Create `neon/migrations/006_model_packs.sql`:

```sql
-- ZIP model packs: a ZIP asset owns extracted child assets (one per STL/3MF entry).
ALTER TABLE print_assets DROP CONSTRAINT IF EXISTS print_assets_format_check;
ALTER TABLE print_assets ADD CONSTRAINT print_assets_format_check CHECK (format IN ('stl','3mf','zip'));
ALTER TABLE print_assets ADD COLUMN IF NOT EXISTS parent_asset_id text REFERENCES print_assets(id);
ALTER TABLE print_assets ADD COLUMN IF NOT EXISTS archive_entry text CHECK (archive_entry IS NULL OR char_length(archive_entry) <= 255);
ALTER TABLE print_assets ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 99);
ALTER TABLE print_assets ADD COLUMN IF NOT EXISTS selected boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  ALTER TABLE print_assets ADD CONSTRAINT print_assets_no_self_parent CHECK (parent_asset_id IS NULL OR parent_asset_id <> id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS print_assets_parent_idx ON print_assets (parent_asset_id) WHERE parent_asset_id IS NOT NULL;
```

- [ ] **Step 2: Write the failing real-SQL test**

Create `tests/unit/model-pack-repository.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { createNeonPrintRepository } from "../../lib/print-estimation/adapters/neon-print-repository.js";

const migration = name => readFileSync(new URL(`../../neon/migrations/${name}`, import.meta.url), "utf8");

async function seeded() {
  const db = new PGlite();
  for (const file of ["001_service_requests.sql", "003_work_queue.sql", "004_print_estimation.sql", "005_print_estimate_rate_limits.sql", "006_model_packs.sql"]) await db.exec(migration(file));
  const query = async (strings, ...values) => (await db.query(strings.reduce((sql, part, index) => sql + (index ? `$${index}` : "") + part, ""), values)).rows;
  const repo = createNeonPrintRepository({ query });
  const session = await repo.createSession({ id: `est_${"a".repeat(32)}`, ownershipHash: "b".repeat(64), assumptions: {}, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  const zip = await repo.createAsset({ id: `asset_${"1".repeat(32)}`, sessionId: session.id, blobPath: `print-estimates/${session.id}/aaaaaaaaaa-pack.zip`, originalName: "pack.zip", format: "zip", contentType: null, declaredSizeBytes: 100, retentionExpiresAt: session.expiresAt });
  const child = (n, name) => repo.createAsset({ id: `asset_${String(n).repeat(32)}`, sessionId: session.id, blobPath: `print-estimates/${session.id}/bbbbbbbbb${n}-part${n}.stl`, originalName: name, format: "stl", contentType: null, declaredSizeBytes: 10, retentionExpiresAt: session.expiresAt, parentAssetId: zip.id, archiveEntry: `stl/${name}` });
  return { db, repo, session, zip, child };
}

test("children, usage counts and part selection run against real Postgres", async () => {
  const { repo, session, zip, child } = await seeded();
  const a = await child(2, "base.stl"); const b = await child(3, "lid.stl"); const c = await child(4, "panel.stl");
  assert.equal(a.parentAssetId, zip.id); assert.equal(a.archiveEntry, "stl/base.stl"); assert.equal(a.quantity, 1); assert.equal(a.selected, false);
  assert.deepEqual(await repo.sessionUsage(session.id), { assets: 1, parts: 3, estimates: 0 });
  assert.deepEqual((await repo.listChildren(zip.id)).map(row => row.archiveEntry), ["stl/base.stl", "stl/lid.stl", "stl/panel.stl"]);
  const selected = await repo.selectParts(zip.id, [{ partId: a.id, quantity: 2 }, { partId: c.id, quantity: 1 }]);
  assert.deepEqual(selected.map(row => [row.archiveEntry, row.selected, row.quantity]), [["stl/base.stl", true, 2], ["stl/lid.stl", false, 1], ["stl/panel.stl", true, 1]]);
  const again = await repo.selectParts(zip.id, [{ partId: b.id, quantity: 5 }]);
  assert.deepEqual(again.map(row => [row.selected, row.quantity]), [[false, 1], [true, 5], [false, 1]]);
});

test("orphanedParts returns only unselected children of attached sessions", async () => {
  const { db, repo, session, zip, child } = await seeded();
  const a = await child(2, "base.stl"); await child(3, "lid.stl");
  await repo.selectParts(zip.id, [{ partId: a.id, quantity: 1 }]);
  assert.deepEqual(await repo.orphanedParts({ limit: 10 }), []);
  await db.query("UPDATE print_estimate_sessions SET state = 'attached' WHERE id = $1", [session.id]);
  assert.deepEqual((await repo.orphanedParts({ limit: 10 })).map(row => row.archiveEntry), ["stl/lid.stl"]);
});

test("a session delete removes a ZIP and its children in one statement", async () => {
  const { db, repo, session, child } = await seeded();
  await child(2, "base.stl");
  await db.query("DELETE FROM print_assets WHERE estimate_session_id = $1", [session.id]);
  assert.deepEqual((await db.query("SELECT id FROM print_assets")).rows, []);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test tests/unit/model-pack-repository.test.mjs`
Expected: FAIL (`listChildren` is not a function / column missing).

- [ ] **Step 4: Implement the Neon repository changes**

In `neon-print-repository.js`:

1. `assetFromRow` add: `parentAssetId: row.parent_asset_id ?? null, archiveEntry: row.archive_entry ?? null, quantity: Number(row.quantity ?? 1), selected: Boolean(row.selected),`.
2. `sessionUsage`:

```js
    async sessionUsage(sessionId) {
      const rows = await query`SELECT (SELECT count(*) FROM print_assets WHERE estimate_session_id = ${sessionId} AND parent_asset_id IS NULL) AS assets,
          (SELECT count(*) FROM print_assets WHERE estimate_session_id = ${sessionId} AND parent_asset_id IS NOT NULL) AS parts,
          (SELECT count(*) FROM print_estimates WHERE estimate_session_id = ${sessionId}) AS estimates`;
      return { assets: Number(rows[0].assets), parts: Number(rows[0].parts), estimates: Number(rows[0].estimates) };
    },
```

3. `createAsset`:

```js
    async createAsset(asset) {
      const rows = await query`INSERT INTO print_assets (id, estimate_session_id, blob_path, original_name, format, content_type, declared_size_bytes, retention_expires_at, parent_asset_id, archive_entry)
        VALUES (${asset.id}, ${asset.sessionId}, ${asset.blobPath}, ${asset.originalName}, ${asset.format}, ${asset.contentType}, ${asset.declaredSizeBytes}, ${asset.retentionExpiresAt}::timestamptz, ${asset.parentAssetId ?? null}, ${asset.archiveEntry ?? null})
        RETURNING *`;
      return assetFromRow(rows[0]);
    },
```

4. Add after `markAssetFailed`:

```js
    async listChildren(parentId) {
      const rows = await query`SELECT * FROM print_assets WHERE parent_asset_id = ${parentId} ORDER BY archive_entry, id`;
      return rows.map(assetFromRow);
    },
    async selectParts(parentId, selections) {
      const ids = selections.map(item => item.partId);
      const quantities = Object.fromEntries(selections.map(item => [item.partId, item.quantity]));
      const rows = await query`UPDATE print_assets a SET selected = (a.id = ANY(${ids}::text[])),
          quantity = COALESCE((${json(quantities)}::jsonb ->> a.id)::int, 1), updated_at = now()
        WHERE a.parent_asset_id = ${parentId} RETURNING *`;
      return rows.map(assetFromRow).sort((x, y) => String(x.archiveEntry).localeCompare(String(y.archiveEntry)) || x.id.localeCompare(y.id));
    },
    async orphanedParts({ limit = 50 } = {}) {
      const rows = await query`SELECT a.* FROM print_assets a JOIN print_estimate_sessions s ON s.id = a.estimate_session_id
        WHERE a.parent_asset_id IS NOT NULL AND a.selected = false AND s.state = 'attached' AND a.state <> 'deleted'
        ORDER BY a.created_at, a.id LIMIT ${limit}`;
      return rows.map(assetFromRow);
    },
```

5. In `forRequest` change `LIMIT 20` to `LIMIT 40` for the assets query.

- [ ] **Step 5: Implement the local repository changes**

In `local-print-repository.js`: in `createAsset` add defaults `parentAssetId: null, archiveEntry: null, quantity: 1, selected: false` before the `...clone(asset)` spread; change `sessionUsage` to return `{ assets: <session assets with no parentAssetId>, parts: <with parentAssetId>, estimates }`; add:

```js
    async listChildren(parentId) {
      return clone((await read()).assets.filter(row => row.parentAssetId === parentId).sort((a, b) => String(a.archiveEntry).localeCompare(String(b.archiveEntry)) || a.id.localeCompare(b.id)));
    },
    selectParts(parentId, selections) {
      return mutate((state, stamp) => {
        const wanted = new Map(selections.map(item => [item.partId, item.quantity]));
        const children = state.assets.filter(row => row.parentAssetId === parentId);
        for (const row of children) Object.assign(row, { selected: wanted.has(row.id), quantity: wanted.get(row.id) ?? 1, updatedAt: stamp });
        return children.sort((a, b) => String(a.archiveEntry).localeCompare(String(b.archiveEntry)) || a.id.localeCompare(b.id));
      });
    },
    async orphanedParts({ limit = 50 } = {}) {
      const state = await read();
      const attached = new Set(state.sessions.filter(row => row.state === "attached").map(row => row.id));
      return clone(state.assets.filter(row => row.parentAssetId && !row.selected && row.state !== "deleted" && attached.has(row.sessionId)).slice(0, limit));
    },
```

- [ ] **Step 6: Run the test and the existing repository suites**

Run: `node --test tests/unit/model-pack-repository.test.mjs` then `node --test tests/unit/*.test.mjs tests/contract/*.test.mjs 2>&1 | grep -E "^# (pass|fail)"`
Expected: new tests PASS; existing suites unchanged (only the 9 environment failures). Fix `sessionUsage` consumers if a contract test asserts the exact object shape (`deepEqual({assets, estimates})` becomes `{assets, parts: 0, estimates}`).

- [ ] **Step 7: Commit**

```bash
git add neon/migrations/006_model_packs.sql lib tests
git commit -m "feat(print): migration 006 and repositories for ZIP pack children"
```

---

### Task 4: Server-side private writes

**Files:**
- Modify: `lib/blob.js`, `lib/print-estimation/adapters/blob-model-store.js`, `lib/print-estimation/adapters/local-file-store.js`
- Test: `tests/unit/model-store-put.test.mjs`

**Interfaces:**
- Produces: `putPrivateObject(pathname, bytes, contentType?)` in `lib/blob.js`; `fileStore.put(path: string, bytes: Uint8Array) -> Promise<void>` on both stores (never overwrites).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/model-store-put.test.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createBlobModelStore } from "../../lib/print-estimation/adapters/blob-model-store.js";
import { createLocalFileStore } from "../../lib/print-estimation/adapters/local-file-store.js";

const path = `print-estimates/est_${"a".repeat(32)}/abcdef0123-part1.stl`;

test("local store writes once and refuses to overwrite", async () => {
  const root = await mkdtemp(join(tmpdir(), "pack-store-"));
  try {
    const store = createLocalFileStore({ root, origin: "http://127.0.0.1:4173" });
    await store.put(path, new Uint8Array([1, 2, 3]));
    assert.deepEqual([...await store.read(path, 100)], [1, 2, 3]);
    await assert.rejects(store.put(path, new Uint8Array([9])));
    await assert.rejects(store.put("../escape.stl", new Uint8Array([1])));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("blob store delegates put to the private Blob writer", async () => {
  const calls = [];
  const store = createBlobModelStore({ store: { putPrivateObject: async (...args) => { calls.push(args); } } });
  await store.put(path, new Uint8Array([7]));
  assert.deepEqual(calls, [[path, new Uint8Array([7])]]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/unit/model-store-put.test.mjs`
Expected: FAIL (`store.put is not a function`).

- [ ] **Step 3: Implement**

`lib/blob.js`: change the import to `import { del, get, head, issueSignedToken, presignUrl, put } from "@vercel/blob";` and append:

```js
// Server-side private write of bytes the server itself produced (extracted archive parts).
export async function putPrivateObject(pathname, bytes) {
  if (!hasBlob()) throw new HttpError(503, "Private file storage is not configured.");
  try {
    await put(pathname, Buffer.from(bytes), { access: "private", addRandomSuffix: false, allowOverwrite: false });
  } catch (error) {
    console.error("Private Blob write failed.", error?.name, error?.status ?? "unknown status");
    throw new HttpError(502, "Private file storage is temporarily unavailable.");
  }
}
```

`blob-model-store.js`: add `put: (path, bytes) => store.putPrivateObject(path, bytes),` after `read`.

`local-file-store.js`: change the `node:fs/promises` import to include `writeFile` and add after `read`:

```js
    async put(path, bytes) {
      const full = target(path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, bytes, { flag: "wx" });
    },
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/unit/model-store-put.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib tests
git commit -m "feat(print): private store put for server-extracted parts"
```

---

### Task 5: ZIP upload and server-side pack analysis

**Files:**
- Modify: `lib/print-estimation/domain.js` (`MODEL_FORMATS`), `lib/print-estimation/application/estimate-session.js`
- Create: `lib/print-estimation/application/pack.js` (`presentPack`, `partDisplayName`)
- Test: `tests/unit/estimate-pack-analysis.test.mjs`

**Interfaces:**
- Consumes: Tasks 2-4 (`inspectArchive`, repository methods, `fileStore.put`).
- Produces: `MODEL_FORMATS` includes `"zip"`. `presentPack(zip, children) -> { status: "pack", pack: { assetId, filename, parts: [{ partId, name, format, state, reason?, dimensionsMm?, volumeCm3?, triangleCount?, warnings?, quantity, selected }], ignored: [{ name, kind }] }, slice: { status: "unavailable" } }`. `createEstimateSessionUseCases(...).analyze(body)` returns `presentPack(...)` for a ZIP asset (idempotent) and `{ status: "failed", reason, model, slice }` when the archive is refused.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/estimate-pack-analysis.test.mjs`. It uses the real local repository and local file store (temp dir) so no mocks hide behavior:

```js
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createEstimateSessionUseCases } from "../../lib/print-estimation/application/estimate-session.js";
import { createLocalFileStore } from "../../lib/print-estimation/adapters/local-file-store.js";
import { createLocalPrintRepository } from "../../lib/print-estimation/adapters/local-print-repository.js";
import { serverModelLimits } from "../../lib/print-estimation/geometry/analyze-model.js";
import { buildZip } from "../support/zip-fixtures.mjs";

// A closed 10 mm cube as ASCII STL (12 triangles).
const cube = name => {
  const v = [[0,0,0],[10,0,0],[10,10,0],[0,10,0],[0,0,10],[10,0,10],[10,10,10],[0,10,10]];
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  const facets = f.map(t => `facet normal 0 0 0\nouter loop\n${t.map(i => `vertex ${v[i].join(" ")}`).join("\n")}\nendloop\nendfacet`).join("\n");
  return `solid ${name}\n${facets}\nendsolid ${name}\n`;
};

async function harness(zipBytes) {
  const root = await mkdtemp(join(tmpdir(), "pack-analysis-"));
  const fileStore = createLocalFileStore({ root, origin: "http://127.0.0.1:4173" });
  const repository = createLocalPrintRepository({ path: join(root, "state.json"), workLookup: async () => null });
  const useCases = createEstimateSessionUseCases({ repository, fileStore, materialCosts: { materialCost: async () => ({ source: "fallback", landedCentsPerKg: 2000 }) }, limits: serverModelLimits() });
  const created = await useCases.create({});
  // The browser PUTs to the signed URL; here the same bytes are written straight to the authorized path.
  const upload = async bytes => {
    const auth = await useCases.authorizeUpload({ ...created, filename: "pack.zip", size: bytes.length, contentType: "application/zip" });
    await fileStore.put((await repository.findAsset(auth.assetId)).blobPath, bytes);
    return auth.assetId;
  };
  const assetId = await upload(zipBytes);
  return { root, fileStore, repository, useCases, created, assetId, upload, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("a ZIP upload is authorized and analyzed into measured child parts", async () => {
  const zip = buildZip([{ name: "stl/", data: "" }, { name: "stl/a.stl", data: cube("a"), method: "deflate" }, { name: "stl/b.stl", data: cube("b"), method: "deflate" }, { name: "views/1.png", data: "png" }]);
  const h = await harness(zip);
  try {
    const first = await h.useCases.analyze({ ...h.created, assetId: h.assetId });
    assert.equal(first.status, "pack");
    assert.deepEqual(first.pack.parts.map(part => [part.name, part.format, part.state, part.quantity, part.selected]), [["stl/a.stl", "stl", "ready", 1, false], ["stl/b.stl", "stl", "ready", 1, false]]);
    assert.deepEqual(first.pack.parts[0].dimensionsMm, [10, 10, 10]);
    assert.deepEqual(first.pack.ignored, [{ name: "views/1.png", kind: "image" }]);
    assert.equal(JSON.stringify(first).includes("print-estimates/"), false, "no private paths in the public view");
    const second = await h.useCases.analyze({ ...h.created, assetId: h.assetId });
    assert.deepEqual(second, first);
    assert.equal((await h.repository.listChildren(h.assetId)).length, 2, "re-analysis never duplicates children");
  } finally { await h.cleanup(); }
});

test("a refused archive fails the pack and stores no children", async () => {
  const zip = buildZip([{ name: "../evil.stl", data: cube("x") }]);
  const h = await harness(zip);
  try {
    const result = await h.useCases.analyze({ ...h.created, assetId: h.assetId });
    assert.equal(result.status, "failed");
    assert.equal((await h.repository.listChildren(h.assetId)).length, 0);
    assert.equal((await h.repository.findAsset(h.assetId)).state, "failed");
  } finally { await h.cleanup(); }
});

test("one corrupt part is reported unavailable without sinking the pack", async () => {
  const zip = buildZip([{ name: "good.stl", data: cube("g"), method: "deflate" }, { name: "bad.stl", data: "not a mesh", method: "deflate" }]);
  const h = await harness(zip);
  try {
    const result = await h.useCases.analyze({ ...h.created, assetId: h.assetId });
    assert.equal(result.status, "pack");
    assert.deepEqual(result.pack.parts.map(part => [part.name, part.state]), [["bad.stl", "failed"], ["good.stl", "ready"]]);
  } finally { await h.cleanup(); }
});

test("a session cannot accumulate more than twice the pack part limit", async () => {
  const many = n => buildZip(Array.from({ length: n }, (_, i) => ({ name: `p${i}.stl`, data: cube(`p${i}`), method: "deflate" })));
  const h = await harness(many(16));
  try {
    assert.equal((await h.useCases.analyze({ ...h.created, assetId: h.assetId })).status, "pack");
    const second = await h.upload(many(16));
    assert.equal((await h.useCases.analyze({ ...h.created, assetId: second })).status, "pack", "32 parts is within 2 x 16");
    const third = await h.upload(many(1));
    assert.equal((await h.useCases.analyze({ ...h.created, assetId: third })).status, "failed", "a 33rd part is refused");
    assert.equal((await h.repository.listChildren(third)).length, 0);
  } finally { await h.cleanup(); }
});

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/unit/estimate-pack-analysis.test.mjs`
Expected: FAIL (`.zip` is not an accepted format).

- [ ] **Step 3: Implement `pack.js`**

Create `lib/print-estimation/application/pack.js`:

```js
import { basename } from "node:path";

import { sanitizeFilename } from "../../validation.js";
import { modelSummary } from "./estimate-session.js";

/** Display-only name for an extracted part; never used for storage. */
export const partDisplayName = entryName => sanitizeFilename(basename(String(entryName).replaceAll("\\", "/")));

function presentPart(child) {
  const base = { partId: child.id, name: child.archiveEntry ?? child.originalName, format: child.format, state: child.state, quantity: child.quantity, selected: child.selected };
  if (child.state !== "ready") return { ...base, reason: "not_measurable" };
  const { dimensionsMm, volumeCm3, triangleCount, warnings } = modelSummary(child);
  return { ...base, dimensionsMm, volumeCm3, triangleCount, warnings };
}

/** Public-safe pack view: never includes Blob paths or hashes. */
export function presentPack(zip, children) {
  return {
    status: "pack",
    pack: { assetId: zip.id, filename: zip.originalName, parts: children.map(presentPart), ignored: zip.geometryMetrics?.pack?.ignored ?? [] },
    slice: { status: "unavailable" }
  };
}
```

`pack.js` imports `modelSummary` from `estimate-session.js` and Task 5 Step 5 makes `estimate-session.js` import `presentPack` from `pack.js`; ES module cycles are fine here because both only use the other at call time.

- [ ] **Step 4: Accept ZIP uploads**

In `domain.js` change `MODEL_FORMATS` to `Object.freeze(["stl", "3mf", "zip"])`. In `estimate-session.js` `authorizeUpload` change the error copy to `"Only STL, 3MF, and ZIP files can be estimated."`.

- [ ] **Step 5: Implement pack analysis in `estimate-session.js`**

Add imports:

```js
import { inspectArchive } from "../../../../public/assets/js/print-estimation/archive.js";
import { nodeInflateRaw } from "../geometry/analyze-model.js";
import { partDisplayName, presentPack } from "./pack.js";
```

Add inside `createEstimateSessionUseCases` (after `analyzeAsset`):

```js
  async function analyzePack({ session, asset }) {
    if (asset.state === "ready") return presentPack(asset, await repository.listChildren(asset.id));
    if (asset.state === "failed") return { status: "failed", reason: publicAnalysisFailure({ name: "ModelAnalysisError", code: asset.analysisErrorCode }).reason, model: { format: "zip", filename: asset.originalName }, slice: { status: "unavailable" } };
    const created = [];
    try {
      const bytes = await fileStore.read(asset.blobPath, limits.maxModelBytes);
      const { models, ignored } = await inspectArchive({ bytes, limits, inflateRaw: nodeInflateRaw });
      const usage = await repository.sessionUsage(session.id);
      if (usage.parts + models.length > limits.maxPackParts * 2) throw new ModelAnalysisError("too_many_parts", "This estimate session already has the maximum number of pack parts.");
      for (const model of models) {
        const blobPath = `print-estimates/${session.id}/${random(5).toString("hex")}-part${model.index + 1}.${model.format}`;
        await fileStore.put(blobPath, model.bytes);
        const child = await repository.createAsset({
          id: newAssetId(random), sessionId: session.id, blobPath, originalName: partDisplayName(model.name), format: model.format, contentType: null,
          declaredSizeBytes: model.bytes.length, retentionExpiresAt: session.expiresAt, parentAssetId: asset.id, archiveEntry: model.name.slice(0, 255)
        });
        created.push(child);
        await repository.markAssetUploaded(child.id, model.bytes.length);
        await analyzeAsset(await repository.findAsset(child.id));
      }
      await repository.markAssetAnalyzed(asset.id, { sha256: createHash("sha256").update(bytes).digest("hex"), metrics: { format: "zip", pack: { ignored } } });
      return presentPack(await repository.findAsset(asset.id), await repository.listChildren(asset.id));
    } catch (error) {
      for (const child of created) {
        await fileStore.delete(child.blobPath).catch(() => {});
        await repository.deleteAssetRecord(child.id).catch(() => {});
      }
      const failure = publicAnalysisFailure(error);
      logFailure(failure.code);
      const failed = await repository.markAssetFailed(asset.id, { code: failure.code, detail: error?.name === "ModelAnalysisError" ? error.message : "Unexpected archive failure." });
      return { status: "failed", reason: failure.reason, model: { format: "zip", filename: failed?.originalName ?? asset.originalName }, slice: { status: "unavailable" } };
    }
  }
```

Add `import { createHash } from "node:crypto";` (extend the existing `randomBytes` import) and `import { ModelAnalysisError } from "../geometry/analyze-model.js";` (extend the existing `analyze-model.js` import list). In `analyze`, right after `let asset = await verifyUpload(...)` insert:

```js
      if (asset.format === "zip") return analyzePack({ session, asset });
```

`finalize` for a ZIP must be refused: in `analyze` when `purpose === "submission"` and the asset is a ZIP, throw `new HttpError(400, "Use estimate-pack for ZIP packs.")` before `analyzePack`.

`publicAnalysisFailure` maps unknown codes to `analysis_unavailable`, which is the generic customer copy.

- [ ] **Step 6: Run the tests**

Run: `node --test tests/unit/estimate-pack-analysis.test.mjs tests/unit/*.test.mjs 2>&1 | grep -E "^# (pass|fail)|not ok"`
Expected: new tests PASS; no new failures. If the "corrupt part" test orders parts differently, the repository sorts by `archive_entry`, so `bad.stl` precedes `good.stl`.

- [ ] **Step 7: Commit**

```bash
git add lib tests
git commit -m "feat(print): accept ZIP packs and extract measured child parts server-side"
```

---

### Task 6: Pack estimate (rollup, `estimate-pack`, handler, status)

**Files:**
- Create: `lib/print-estimation/application/estimate-pack.js`
- Modify: `lib/print-estimation/application/estimate-session.js`, `lib/print-estimation/handler.js`
- Test: `tests/unit/estimate-pack.test.mjs`

**Interfaces:**
- Consumes: Task 5 `presentPack`; Task 3 `selectParts`, `listChildren`; existing `composePrintEstimate`, `presentPublicEstimate`, `sliceStatus`, `estimateRow`, `estimateProductionFromGeometry`.
- Produces: `rollUpPackProduction({ parts, options }) -> { source, gramsPerUnit, hoursPerUnit, plates, totalGrams, totalHours }` where each part is `{ asset, quantity, slicerProduction: null | { gramsPerUnit, hoursPerUnit } }`; `estimatePack({ repository, materialCosts, slicerEnabled, now, session, zip, selections, options, purpose, persist }) -> publicView` (`{ ...presentPublicEstimate, pack }`); use case `estimatePack(body)` and handler action `"estimate-pack"` with body `{ action, sessionId, token, assetId, selections: [{ partId, quantity }], options, purpose? }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/estimate-pack.test.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createEstimateSessionUseCases } from "../../lib/print-estimation/application/estimate-session.js";
import { rollUpPackProduction } from "../../lib/print-estimation/application/estimate-pack.js";
import { createLocalFileStore } from "../../lib/print-estimation/adapters/local-file-store.js";
import { createLocalPrintRepository } from "../../lib/print-estimation/adapters/local-print-repository.js";
import { serverModelLimits, estimateProductionFromGeometry } from "../../lib/print-estimation/geometry/analyze-model.js";
import { normalizeEstimateOptions } from "../../lib/print-estimation/domain.js";
import { buildZip } from "../support/zip-fixtures.mjs";

const cube = (name, size = 10) => {
  const v = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(p => p.map(n => n * size));
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return `solid ${name}\n${f.map(t => `facet normal 0 0 0\nouter loop\n${t.map(i => `vertex ${v[i].join(" ")}`).join("\n")}\nendloop\nendfacet`).join("\n")}\nendsolid ${name}\n`;
};

async function harness({ slicerEnabled = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pack-estimate-"));
  const fileStore = createLocalFileStore({ root, origin: "http://127.0.0.1:4173" });
  const repository = createLocalPrintRepository({ path: join(root, "state.json"), workLookup: async () => null });
  const useCases = createEstimateSessionUseCases({ repository, fileStore, materialCosts: { materialCost: async () => ({ source: "fallback", landedCentsPerKg: 2000, inventoryIds: [] }) }, slicerEnabled, limits: serverModelLimits() });
  const created = await useCases.create({});
  const zip = buildZip([{ name: "a.stl", data: cube("a", 10), method: "deflate" }, { name: "b.stl", data: cube("b", 30), method: "deflate" }]);
  const auth = await useCases.authorizeUpload({ ...created, filename: "pack.zip", size: zip.length, contentType: "application/zip" });
  await fileStore.put((await repository.findAsset(auth.assetId)).blobPath, zip);
  const pack = await useCases.analyze({ ...created, assetId: auth.assetId });
  return { root, repository, useCases, created, assetId: auth.assetId, parts: pack.pack.parts, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("rollup sums grams and hours across parts and quantities and prices one job", () => {
  const options = normalizeEstimateOptions({ quantity: 2 });
  const asset = { geometryMetrics: { volumeMm3: 1000, surfaceAreaMm2: 600, dimensionsMm: [10, 10, 10] } };
  const one = estimateProductionFromGeometry(asset.geometryMetrics, { ...options, quantity: 2 });
  const two = estimateProductionFromGeometry(asset.geometryMetrics, { ...options, quantity: 6 });
  const rolled = rollUpPackProduction({ parts: [{ asset, quantity: 1, slicerProduction: null }, { asset, quantity: 3, slicerProduction: null }], options });
  assert.equal(rolled.source, "geometry");
  assert.ok(Math.abs(rolled.totalGrams - (one.totalGrams + two.totalGrams)) < 0.02);
  assert.ok(Math.abs(rolled.totalHours - (one.totalHours + two.totalHours)) < 0.02);
  assert.equal(rolled.plates, one.plates + two.plates);
  assert.ok(Math.abs(rolled.gramsPerUnit * options.quantity - rolled.totalGrams) < 0.02);
});

test("rollup uses slicer figures only when every part has one", () => {
  const options = normalizeEstimateOptions({ quantity: 1 });
  const asset = { geometryMetrics: { volumeMm3: 1000, surfaceAreaMm2: 600, dimensionsMm: [10, 10, 10] } };
  const mixed = rollUpPackProduction({ parts: [{ asset, quantity: 1, slicerProduction: { gramsPerUnit: 5, hoursPerUnit: 1 } }, { asset, quantity: 1, slicerProduction: null }], options });
  assert.equal(mixed.source, "geometry");
  const sliced = rollUpPackProduction({ parts: [{ asset, quantity: 2, slicerProduction: { gramsPerUnit: 5, hoursPerUnit: 1 } }, { asset, quantity: 1, slicerProduction: { gramsPerUnit: 7, hoursPerUnit: 2 } }], options });
  assert.equal(sliced.source, "slicer");
  assert.equal(sliced.totalGrams, 17);
  assert.equal(sliced.totalHours, 4);
});

test("estimate-pack validates selections, persists them, and prices the selected parts", async () => {
  const h = await harness();
  try {
    const [a, b] = h.parts;
    const body = { ...h.created, assetId: h.assetId, options: {} };
    for (const selections of [[], [{ partId: a.partId, quantity: 0 }], [{ partId: a.partId, quantity: 100 }], [{ partId: a.partId, quantity: 1 }, { partId: a.partId, quantity: 1 }], [{ partId: "asset_" + "f".repeat(32), quantity: 1 }], [{ partId: a.partId, quantity: 1.5 }], "x"]) {
      await assert.rejects(h.useCases.estimatePack({ ...body, selections }), error => error.status === 400, JSON.stringify(selections));
    }
    const result = await h.useCases.estimatePack({ ...body, selections: [{ partId: a.partId, quantity: 2 }, { partId: b.partId, quantity: 1 }] });
    assert.equal(result.status, "ready");
    assert.ok(result.price.low > 0 && result.price.high >= result.price.low);
    assert.deepEqual(result.pack.parts.map(part => [part.selected, part.quantity]), [[true, 2], [true, 1]]);
    const single = await h.useCases.estimatePack({ ...body, selections: [{ partId: a.partId, quantity: 1 }] });
    assert.ok(single.production.estimatedGramsPerUnit < result.production.estimatedGramsPerUnit);
    assert.deepEqual((await h.repository.listChildren(h.assetId)).map(row => row.selected), [true, false]);
    assert.equal(JSON.stringify(result).includes("print-estimates/"), false);
  } finally { await h.cleanup(); }
});

test("estimate-pack queues one slice job per selected part when a slicer is configured", async () => {
  const h = await harness({ slicerEnabled: true });
  try {
    const [a, b] = h.parts;
    const result = await h.useCases.estimatePack({ ...h.created, assetId: h.assetId, options: {}, selections: [{ partId: b.partId, quantity: 1 }] });
    assert.equal(result.slice.status, "pending");
    assert.equal((await h.repository.listAssetJobs(b.partId)).length, 1);
    assert.equal((await h.repository.listAssetJobs(a.partId)).length, 0);
    await h.useCases.estimatePack({ ...h.created, assetId: h.assetId, options: {}, selections: [{ partId: b.partId, quantity: 1 }] });
    assert.equal((await h.repository.listAssetJobs(b.partId)).length, 1, "re-estimating never duplicates an active job");
  } finally { await h.cleanup(); }
});

test("a foreign session cannot estimate someone else's pack", async () => {
  const h = await harness();
  try {
    const other = await h.useCases.create({});
    await assert.rejects(h.useCases.estimatePack({ ...other, assetId: h.assetId, options: {}, selections: [{ partId: h.parts[0].partId, quantity: 1 }] }), error => error.status === 404);
  } finally { await h.cleanup(); }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/unit/estimate-pack.test.mjs`
Expected: FAIL (`estimate-pack.js` not found).

- [ ] **Step 3: Implement `estimate-pack.js`**

Create `lib/print-estimation/application/estimate-pack.js`:

```js
import { HttpError } from "../../http.js";
import { composePrintEstimate, presentPublicEstimate } from "../compose-estimate.js";
import { sliceProfileKey } from "../domain.js";
import { estimateProductionFromGeometry, GEOMETRY_ANALYZER } from "../geometry/analyze-model.js";
import { validateAssetId } from "../capability.js";
import { estimateRow, sliceStatus } from "./estimate-session.js";
import { presentPack } from "./pack.js";

const round2 = value => Math.round(value * 100) / 100;

/**
 * One job: parts are summed, then the pricing policy runs once on the totals. A part with a
 * slicer result contributes per-unit figures x its total quantity; otherwise geometry is used.
 * The pack is "slicer" only when every selected part was sliced.
 */
export function rollUpPackProduction({ parts, options }) {
  let totalGrams = 0; let totalHours = 0; let plates = 0;
  for (const { asset, quantity, slicerProduction } of parts) {
    const total = quantity * options.quantity;
    const layout = estimateProductionFromGeometry(asset.geometryMetrics, { ...options, quantity: total });
    if (slicerProduction) {
      totalGrams += slicerProduction.gramsPerUnit * total;
      totalHours += slicerProduction.hoursPerUnit * total;
    } else {
      totalGrams += layout.totalGrams;
      totalHours += layout.totalHours;
    }
    plates += layout.plates;
  }
  return {
    source: parts.every(part => part.slicerProduction) ? "slicer" : "geometry",
    gramsPerUnit: round2(totalGrams / options.quantity),
    hoursPerUnit: round2(totalHours / options.quantity),
    plates: Math.max(1, plates),
    totalGrams: round2(totalGrams),
    totalHours: round2(totalHours)
  };
}

export function validateSelections(selections, children) {
  if (!Array.isArray(selections) || selections.length < 1 || selections.length > children.length) throw new HttpError(400, "Choose at least one part to print.");
  const byId = new Map(children.map(child => [child.id, child]));
  const seen = new Set();
  return selections.map(item => {
    if (!item || typeof item !== "object") throw new HttpError(400, "A part selection is invalid.");
    const partId = validateAssetId(item.partId);
    const child = byId.get(partId);
    if (!child || child.state !== "ready") throw new HttpError(400, "That part is not part of this pack or could not be measured.");
    if (seen.has(partId)) throw new HttpError(400, "A part can only be selected once.");
    seen.add(partId);
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) throw new HttpError(400, "Part quantity must be a whole number from 1 to 99.");
    return { partId, quantity: item.quantity };
  });
}

async function sliceProductionFor({ repository, asset, options }) {
  const job = (await repository.listAssetJobs(asset.id)).find(candidate => candidate.jobType === "slice" && candidate.profileKey === sliceProfileKey(options) && candidate.state === "ready" && candidate.resultEstimateId);
  const production = job ? (await repository.findEstimate(job.resultEstimateId))?.input?.production : null;
  return production ? { gramsPerUnit: production.gramsPerUnit, hoursPerUnit: production.hoursPerUnit } : null;
}

export async function estimatePack({ repository, materialCosts, slicerEnabled, now, session, zip, selections, options, purpose = "preview", persist = true }) {
  const chosen = validateSelections(selections, await repository.listChildren(zip.id));
  const children = persist ? await repository.selectParts(zip.id, chosen) : (await repository.listChildren(zip.id)).map(child => ({ ...child, selected: chosen.some(item => item.partId === child.id), quantity: chosen.find(item => item.partId === child.id)?.quantity ?? 1 }));
  const jobOptions = { ...options, quantity: 1 };
  const parts = [];
  const states = [];
  for (const child of children.filter(row => row.selected)) {
    let slice = await sliceStatus({ repository, asset: child, options: jobOptions, slicerEnabled });
    if (persist && slicerEnabled && ["not_requested", "failed", "cancelled"].includes(slice.status)) {
      await repository.enqueueJob({ assetId: child.id, jobType: "slice", profileKey: sliceProfileKey(options), options: jobOptions });
      slice = { status: "pending" };
    }
    states.push(slice.status);
    parts.push({ asset: child, quantity: child.quantity, slicerProduction: slice.status === "ready" ? await sliceProductionFor({ repository, asset: child, options: jobOptions }) : null });
  }
  const production = rollUpPackProduction({ parts, options });
  const estimate = composePrintEstimate({ options, production, materialCost: await materialCosts.materialCost(options.material), now: now() });
  const packSlice = !slicerEnabled ? { status: "unavailable" }
    : states.every(state => state === "ready") ? { status: "ready", production: { estimatedGramsPerUnit: Math.round(production.gramsPerUnit * 10) / 10, estimatedHoursPerUnit: Math.round(production.hoursPerUnit * 10) / 10 } }
    : states.some(state => ["pending", "processing", "not_requested"].includes(state)) ? { status: "pending" } : { status: "failed" };
  const summary = { format: "zip", filename: zip.originalName, parts: children.length, selectedParts: parts.length };
  const view = { ...presentPublicEstimate({ status: "ready", estimate, modelSummary: summary, slice: packSlice }), pack: presentPack(zip, children).pack };
  if (persist) {
    await repository.insertEstimate(estimateRow({
      estimate, publicView: view, session, asset: zip, purpose, engine: GEOMETRY_ANALYZER.engine, engineVersion: GEOMETRY_ANALYZER.version,
      profileId: `pack:${sliceProfileKey(options)}`, geometry: { pack: { parts: chosen } }
    }));
  }
  return view;
}
```

- [ ] **Step 4: Wire the use case, status and handler**

In `estimate-session.js` add `import { estimatePack as estimatePackFor } from "./estimate-pack.js";` and inside the returned object add (after `analyze`):

```js
    async estimatePack(body = {}) {
      const session = await ownedSession(body.sessionId, body.token);
      const options = normalizeEstimateOptions(body.options ?? session.assumptions ?? {});
      const zip = await verifyUpload(await ownedAsset(session, body.assetId));
      if (zip.format !== "zip" || zip.state !== "ready") throw new HttpError(409, "The pack has not been analyzed yet.");
      const usage = await repository.sessionUsage(session.id);
      if (usage.estimates >= policy.maxEstimatesPerSession) throw new HttpError(429, "This estimate session has reached its limit. Submit the request or start again.");
      const purpose = body.purpose === "submission" ? "submission" : "preview";
      return estimatePackFor({ repository, materialCosts, slicerEnabled, now, session, zip, selections: body.selections, options, purpose });
    },
```

Update `status` so a pack session recomputes read-only with fresh slice results: replace its body after `if (!latest) return ...;` with:

```js
      const asset = latest.assetId ? await repository.findAsset(latest.assetId) : null;
      if (asset?.format === "zip" && latest.geometry?.pack?.parts) {
        const view = await estimatePackFor({ repository, materialCosts, slicerEnabled, now, session, zip: asset, selections: latest.geometry.pack.parts, options: latest.input.options, persist: false });
        return { ...view, slice: view.slice };
      }
      return { ...latest.public, slice: await sliceStatus({ repository, asset, options: latest.input.options, slicerEnabled }) };
```

In `handler.js` add to `ACTIONS`: `"estimate-pack": ["action", "sessionId", "token", "assetId", "selections", "options", "purpose"],` and replace the final `else sendJson(...)` with:

```js
      else if (body.action === "estimate-pack") sendJson(res, 200, await estimates.estimatePack(body));
      else sendJson(res, 200, await estimates.analyze(body, { purpose: body.action === "finalize" ? "submission" : "preview" }));
```

Raise the handler request body bound from `16 * 1024` only if selections can exceed it: 16 parts x ~70 bytes fits; leave it.

- [ ] **Step 5: Run the tests**

Run: `node --test tests/unit/estimate-pack.test.mjs tests/unit/*.test.mjs tests/contract/*.test.mjs 2>&1 | grep -E "^# (pass|fail)|not ok"`
Expected: new tests PASS; only the 9 environment failures remain. If a contract test enumerates handler actions, extend it with `estimate-pack`.

- [ ] **Step 6: Commit**

```bash
git add lib tests
git commit -m "feat(print): pack estimate rollup, estimate-pack action, per-part slice jobs"
```

---

### Task 7: Submit attachment and retention for packs

**Files:**
- Modify: `lib/work-management/adapters/neon-work-repository.js`, `lib/print-estimation/adapters/neon-print-repository.js` (`attachSession`), `lib/print-estimation/adapters/local-print-repository.js` (`attachSession`), `lib/print-estimation/application/retention.js`
- Test: `tests/unit/model-pack-attachment.test.mjs`

**Interfaces:**
- Produces: attachment attaches ZIP assets and **selected** children only (`parent_asset_id IS NULL OR selected`); the retention `sweep()` report gains `orphanedParts` and removes Blob objects and marks unselected children of attached sessions `deleted`.

- [ ] **Step 1: Write the failing real-SQL test**

Create `tests/unit/model-pack-attachment.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { createNeonPrintRepository } from "../../lib/print-estimation/adapters/neon-print-repository.js";
import { createRetentionUseCases } from "../../lib/print-estimation/application/retention.js";

const migration = name => readFileSync(new URL(`../../neon/migrations/${name}`, import.meta.url), "utf8");

async function seeded() {
  const db = new PGlite();
  for (const file of ["001_service_requests.sql", "003_work_queue.sql", "004_print_estimation.sql", "005_print_estimate_rate_limits.sql", "006_model_packs.sql"]) await db.exec(migration(file));
  const query = async (strings, ...values) => (await db.query(strings.reduce((sql, part, index) => sql + (index ? `$${index}` : "") + part, ""), values)).rows;
  const repo = createNeonPrintRepository({ query });
  await db.query("INSERT INTO service_requests (id, status, service, project_title, contact_name, contact_email, payload) VALUES ('3DP-1','submitted','print','T','N','e@x.co','{}')");
  const session = await repo.createSession({ id: `est_${"a".repeat(32)}`, ownershipHash: "b".repeat(64), assumptions: {}, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  const zip = await repo.createAsset({ id: `asset_${"1".repeat(32)}`, sessionId: session.id, blobPath: `print-estimates/${session.id}/aaaaaaaaaa-pack.zip`, originalName: "pack.zip", format: "zip", contentType: null, declaredSizeBytes: 100, retentionExpiresAt: session.expiresAt });
  await repo.markAssetUploaded(zip.id, 100);
  const kids = [];
  for (const n of [2, 3]) {
    const row = await repo.createAsset({ id: `asset_${String(n).repeat(32)}`, sessionId: session.id, blobPath: `print-estimates/${session.id}/bbbbbbbbb${n}-part${n}.stl`, originalName: `p${n}.stl`, format: "stl", contentType: null, declaredSizeBytes: 10, retentionExpiresAt: session.expiresAt, parentAssetId: zip.id, archiveEntry: `p${n}.stl` });
    await repo.markAssetUploaded(row.id, 10); kids.push(row);
  }
  await repo.selectParts(zip.id, [{ partId: kids[0].id, quantity: 1 }]);
  return { db, repo, session, zip, kids };
}

test("attachSession attaches the ZIP and selected parts only", async () => {
  const { db, repo, session, zip, kids } = await seeded();
  const result = await repo.attachSession({ sessionId: session.id, ownershipHash: "b".repeat(64), requestId: "3DP-1" });
  assert.equal(result.attached, true);
  const rows = (await db.query("SELECT id, request_id FROM print_assets ORDER BY id")).rows;
  assert.deepEqual(rows.map(row => [row.id, row.request_id]), [[zip.id, "3DP-1"], [kids[0].id, "3DP-1"], [kids[1].id, null]]);
});

test("the sweep deletes unselected parts of attached sessions, objects first", async () => {
  const { repo, session, zip, kids } = await seeded();
  await repo.attachSession({ sessionId: session.id, ownershipHash: "b".repeat(64), requestId: "3DP-1" });
  const deleted = [];
  const retention = createRetentionUseCases({ repository: repo, fileStore: { delete: async path => { deleted.push(path); } } });
  const report = await retention.sweep();
  assert.equal(report.orphanedParts, 1);
  assert.deepEqual(deleted, [kids[1].blobPath]);
  assert.equal((await repo.findAsset(kids[1].id)).state, "deleted");
  assert.notEqual((await repo.findAsset(kids[0].id)).state, "deleted");
  assert.notEqual((await repo.findAsset(zip.id)).state, "deleted");
  assert.equal((await retention.sweep()).orphanedParts, 0);
});
```

The work-repository statement (`completeWithEstimateAttachment`) is exercised in Step 4 by the same migration chain through the existing work-store tests plus the added assertion below.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/unit/model-pack-attachment.test.mjs`
Expected: FAIL (unselected child gets attached; `report.orphanedParts` undefined).

- [ ] **Step 3: Implement attachment filters and the sweep**

In `neon-print-repository.js` `attachSession`, change the `assets` CTE condition to:

```sql
          WHERE estimate_session_id IN (SELECT id FROM attached) AND state IN ('uploaded','ready','failed')
            AND (parent_asset_id IS NULL OR selected = true) RETURNING id
```

In `neon-work-repository.js` `completeWithEstimateAttachment`, change the `attached_assets` condition to:

```sql
        WHERE a.estimate_session_id = attached_session.id AND a.state IN ('uploaded','ready','failed')
          AND (a.parent_asset_id IS NULL OR a.selected = true)
```

In `local-print-repository.js` `attachSession`, change the asset loop filter to add `&& (!row.parentAssetId || row.selected)`.

In `retention.js` `sweep`, add `orphanedParts: 0` to `report` and, before the `pruneRateBuckets` block:

```js
      for (const asset of await repository.orphanedParts({ limit })) {
        if (await removeObject(asset, report) && await repository.markAssetDeleted(asset.id)) report.orphanedParts += 1;
      }
```

- [ ] **Step 4: Cover the work-repository statement**

Append to `tests/unit/model-pack-attachment.test.mjs` a test that applies `001`-`006` plus runs `createNeonWorkRepository({ query }).completeRequestWithWork(...)` with an attachment for the seeded session and asserts the same attached set. Read `lib/work-management/adapters/neon-work-repository.js` `completeRequestWithWork` for its argument shape (`(id, request, files, attachment?)`) and the draft-request prerequisite (`service_requests.status = 'draft'`): seed the request as `draft` for this test instead of `submitted`.

```js
import { createNeonWorkRepository } from "../../lib/work-management/adapters/neon-work-repository.js";

test("request completion attaches the ZIP and selected parts in the single completion statement", async () => {
  const { db, session, zip, kids } = await seeded();
  await db.query("UPDATE service_requests SET status = 'draft' WHERE id = '3DP-1'");
  const query = async (strings, ...values) => (await db.query(strings.reduce((sql, part, index) => sql + (index ? `$${index}` : "") + part, ""), values)).rows;
  const work = createNeonWorkRepository({ query });
  const result = await work.completeRequestWithWork("3DP-1", { service: "print", projectTitle: "T", contact: { name: "N", email: "e@x.co" } }, [], { sessionId: session.id, ownershipHash: "b".repeat(64) });
  assert.equal(result.printEstimate.attached, true);
  assert.equal(result.printEstimate.assets, 2);
  const rows = (await db.query("SELECT id, request_id FROM print_assets ORDER BY id")).rows;
  assert.deepEqual(rows.map(row => [row.id, row.request_id]), [[zip.id, "3DP-1"], [kids[0].id, "3DP-1"], [kids[1].id, null]]);
});
```

If `completeRequestWithWork` takes the attachment differently, adapt the call to the real signature (read the function; it routes to `completeWithEstimateAttachment` when an attachment is present); keep the assertions.

- [ ] **Step 5: Run the tests**

Run: `node --test tests/unit/model-pack-attachment.test.mjs tests/unit/*.test.mjs 2>&1 | grep -E "^# (pass|fail)|not ok"`
Expected: PASS; existing retention/attachment tests unchanged.

- [ ] **Step 6: Commit**

```bash
git add lib tests
git commit -m "feat(print): attach selected pack parts only; sweep unselected parts"
```

---

### Task 8: Operator view and pack section

**Files:**
- Modify: `lib/print-estimation/application/operator-view.js`, `operator/assets/print-detail.js`, `operator/assets/operator.css`
- Test: `tests/unit/operator-pack-view.test.mjs`, extend `tests/e2e/test_operator_print_detail.py`

**Interfaces:**
- Produces: `presentAsset` adds `parentAssetId`, `archiveEntry`, `quantity`, `selected`, and for `format === "zip"` returns `geometry: null` plus `pack: { ignored }`; `selectLatestEstimate` only pairs a slicer estimate with the base estimate when `assetId` matches; the job sheet renders pack parts under their ZIP with quantity, and the ignored files by name.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/operator-pack-view.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { createOperatorPrintView, selectLatestEstimate } from "../../lib/print-estimation/application/operator-view.js";

const asset = (id, extra = {}) => ({ id, originalName: `${id}.stl`, format: "stl", contentType: null, sizeBytes: 10, declaredSizeBytes: 10, sha256: null, state: "ready", analysisErrorCode: null, retentionHold: false, retentionExpiresAt: null, deletedAt: null, createdAt: "2026-10-05T00:00:00.000Z", geometryMetrics: { volumeMm3: 1000, surfaceAreaMm2: 600, dimensionsMm: [10, 10, 10], triangleCount: 12, unit: "mm", warnings: [] }, parentAssetId: null, archiveEntry: null, quantity: 1, selected: false, ...extra });

test("operator view presents the ZIP without geometry and parts with quantity", async () => {
  const zip = asset("zip", { format: "zip", originalName: "pack.zip", geometryMetrics: { format: "zip", pack: { ignored: [{ name: "views/1.png", kind: "image" }] } } });
  const part = asset("part1", { parentAssetId: "zip", archiveEntry: "stl/base.stl", quantity: 3, selected: true });
  const repository = { forRequest: async () => ({ assets: [zip, part], estimates: [], jobs: [], runs: [] }) };
  const result = await createOperatorPrintView({ repository }).forWork({ item: { id: "work_12345678", requestId: "3DP-1" } });
  const [presentedZip, presentedPart] = result.assets;
  assert.equal(presentedZip.geometry, null);
  assert.deepEqual(presentedZip.pack, { ignored: [{ name: "views/1.png", kind: "image" }] });
  assert.deepEqual([presentedPart.parentAssetId, presentedPart.archiveEntry, presentedPart.quantity, presentedPart.selected], ["zip", "stl/base.stl", 3, true]);
  assert.equal(presentedPart.geometry.dimensionsMm[0], 10);
});

test("a part's slicer estimate is never paired with the pack's submission snapshot", () => {
  const input = { options: { material: "pla", quality: "standard", supports: "none", colors: 1 } };
  const submission = { id: "pest_1", purpose: "submission", estimatorType: "geometry", assetId: "zip", input };
  const partSlice = { id: "pest_2", purpose: "slice", estimatorType: "slicer", assetId: "part1", input };
  assert.equal(selectLatestEstimate([partSlice, submission]).id, "pest_1");
  const sameAsset = { ...partSlice, id: "pest_3", assetId: "zip" };
  assert.equal(selectLatestEstimate([sameAsset, submission]).id, "pest_3");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/unit/operator-pack-view.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement the view changes**

In `operator-view.js`: in `selectLatestEstimate` add `row.assetId === base.assetId &&` to the slicer-estimate `find` predicate. In `presentAsset` add the four fields to the returned object and make geometry pack-aware:

```js
function presentAsset(asset) {
  const metrics = asset.geometryMetrics ?? null;
  const isPack = asset.format === "zip";
  return {
    id: asset.id, originalName: asset.originalName, format: asset.format, contentType: asset.contentType, sizeBytes: asset.sizeBytes ?? asset.declaredSizeBytes,
    sha256: asset.sha256, state: asset.state, analysisError: asset.analysisErrorCode ? { code: asset.analysisErrorCode, detail: asset.analysisErrorDetail } : null,
    parentAssetId: asset.parentAssetId ?? null, archiveEntry: asset.archiveEntry ?? null, quantity: asset.quantity ?? 1, selected: Boolean(asset.selected),
    ...(isPack ? { pack: { ignored: metrics?.pack?.ignored ?? [] } } : {}),
    geometry: metrics && !isPack ? {
      dimensionsMm: metrics.dimensionsMm, volumeCm3: round(metrics.volumeMm3 / 1000), surfaceAreaCm2: round(metrics.surfaceAreaMm2 / 100),
      triangleCount: metrics.triangleCount, unit: metrics.unit, warnings: metrics.warnings ?? [], analyzer: metrics.analyzer ?? null
    } : null,
    retention: { hold: asset.retentionHold, expiresAt: asset.retentionExpiresAt, deletedAt: asset.deletedAt },
    downloadable: ["uploaded", "ready", "failed"].includes(asset.state), createdAt: asset.createdAt
  };
}
```

- [ ] **Step 4: Render the pack in the job sheet**

In `operator/assets/print-detail.js` change `fileRows` to order ZIPs before their parts and show pack facts. Replace the loop header and meta lines:

```js
function orderPack(assets) {
  const parents = assets.filter(asset => !asset.parentAssetId);
  return parents.flatMap(parent => [parent, ...assets.filter(asset => asset.parentAssetId === parent.id)]);
}

function fileRows(assets, onDownload) {
  const list = el("ul", "print-files");
  for (const asset of orderPack(assets)) {
    const item = el("li", asset.parentAssetId ? "print-file print-file-part" : "print-file");
    const head = el("div", "print-file-head");
    head.append(el("strong", "", asset.archiveEntry ?? asset.originalName), el("span", `print-state print-state-${asset.state}`, titleCase(asset.state)));
    const g = asset.geometry;
    const meta = [asset.format.toUpperCase(), asset.parentAssetId ? `Pack part · quantity ${asset.quantity}${asset.selected ? "" : " · not selected"}` : null, bytes(asset.sizeBytes), g ? `${g.dimensionsMm.map(value => one.format(value)).join(" × ")} mm` : null, g ? `${whole.format(g.triangleCount)} triangles` : null, g ? `${one.format(g.volumeCm3)} cm³` : null].filter(Boolean).join(" · ");
    item.append(head, el("p", "print-meta", meta));
    if (asset.pack?.ignored?.length) item.append(el("p", "print-meta", `Not printed (ignored): ${asset.pack.ignored.map(entry => `${entry.name} (${entry.kind})`).join(", ")}`));
```

keep the existing lines after `meta` (analysis error, warnings, retention, download button) unchanged. Add CSS to `operator/assets/operator.css`:

```css
.print-file-part{margin-left:1.25rem;border-left:3px solid var(--teal)}
```

- [ ] **Step 5: Extend the operator e2e**

Read `tests/e2e/test_operator_print_detail.py` for its seeding style, then add a test that seeds a ZIP asset with two children through the local print repository file (the same way the existing test seeds a single asset), opens the work detail and asserts: the ZIP row shows no size/triangle text, two `.print-file-part` rows show `quantity`, the ignored list text appears, and each part row has a `Download` button. Keep the no-console-errors assertion.

- [ ] **Step 6: Run the tests**

Run: `node --test tests/unit/operator-pack-view.test.mjs` then `python -m pytest tests/e2e/test_operator_print_detail.py tests/e2e/test_operator_pwa.py -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib operator tests
git commit -m "feat(operator): pack parts, quantities and ignored files in the print section"
```

---

### Task 9: Browser: local pack reader, picker, pack estimate flow

**Files:**
- Create: `public/assets/js/print-estimation/pack.js` (local pack state), `tests/unit/browser-pack.test.mjs`
- Modify: `public/assets/js/print-estimation/geometry.js` (re-export `isArchiveName`), `controller.js`, `view.js`, `client.js`, `public/assets/js/order.js`, `public/assets/css/site.css`, `public/assets/js/config.js` (only if limits need a pack key)
- Test: unit tests as above; Python e2e in Task 10

**Interfaces:**
- Consumes: Task 2 `inspectArchive`, `isArchiveName`; Task 6 `estimate-pack` API.
- Produces: `readPackLocally({ bytes, limits, inflateRaw, analyze }) -> Promise<{ parts: [{ id, name, format, metrics | null, error | null }], ignored }>`; `packProduction(parts, selection, options) -> { gramsPerUnit, hoursPerUnit }` (rolls selected, measured parts with the same formula as the server); controller state gains `pack: null | { parts, ignored, selection: { [id]: { selected, quantity } } }` and methods `setPartSelected(id, boolean)`, `setPartQuantity(id, n)`; `client.estimatePack(body)`; private flow `estimatePack(selections)` that calls `analyze` then `estimate-pack`.

- [ ] **Step 1: Write the failing test for the local reader**

Create `tests/unit/browser-pack.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { analyzeModelBytes } from "../../public/assets/js/print-estimation/geometry.js";
import { resolveModelLimits } from "../../public/assets/js/print-estimation/mesh.js";
import { packProduction, readPackLocally } from "../../public/assets/js/print-estimation/pack.js";
import { nodeInflateRaw } from "../../lib/print-estimation/geometry/analyze-model.js";
import { buildZip } from "../support/zip-fixtures.mjs";

const cube = (name, size) => {
  const v = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(p => p.map(n => n * size));
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return `solid ${name}\n${f.map(t => `facet normal 0 0 0\nouter loop\n${t.map(i => `vertex ${v[i].join(" ")}`).join("\n")}\nendloop\nendfacet`).join("\n")}\nendsolid ${name}\n`;
};
const limits = resolveModelLimits();
const analyze = ({ name, bytes }) => analyzeModelBytes({ name, bytes, limits, inflateRaw: nodeInflateRaw });

test("reads a ZIP locally into measured parts and an ignored list", async () => {
  const bytes = buildZip([{ name: "a.stl", data: cube("a", 10), method: "deflate" }, { name: "bad.stl", data: "nope", method: "deflate" }, { name: "x.png", data: "p" }]);
  const pack = await readPackLocally({ bytes, limits, inflateRaw: nodeInflateRaw, analyze });
  assert.deepEqual(pack.parts.map(part => [part.name, part.format, Boolean(part.metrics), Boolean(part.error)]), [["a.stl", "stl", true, false], ["bad.stl", "stl", false, true]]);
  assert.deepEqual(pack.ignored, [{ name: "x.png", kind: "image" }]);
});

test("a refused archive surfaces its code and no parts", async () => {
  await assert.rejects(readPackLocally({ bytes: buildZip([{ name: "../e.stl", data: "x" }]), limits, inflateRaw: nodeInflateRaw, analyze }), error => error.code === "zip_unsafe_path");
});

test("pack production sums selected measured parts with quantities", async () => {
  const bytes = buildZip([{ name: "a.stl", data: cube("a", 10), method: "deflate" }, { name: "b.stl", data: cube("b", 20), method: "deflate" }]);
  const { parts } = await readPackLocally({ bytes, limits, inflateRaw: nodeInflateRaw, analyze });
  const options = { material: "pla", quality: "standard", colors: 1, supports: "none", quantity: 1 };
  const one = packProduction(parts, { [parts[0].id]: { selected: true, quantity: 1 }, [parts[1].id]: { selected: false, quantity: 1 } }, options);
  const both = packProduction(parts, { [parts[0].id]: { selected: true, quantity: 2 }, [parts[1].id]: { selected: true, quantity: 1 } }, options);
  assert.ok(both.gramsPerUnit > one.gramsPerUnit * 2);
  assert.equal(packProduction(parts, {}, options), null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/unit/browser-pack.test.mjs`
Expected: FAIL (`pack.js` not found).

- [ ] **Step 3: Implement `pack.js`**

Create `public/assets/js/print-estimation/pack.js`:

```js
import { inspectArchive } from "./archive.js";
import { estimateProductionFromGeometry } from "./geometry.js";

/**
 * Local (non-binding) read of a ZIP model pack for the picker and a planning range.
 * `analyze({ name, bytes })` measures one model; a part that cannot be measured stays listed
 * (not selectable) and never sinks the pack. A refused archive rejects with its ModelAnalysisError.
 */
export async function readPackLocally({ bytes, limits, inflateRaw, analyze }) {
  const { models, ignored } = await inspectArchive({ bytes, limits, inflateRaw });
  const parts = [];
  for (const model of models) {
    const id = `part-${model.index}`;
    try { parts.push({ id, name: model.name, format: model.format, metrics: await analyze({ name: model.name, bytes: model.bytes }), error: null }); }
    catch (error) { parts.push({ id, name: model.name, format: model.format, metrics: null, error: error?.code ?? "internal" }); }
  }
  return { parts, ignored };
}

/** Same rollup as the server: sum selected, measured parts x quantity x order quantity. */
export function packProduction(parts, selection, options) {
  let totalGrams = 0; let totalHours = 0; let count = 0;
  for (const part of parts) {
    const choice = selection[part.id];
    if (!choice?.selected || !part.metrics) continue;
    const production = estimateProductionFromGeometry(part.metrics, { ...options, quantity: choice.quantity * (options.quantity || 1) });
    totalGrams += production.totalGrams; totalHours += production.totalHours; count += 1;
  }
  if (!count) return null;
  const units = options.quantity || 1;
  return { gramsPerUnit: Math.round((totalGrams / units) * 100) / 100, hoursPerUnit: Math.round((totalHours / units) * 100) / 100 };
}
```

- [ ] **Step 4: Run the test**

Run: `node --test tests/unit/browser-pack.test.mjs`
Expected: PASS.

- [ ] **Step 5: Extend the controller**

In `controller.js`:

1. Import: `import { isArchiveName } from "./archive.js";` and `import { packProduction, readPackLocally } from "./pack.js";`.
2. Add to `state`: `pack: null`; include `pack: state.pack ? { parts: state.pack.parts.map(({ id, name, format, metrics, error }) => ({ id, name, format, error, dimensionsMm: metrics?.dimensionsMm ?? null, volumeMm3: metrics?.volumeMm3 ?? null })), ignored: state.pack.ignored, selection: state.pack.selection } : null` in `publicState()`.
3. In `select(file)`, reset `pack: null` in the `Object.assign`, and replace the `if (!modelFormat(file.name)) throw ...` line with `if (!modelFormat(file.name) && !isArchiveName(file.name)) throw new ModelAnalysisError("unsupported_format");`. After reading `bytes`, branch:

```js
      if (isArchiveName(file.name)) {
        const local = await readPackLocally({ bytes, limits, inflateRaw, analyze: ({ name, bytes: partBytes }) => analyze({ name, bytes: partBytes, limits, inflateRaw }) });
        if (current !== generation) return;
        const selection = Object.fromEntries(local.parts.map(part => [part.id, { selected: Boolean(part.metrics), quantity: 1 }]));
        state.pack = { ...local, selection };
        Object.assign(state, { status: "analyzed", metrics: null });
        changed();
        if (privateEstimates) await privateEstimates.start(file, { isCurrent: () => current === generation, update: patch => { if (current === generation) { Object.assign(state, patch); changed(); } }, pack: () => state.pack });
        return;
      }
```

4. `sync(files)`: candidate = `files.find(file => modelFormat(file.name) || isArchiveName(file.name))`.
5. `modelEstimate(options)`: at the top add

```js
      if (state.pack) {
        if (state.slice?.status === "ready" && state.slice.production) return { grams: state.slice.production.estimatedGramsPerUnit, hours: state.slice.production.estimatedHoursPerUnit, source: "slicer" };
        const production = packProduction(state.pack.parts, state.pack.selection, options);
        return production ? { grams: production.gramsPerUnit, hours: production.hoursPerUnit, source: "geometry" } : null;
      }
```

6. Add methods to the returned object:

```js
    setPartSelected(id, selected) { const choice = state.pack?.selection[id]; if (!choice || !state.pack.parts.find(part => part.id === id)?.metrics) return; choice.selected = Boolean(selected); state.slice = null; changed(); privateEstimates?.estimatePack?.(selectionPayload(), { isCurrent: () => true, update: patch => { Object.assign(state, patch); changed(); } }); },
    setPartQuantity(id, quantity) { const choice = state.pack?.selection[id]; if (!choice) return; choice.quantity = Math.min(99, Math.max(1, Math.round(Number(quantity)) || 1)); state.slice = null; changed(); privateEstimates?.estimatePack?.(selectionPayload(), { isCurrent: () => true, update: patch => { Object.assign(state, patch); changed(); } }); },
```

with a helper above `return`:

```js
  const selectionPayload = () => state.pack ? state.pack.parts.filter(part => state.pack.selection[part.id]?.selected).map(part => ({ localId: part.id, name: part.name, quantity: state.pack.selection[part.id].quantity })) : [];
```

- [ ] **Step 6: Client and private flow**

In `client.js` add `estimatePack: body => call("POST", { action: "estimate-pack", ...body }),` to the client. In `createPrivateEstimateFlow`:

- `start(file, { isCurrent, update, pack })` unchanged up to `client.analyze(...)`. After analyze, if `result.status === "pack"`, store `verified = { file, assetId, partIds: new Map(result.pack.parts.map(part => [part.name, part.partId])) }`, `update({ privateState: "verified" })`, then call the new local `runPackEstimate()` below and return.
- Add inside the flow: 

```js
  async function runPackEstimate(selections, { isCurrent, update }) {
    if (!verified?.partIds || !session) return;
    const mapped = selections.map(item => ({ partId: verified.partIds.get(item.name), quantity: item.quantity })).filter(item => item.partId);
    if (!mapped.length) return;
    try {
      const result = await client.estimatePack({ ...session, assetId: verified.assetId, options: getOptions(), selections: mapped });
      if (!isCurrent()) return;
      update({ slice: result.slice ?? null, serverEstimate: { price: result.price, production: result.production } });
      if (["pending", "processing"].includes(result.slice?.status)) schedulePoll(update, isCurrent);
    } catch { /* keep the local planning range */ }
  }
```

and expose `estimatePack: (selections, hooks) => runPackEstimate(selections, hooks)` in the returned flow; in `start`, after a successful pack analyze call `await runPackEstimate(initialSelections, { isCurrent, update })` where `initialSelections` is `pack().parts` mapped through `pack().selection` (selected, quantity) passed in via the new `pack` hook argument. In `finalize()` for a pack call `client.estimatePack({ ...session, assetId, options, selections, purpose: "submission" })` with the current selections (store the last `mapped` array in the closure as `lastSelections`) instead of `client.finalize`.

In `order.js` extend `privateEstimates` with `estimatePack: (selections, hooks) => privateEstimateFlow?.estimatePack(selections, hooks)`.

- [ ] **Step 7: Picker UI**

In `view.js` `render`, inside the `state.status === "analyzed"` branch, when `state.pack` is set render the picker instead of the single-model facts:

```js
      if (state.status === "analyzed" && state.pack) {
        const fieldset = el("fieldset", "pack-picker");
        fieldset.append(el("legend", "", `Choose parts to print (${state.pack.parts.length} found in this pack)`));
        for (const part of state.pack.parts) {
          const row = el("div", "pack-part");
          const choice = state.pack.selection[part.id];
          const check = el("input"); check.type = "checkbox"; check.id = `pack-${part.id}`; check.checked = Boolean(choice?.selected); check.disabled = Boolean(part.error);
          check.dataset.partId = part.id; check.dataset.packAction = "select";
          const label = el("label", "", part.name); label.htmlFor = check.id;
          const qty = el("input"); qty.type = "number"; qty.min = "1"; qty.max = "99"; qty.value = String(choice?.quantity ?? 1); qty.id = `pack-qty-${part.id}`; qty.disabled = Boolean(part.error) || !choice?.selected;
          qty.dataset.partId = part.id; qty.dataset.packAction = "quantity"; qty.setAttribute("aria-label", `Quantity of ${part.name}`);
          const meta = el("span", "pack-part-meta", part.error ? "Could not be measured — a person will review it" : `${part.dimensionsMm.map(value => modelPanelNumber.format(value)).join(" × ")} mm · ${modelPanelNumber.format(part.volumeMm3 / 1000)} cm³`);
          row.append(check, label, qty, meta);
          fieldset.append(row);
        }
        children.push(fieldset);
        if (state.pack.ignored.length) children.push(el("p", "model-status", `Not printed: ${state.pack.ignored.map(entry => entry.name).join(", ")}`));
        children.push(el("p", "model-status", "Measured from geometry — this is not a slice. The operator confirms the final price."));
      } else if (state.status === "analyzed" && state.metrics) {
```

(turn the existing `if (state.status === "analyzed" && state.metrics) {` into the `else if` above). In `order.js` after creating `modelPanel`, delegate events once on the card:

```js
document.querySelector("#model-card").addEventListener("change", event => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.dataset.packAction) return;
  if (target.dataset.packAction === "select") modelEstimates.setPartSelected(target.dataset.partId, target.checked);
  else modelEstimates.setPartQuantity(target.dataset.partId, target.value);
});
```

Add CSS to `public/assets/css/site.css` (use existing tokens; check `.model-card` rules for names): `.pack-picker{border:1px solid var(--line);border-radius:10px;padding:.75rem 1rem;margin:.75rem 0}.pack-part{display:grid;grid-template-columns:auto 1fr auto;gap:.4rem .75rem;align-items:center;padding:.4rem 0;border-bottom:1px solid var(--line)}.pack-part input[type=number]{width:4.5rem;min-height:44px}.pack-part-meta{grid-column:2/-1;color:var(--muted);font-size:.85rem}@media(max-width:480px){.pack-part{grid-template-columns:auto 1fr}.pack-part input[type=number]{grid-column:2}}`. Confirm the variable names (`--line`, `--muted`) exist in `site.css`; use the file's actual token names.

The file input `accept` attribute and file-type allow-list: grep `accept=` in `public/order.html` and `SITE_CONFIG` upload config (`public/assets/js/config.js`) and add `.zip` / `application/zip` if the print model chooser filters by extension.

- [ ] **Step 8: Run unit tests, version assets, validate**

Run: `node --test tests/unit/*.test.mjs 2>&1 | grep -E "^# (pass|fail)"` then `npm run assets:version` then `npm run validate`
Expected: unit tests pass (plus the 9 environment failures); validate passes.

- [ ] **Step 9: Commit**

```bash
git add -A public tests
git commit -m "feat(order): ZIP pack picker with local planning range and server pack estimate"
```

---

### Task 10: End-to-end, documentation, full verification

**Files:**
- Create: `tests/e2e/test_zip_model_pack.py`
- Modify: `docs/PRINT-ESTIMATION.md`, `docs/VERIFICATION.md`, `docs/DEPLOYMENT.md` (migration 006), `.env.example` (document `PRINT_ESTIMATE_MAX_PACK_PARTS` if other `PRINT_ESTIMATE_*` vars are listed there)

- [ ] **Step 1: Write the e2e**

Create `tests/e2e/test_zip_model_pack.py`. Read `tests/e2e/test_print_model_estimate.py` and `tests/e2e/test_print_estimate_workspace.py` first and reuse their harness (`running_*` context, `SiteBrowser`, how they attach a file with `set_input_files`, how they enable the loopback private-estimate workspace). Build the ZIP in Python with `zipfile` (stored + deflated STL cubes, one PNG, one `.md`, one bad STL). Assertions:

1. Choose the print service, attach the ZIP: the picker appears with one checkbox per STL, the bad part is disabled with the "Could not be measured" copy, the PNG/MD names appear under "Not printed".
2. Unchecking a part and changing a quantity changes the displayed estimate (compare the estimate text before and after).
3. Keyboard: Tab reaches each checkbox and quantity input; Space toggles a checkbox (use `page.keyboard`).
4. With the private workspace running, the server pack estimate response arrives (wait for the privately-verified copy) and submit succeeds; the operator job sheet (use the operator workspace helper from `tests/e2e/test_operator_print_detail.py`) shows the ZIP and only the selected parts, with quantities.
5. A zip with a traversal entry (`../x.stl`) shows the generic "could not be measured" copy and the request is still submittable.
6. 390 px viewport: no horizontal overflow (`document.documentElement.scrollWidth <= clientWidth`) and the picker is visible.
7. `site.assert_no_page_errors()` in each test.

- [ ] **Step 2: Run the e2e and fix what it finds**

Run: `python -m pytest tests/e2e/test_zip_model_pack.py -q`
Expected: PASS after fixing real defects; do not weaken assertions.

- [ ] **Step 3: Documentation**

`docs/PRINT-ESTIMATION.md`: extend the Flow block with the ZIP branch; add the code map rows (`archive.js`, `pack.js`, `estimate-pack.js`, `pack.js` application); add the `PRINT_ESTIMATE_MAX_PACK_PARTS` row to the configuration table; add the ZIP failure rows from the spec's failure table; document that the pack total remains the submission snapshot (amendment 6). `docs/DEPLOYMENT.md`: apply migration 006 after 005 and before deploying code that includes ZIP packs (additive; the code needs `parent_asset_id` and `selected`). `docs/VERIFICATION.md`: record the new test counts after Step 4.

- [ ] **Step 4: Full verification**

Run:

```bash
npm run assets:version && npm run validate
node --test tests/unit/*.test.mjs tests/contract/*.test.mjs 2>&1 | grep -E "^# (pass|fail)"
python -m pytest tests/e2e -q --ignore=tests/e2e/test_customize.py
python tests/audit/audit.py
node scripts/check-architecture.mjs
```

Expected: validate and architecture checks pass; unit failures limited to the 9 environment `customize-*` tests; e2e all pass; audit all checks pass. Then `npm run screenshots`, open `screenshots/preview-board.png`, and visually confirm the ZIP picker (light and dark, 390 px) if the board includes the order page; if the board does not cover it, capture the picker with the e2e harness screenshot helper and inspect that image instead.

- [ ] **Step 5: Manual check with the real pack**

Start `npm run dev:workspace`, attach `C:\Users\jd\Downloads\5c5f00a6e7-turn-tracker-print-pack-v2.zip` on the print order page, and confirm: 10 parts listed (base, chassis, keycap_E, keycap_R, keycap_S, latch_bar, lid, panel, plunger, yoke), 8 PNGs plus `ASSEMBLY.md` plus `turn_tracker.scad` under "Not printed", the planning range changes with selection, and submit shows the pack in the operator inbox at `http://127.0.0.1:4180`.

- [ ] **Step 6: Commit**

```bash
git add -A tests docs .env.example public screenshots
git commit -m "test+docs(print): ZIP model pack e2e, runbook and verification record"
```
