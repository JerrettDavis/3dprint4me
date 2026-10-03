// Gates every registered generator against the framework contract (docs/GENERATORS.md) on real
// Manifold WASM: defaults and presets validate and build, at most five colors, the site's own
// analyzer accepts the 3MF, builds are fast enough, and no sensitive value reaches the file's
// text or its names.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import { unzipSync, strFromU8 } from "fflate";
import { loadEngine } from "../../customizer/framework/engine.js";
import { buildModel } from "../../customizer/framework/model.js";
import { loadBuilder } from "../../customizer/generators/index.js";
import { GENERATORS } from "../../public/assets/js/customize/registry.js";
import { clampParams, sensitiveKeys, validateParams } from "../../public/assets/js/customize/schema.js";
import { analyzeModelBytes } from "../../public/assets/js/print-estimation/geometry.js";

const wasm = await loadEngine();
const inflateRaw = async (b, max) => new Uint8Array(inflateRawSync(b, { maxOutputLength: max }));
const BUILD_BUDGET_MS = 20_000;
// One canary per run: a value no generator could produce by itself.
const CANARY = `Cn${randomUUID().replaceAll("-", "").slice(0, 14)}`;

const defaults = g => Object.fromEntries(Object.entries(g.schema).map(([k, d]) => [k, d.default]));
// Every sensitive field gets the canary (a sensitive text field is the only kind there is today).
function withCanaries(g, params) {
  const out = { ...params };
  for (const key of sensitiveKeys(g)) {
    assert.equal(g.schema[key].type, "text", `${g.id}.${key}: only text fields can be sensitive`);
    out[key] = CANARY;
  }
  return out;
}

/**
 * Validates `params`. A generator's defaults may fail only on its sensitive fields (a Wi-Fi tag
 * has no sensible default password): every failing field must be sensitive, and with a canary in
 * each sensitive field the parameters must then validate.
 */
function validated(g, params, label) {
  const plain = validateParams(g, params);
  if (!plain.ok) {
    const sensitive = new Set(sensitiveKeys(g));
    const failing = Object.keys(plain.fieldErrors);
    assert.ok(failing.length && failing.every(k => sensitive.has(k)), `${label}: fails on non-sensitive fields: ${plain.errors.join("; ")}`);
  }
  const filled = validateParams(g, withCanaries(g, params));
  assert.ok(filled.ok, `${label}: ${filled.errors.join("; ")}`);
  return filled.value;
}

function textEntries(data) {
  const entries = unzipSync(data);
  return Object.entries(entries).map(([name, bytes]) => [name, strFromU8(bytes)]);
}

async function buildAndCheck(g, params, label) {
  const { default: build } = await loadBuilder[g.id]();
  const started = performance.now();
  const out = await buildModel({ ...g, build }, params, { wasm, font: null, imageContours: null });
  const ms = performance.now() - started;
  assert.ok(ms < BUILD_BUDGET_MS, `${label}: built in ${Math.round(ms)} ms (budget ${BUILD_BUDGET_MS} ms)`);
  assert.ok(out.parts.length >= 1, `${label}: no parts`);
  assert.ok(out.metrics.unique_colors >= 1 && out.metrics.unique_colors <= 5, `${label}: ${out.metrics.unique_colors} colors`);
  assert.equal(new Set(out.parts.map(p => p.color)).size, out.metrics.unique_colors);
  const analysis = await analyzeModelBytes({ name: out.filename, bytes: out.data, inflateRaw });
  assert.deepEqual(analysis.warnings.filter(w => w !== "embedded_settings_ignored"), [], `${label}: analyzer warnings`);
  assert.ok(analysis.volumeMm3 > 0, `${label}: empty volume`);
  // No sensitive value in any inflated 3MF entry (metadata, model XML, Bambu settings), the
  // filename or a part name. The title lands in the metadata entry, so it is covered too.
  if (sensitiveKeys(g).length) {
    for (const [name, text] of textEntries(out.data)) assert.ok(!text.includes(CANARY), `${label}: sensitive value in 3MF entry ${name}`);
    assert.ok(!out.filename.includes(CANARY), `${label}: sensitive value in filename ${out.filename}`);
    for (const part of out.parts) assert.ok(!String(part.name).includes(CANARY), `${label}: sensitive value in part name ${part.name}`);
    const metadata = textEntries(out.data).filter(([name]) => /metadata|\.model$|\.config$/i.test(name)).map(([, text]) => text).join("\n");
    assert.match(metadata, /\[redacted\]/, `${label}: the redaction marker stands in for the sensitive value`);
  }
  return { out, ms, analysis };
}

const generators = Object.values(GENERATORS);

test("the registry has generators to check, each with a builder", () => {
  assert.ok(generators.length >= 4, generators.map(g => g.id).join(","));
  for (const g of generators) assert.equal(typeof loadBuilder[g.id], "function", g.id);
});

test("the canary check would see a sensitive value in the 3MF text", async () => {
  // Guards the guard: a generator that leaks its sensitive field into the file's names is caught.
  const g = GENERATORS["wifi-tag"];
  const leaky = { ...g, schema: { ...g.schema, password: { ...g.schema.password, sensitive: false } } };
  const { default: build } = await loadBuilder["wifi-tag"]();
  const out = await buildModel({ ...leaky, build }, validated(g, defaults(g), "leaky"), { wasm, font: null });
  assert.ok(textEntries(out.data).some(([, text]) => text.includes(CANARY)), "an unredacted password reaches the metadata");
});

for (const g of generators) {
  test(`${g.id}: defaults validate and build within budget, at most 5 colors, analyzer-clean`, async t => {
    const params = validated(g, defaults(g), `${g.id} defaults`);
    const { ms, out } = await buildAndCheck(g, params, `${g.id} defaults`);
    t.diagnostic(`${g.id}: ${out.parts.length} parts, ${out.metrics.unique_colors} colors, ${Math.round(ms)} ms`);
  });

  test(`${g.id}: every preset validates and builds`, async () => {
    const presets = Object.entries(g.presets ?? {});
    assert.ok(presets.length >= 1, `${g.id} has no presets`);
    for (const [name, preset] of presets) {
      for (const key of Object.keys(preset)) assert.ok(Object.hasOwn(g.schema, key), `${g.id} preset ${name}: unknown key ${key}`);
      // A preset is applied like the page applies values: over the defaults, then clamped.
      const params = validated(g, clampParams(g, { ...defaults(g), ...preset }), `${g.id} preset ${name}`);
      await buildAndCheck(g, params, `${g.id} preset ${name}`);
    }
  });
}
