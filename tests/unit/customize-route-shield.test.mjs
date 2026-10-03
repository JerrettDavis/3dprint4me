import assert from "node:assert/strict";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import { loadEngine } from "../../customizer/framework/engine.js";
import { buildModel } from "../../customizer/framework/model.js";
import { analyzeModelBytes } from "../../public/assets/js/print-estimation/geometry.js";
import { getGenerator, listPublicGenerators } from "../../public/assets/js/customize/registry.js";
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
  const { value } = validateParams(gen, { qr_enabled: true, qr_data: "https://example.com/" + "a".repeat(360) });
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

test("font mode without a font fails readably", async () => {
  const { value } = validateParams(gen, { font_mode: "font" });
  await assert.rejects(() => buildModel(gen, value, { wasm, font: null }), /font/i);
});

test("registry rejects inherited ids and lists public generators", () => {
  assert.equal(getGenerator("__proto__"), undefined);
  assert.equal(getGenerator("toString"), undefined);
  assert.equal(getGenerator("nope"), undefined);
  assert.deepEqual(listPublicGenerators().map(g => g.id), ["route-shield"]);
});
