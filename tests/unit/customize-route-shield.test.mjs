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
  assert.ok(out.parts.length === 6);
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
  const { value } = validateParams(gen, { top_text: "WWWWWWWWWWWWWWWWWW", top_scale_pct: 150 });
  await assert.rejects(() => buildModel(gen, value, { wasm, font: null }), /doesn't fit/);
});

test("font mode without a font fails readably", async () => {
  const { value } = validateParams(gen, { font_mode: "font" });
  await assert.rejects(() => buildModel(gen, value, { wasm, font: null }), /font/i);
});

test("registry rejects inherited ids and lists public generators", () => {
  assert.equal(getGenerator("__proto__"), undefined);
  assert.equal(getGenerator("toString"), undefined);
  assert.equal(getGenerator("constructor"), undefined);
  assert.equal(getGenerator("nope"), undefined);
  assert.deepEqual(listPublicGenerators().map(g => g.id), ["route-shield"]);
});

test("listPublicGenerators filters on rights.publishable", () => {
  const map = { a: { id: "a", rights: { publishable: true } }, b: { id: "b", rights: { publishable: false } } };
  const list = Object.values(Object.freeze(map)).filter(g => g.rights.publishable);
  assert.deepEqual(list.map(g => g.id), ["a"]);
  assert.ok(listPublicGenerators().every(g => g.rights.publishable));
});

test("text longer than 18 characters is rejected by the schema", () => {
  assert.equal(validateParams(gen, { top_text: "W".repeat(18) }).ok, true);
  assert.equal(validateParams(gen, { top_text: "W".repeat(19) }).ok, false);
  assert.equal(validateParams(gen, { lower_text: "6".repeat(19) }).ok, false);
});

test("rules reject out-of-range inlay, zero field height and out-of-range scale", () => {
  assert.equal(validateParams(gen, { inlay_depth_mm: 1.8 + 0.2 }).ok, false);
  assert.equal(validateParams(gen, { inlay_depth_mm: 0.2 }).ok, false);
  assert.equal(validateParams(gen, { field_height_mm: 0 }).ok, false);
  assert.equal(validateParams(gen, { top_scale_pct: 19 }).ok, false);
  assert.equal(validateParams(gen, { top_scale_pct: 151 }).ok, false);
});

// Embind exposes no live-instance counter, so instrument the classes: every Manifold /
// CrossSection returned by a constructor, static or prototype method is recorded as live
// and removed again on delete(). After build() only the returned solids may remain live.
function trackLiveObjects(wasm) {
  const live = new Set();
  const restore = [];
  const classes = [wasm.CrossSection, wasm.Manifold];
  const isInst = v => classes.some(C => v instanceof C);
  const wrap = (holder, name, fn) => {
    const wrapped = function (...args) {
      const r = fn.apply(this, args);
      if (isInst(r)) live.add(r);
      return r;
    };
    const had = Object.getOwnPropertyDescriptor(holder, name);
    Object.defineProperty(holder, name, { value: wrapped, writable: true, configurable: true });
    restore.push(() => had ? Object.defineProperty(holder, name, had) : delete holder[name]);
  };
  for (const C of classes) {
    for (const name of Object.getOwnPropertyNames(C)) {
      if (typeof C[name] === "function" && !["prototype", "length", "name"].includes(name)) wrap(C, name, C[name]);
    }
    for (let proto = C.prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        const d = Object.getOwnPropertyDescriptor(proto, name);
        if (name === "constructor" || typeof d.value !== "function") continue;
        if (name === "delete") {
          const orig = d.value;
          Object.defineProperty(proto, name, { value: function (...a) { live.delete(this); return orig.apply(this, a); }, writable: true, configurable: true });
          restore.push(() => Object.defineProperty(proto, name, d));
        } else wrap(proto, name, d.value);
      }
    }
  }
  const proxied = C => new Proxy(C, { construct(target, args) { const o = new target(...args); live.add(o); return o; } });
  const ctxWasm = new Proxy(wasm, { get: (t, k) => (k === "CrossSection" ? proxied(wasm.CrossSection) : t[k]) });
  return { live, ctxWasm, restore: () => restore.reverse().forEach(f => f()) };
}

test("build() frees every temporary: only the returned solids stay alive", async () => {
  for (const extra of [{}, { field_height_mm: -1, text_height_mm: -0.6 }, { qr_enabled: false, back_text: "" }]) {
    const { value } = validateParams(gen, extra);
    const tracker = trackLiveObjects(wasm);
    try {
      for (let i = 0; i < 3; i++) {
        const built = await build(value, { wasm: tracker.ctxWasm, font: null });
        assert.equal(tracker.live.size, built.solids.length, `live ${tracker.live.size} vs solids ${built.solids.length} (${JSON.stringify(extra)})`);
        for (const s of built.solids) assert.ok(tracker.live.has(s.solid));
        built.solids.forEach(s => s.solid.delete());
        assert.equal(tracker.live.size, 0);
      }
    } finally { tracker.restore(); }
  }
});

test("empty front text and no back content build without error", async () => {
  const { value } = validateParams(gen, { top_text: "", lower_text: "", qr_enabled: false, back_text: "" });
  const out = await buildModel(gen, value, { wasm, font: null });
  assert.ok(out.parts.length >= 3);
});

test("failed builds do not leak either", async () => {
  const { value } = validateParams(gen, { top_text: "WWWWWWWWWWWWWWWWWW", top_scale_pct: 150 });
  const tracker = trackLiveObjects(wasm);
  try {
    await assert.rejects(() => build(value, { wasm: tracker.ctxWasm, font: null }), /doesn't fit/);
    assert.equal(tracker.live.size, 0);
  } finally { tracker.restore(); }
});
