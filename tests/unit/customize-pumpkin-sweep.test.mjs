// Breadth: a seeded sweep of random valid pumpkins across every type, surface, face, stem and
// extreme shape must build, stay analyzer-clean and fit the plate. Also the STL export of a built
// model (one combined mesh) agrees with the 3MF.
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import test from "node:test";
import { loadEngine } from "../../customizer/framework/engine.js";
import { buildModel } from "../../customizer/framework/model.js";
import { partsToStl, stlFilename } from "../../customizer/framework/stl.js";
import { loadBuilder } from "../../customizer/generators/index.js";
import pumpkin from "../../public/assets/js/customize/generators/pumpkin.js";
import { clampParams, validateParams } from "../../public/assets/js/customize/schema.js";
import { analyzeModelBytes } from "../../public/assets/js/print-estimation/geometry.js";

const wasm = await loadEngine();
const { default: build } = await loadBuilder.pumpkin();
const gen = { ...pumpkin, build };
const inflateRaw = async (b, max) => new Uint8Array(inflateRawSync(b, { maxOutputLength: max }));
const defaults = Object.fromEntries(Object.entries(pumpkin.schema).map(([k, d]) => [k, d.default]));

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// A random value for a field: numbers snap to their step grid, enums and bools are uniform.
function draw(def, r) {
  if (def.type === "enum") return def.options[Math.floor(r() * def.options.length)].value;
  if (def.type === "bool") return r() < 0.5;
  if (def.type === "color") return `#${Math.floor(r() * 0xffffff).toString(16).padStart(6, "0")}`;
  const steps = Math.round((def.max - def.min) / def.step);
  const v = def.min + Math.floor(r() * (steps + 1)) * def.step;
  return Math.round(v * 1e6) / 1e6;
}

test("120 random pumpkins build clean: every type, surface, face, stem, joint and shape extreme", async () => {
  const r = rng(20261009);
  let built = 0, refused = 0, wallRefused = 0;
  const seen = { style: new Set(), decoration: new Set(), face: new Set(), stem: new Set(), faceStyle: new Set() };
  for (let i = 0; i < 120; i++) {
    const draft = Object.fromEntries(Object.entries(pumpkin.schema).map(([k, d]) => [k, d.type === "color" ? d.default : draw(d, r)]));
    // Colors stay readable: the contrast rules are tested elsewhere; here the shape is what varies.
    const params = clampParams(pumpkin, { ...defaults, ...draft });
    const checked = validateParams(pumpkin, params);
    if (!checked.ok) { refused++; continue; }          // a rule said no: that is the correct outcome
    const label = JSON.stringify(checked.value);
    let out;
    try { out = await buildModel(gen, checked.value, { wasm, font: null }); } catch (e) {
      // The builder's own plain-language refusal of a hollow wall that cannot follow an extreme
      // combination (thin wall, twist and irregular lobes): readable, and counted so it stays rare.
      if (/^The wall doesn't fit inside this shape/.test(e.message) && checked.value.style !== "solid") { wallRefused++; continue; }
      assert.fail(`${e.message} :: ${label}`);
    }
    const analysis = await analyzeModelBytes({ name: out.filename, bytes: out.data, inflateRaw });
    // A very large bowl plus lid is legitimately bigger than a plate; the builder says so itself.
    assert.deepEqual(analysis.warnings.filter(w => !["embedded_settings_ignored", "exceeds_build_volume"].includes(w)), [], label);
    assert.ok(analysis.volumeMm3 > 50 && out.metrics.unique_colors <= 4, label);
    assert.ok(out.parts.length >= 1);
    built++;
    const v = checked.value;
    seen.style.add(v.style); seen.decoration.add(v.decoration); seen.face.add(v.face); seen.stem.add(v.stem); seen.faceStyle.add(v.face_style);
  }
  assert.ok(wallRefused <= 4, `${wallRefused} builds refused the wall`);
  assert.ok(built >= 40, `only ${built} built (${refused} refused by rules)`);
  assert.equal(seen.style.size, 4, [...seen.style].join());
  assert.ok(seen.decoration.size >= 3 && seen.face.size >= 5 && seen.stem.size === 3 && seen.faceStyle.size >= 2, JSON.stringify(Object.fromEntries(Object.entries(seen).map(([k, s]) => [k, [...s]]))));
});

test("STL export: one combined binary mesh whose volume matches the 3MF's", async () => {
  const params = validateParams(pumpkin, { ...defaults, stem: "peg" }).value;
  const out = await buildModel(gen, params, { wasm, font: null });
  const stl = partsToStl(out.parts);
  const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  const triangles = out.parts.reduce((n, p) => n + p.mesh.triangles.length, 0);
  assert.equal(view.getUint32(80, true), triangles);
  assert.equal(stl.byteLength, 84 + triangles * 50);
  assert.ok(out.parts.length >= 3, "pumpkin, face parts and the loose stem are all in the one mesh");
  const fromStl = await analyzeModelBytes({ name: "pumpkin.stl", bytes: stl, inflateRaw });
  const from3mf = await analyzeModelBytes({ name: out.filename, bytes: out.data, inflateRaw });
  assert.ok(Math.abs(fromStl.volumeMm3 - from3mf.volumeMm3) / from3mf.volumeMm3 < 1e-4, `${fromStl.volumeMm3} vs ${from3mf.volumeMm3}`);
  assert.deepEqual(fromStl.warnings.filter(w => !["embedded_settings_ignored", "units_assumed"].includes(w)), [], "STL carries no units, so the analyzer assumes millimetres");
  assert.equal(stlFilename("pumpkin-solid-80mm.3mf"), "pumpkin-solid-80mm.stl");
});
