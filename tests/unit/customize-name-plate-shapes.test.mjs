import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as opentype from "opentype.js";
import { loadEngine } from "../../customizer/framework/engine.js";
import { getGenerator } from "../../public/assets/js/customize/registry.js";
import { validateParams } from "../../public/assets/js/customize/schema.js";
import { FONTS } from "../../public/assets/js/customize/fonts.js";
import build from "../../customizer/generators/name-plate/build.js";
import { trackLiveObjects } from "../support/manifold-live.mjs";

const wasm = await loadEngine();
const parse = opentype.parse ?? opentype.default.parse;
const gen = { ...getGenerator("name-plate"), build };
const FONT_DIR = new URL("../../customizer/static/fonts/", import.meta.url);
const fonts = {};
for (const f of FONTS) {
  const b = await readFile(new URL(f.file, FONT_DIR));
  fonts[f.id] = parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
const ALL_FONTS = ["block", ...FONTS.map(f => f.id)];
const params = (extra = {}) => {
  const { ok, errors, value } = validateParams(gen, extra);
  assert.ok(ok, errors.join("; "));
  return value;
};
const ctxFor = p => ({ wasm, font: p.font === "block" ? null : fonts[p.font], fonts });
const freeAll = built => built.solids.forEach(s => s.solid.delete());
const solidNamed = (built, name) => built.solids.find(s => s.name === name).solid;

/** Components of a 2D slice after eroding it by `erode` mm: a real overlap survives, a touching corner does not. */
function solidComponents(solid, z, erode) {
  const slice = solid.slice(z);
  const eroded = slice.offset(-erode, "Round", 2, 24);
  const pieces = eroded.decompose();
  const n = pieces.length;
  pieces.forEach(p => p.delete());
  slice.delete(); eroded.delete();
  return n;
}

// ---- "none" plate: connectors flush with both neighbours ---------------------------------------

test("no-plate connectors overlap both neighbours along their full span, for every font", async () => {
  for (const font of ALL_FONTS) {
    for (const name of ["AL", "AV", "LT", "Tj", "Hello", "Maya", "Hal Ply"]) {
      for (const height of [16, 24]) {
        const p = params({ name, font, plate: "none", height_mm: height });
        const built = await build(p, ctxFor(p));
        try {
          const backing = solidNamed(built, "Backing");
          assert.equal(solidComponents(backing, 0.1, 0), 1, `${font} "${name}" ${height}: backing is one body`);
          // Hairline faces have strokes under 0.6 mm: a 0.3 mm erosion would erase the strokes themselves.
          const thin = ["script", "handwriting", "blackletter", "fantasy"].includes(FONTS.find(f => f.id === font)?.category);
          assert.equal(solidComponents(backing, 0.1, thin ? 0.08 : 0.3), 1, `${font} "${name}" ${height}: connectors are not just touching a corner`);
        } finally { freeAll(built); }
      }
    }
  }
});

test("connectors stay inside the letters' vertical band", async () => {
  for (const font of ["block", "bebas-neue", "titan-one"]) {
    const p = params({ name: "AL TJ", font, plate: "none" });
    const built = await build(p, ctxFor(p));
    try {
      const letters = solidNamed(built, "Name").boundingBox();
      const backing = solidNamed(built, "Backing").boundingBox();
      // Backing rim is 1.6 mm all round; a connector must not protrude beyond it.
      assert.ok(backing.max[1] <= letters.max[1] + 1.6 + 1e-3, `${font} top ${backing.max[1]} vs ${letters.max[1]}`);
      assert.ok(backing.min[1] >= letters.min[1] - 1.6 - 1e-3, `${font} bottom ${backing.min[1]} vs ${letters.min[1]}`);
    } finally { freeAll(built); }
  }
});

// ---- "hug" plate ---------------------------------------------------------------------------------

test("hug is the default plate and old plate values still validate", () => {
  const def = getGenerator("name-plate");
  assert.equal(def.version, 2);
  assert.equal(def.schema.plate.default, "hug");
  assert.equal(def.schema.plate.options[0].value, "hug");
  assert.match(def.schema.plate.options[0].label, /Contour/);
  assert.equal(params({}).plate, "hug");
  for (const plate of ["pill", "rect", "none"]) assert.equal(params({ plate }).plate, plate);
  assert.equal(params({}).plate_margin_mm, 3);
});

test("hug builds one watertight plate body for every font, with and without a loop", async () => {
  for (const font of ALL_FONTS) {
    for (const [name, keychain_loop] of [["Hal Ply", false], ["Jordan", true], ["Al", false], ["Maximiliana Rosalind", false]]) {
      const p = params({ name, font, plate: "hug", keychain_loop });
      const built = await build(p, ctxFor(p));
      try {
        const plate = solidNamed(built, "Plate");
        assert.equal(plate.status(), "NoError");
        const pieces = plate.decompose();
        try { assert.equal(pieces.length, 1, `${font} "${name}"`); } finally { pieces.forEach(x => x.delete()); }
        assert.equal(solidComponents(plate, 0.1, 0.3), 1, `${font} "${name}" plate is bridged, not touching`);
        // No holes: the plate's slice has only outer contours (loop hole aside).
        const slice = plate.slice(0.1);
        try {
          const holes = slice.toPolygons().filter(poly => poly.reduce((a, [x, y], i) => { const [x2, y2] = poly[(i + 1) % poly.length]; return a + x * y2 - x2 * y; }, 0) < 0);
          assert.equal(holes.length, keychain_loop ? 1 : 0, `${font} "${name}" holes`);
        } finally { slice.delete(); }
      } finally { freeAll(built); }
    }
  }
});

test("hug plate extents are capped at the margin above and below the whole name", async () => {
  for (const font of ["block", "bebas-neue", "lobster", "pacifico", "titan-one"]) {
    for (const margin of [3, 5]) {
      const p = params({ name: "Hal Ply", font, plate: "hug", plate_margin_mm: margin });
      const built = await build(p, ctxFor(p));
      try {
        const plate = solidNamed(built, "Plate").boundingBox();
        const ink = solidNamed(built, "Name").boundingBox();
        assert.ok(Math.abs(plate.max[1] - (ink.max[1] + margin)) < 0.05, `${font} top ${plate.max[1] - ink.max[1]} vs ${margin}`);
        assert.ok(Math.abs(ink.min[1] - margin - plate.min[1]) < 0.05, `${font} bottom ${ink.min[1] - plate.min[1]} vs ${margin}`);
        assert.ok(plate.min[0] <= ink.min[0] - margin + 0.15 && plate.max[0] >= ink.max[0] + margin - 0.15, `${font} sides`);
      } finally { freeAll(built); }
    }
  }
});

test("hug plate hugs: much smaller than a rectangle for mixed-height text, and covers every letter with margin", async () => {
  const p = params({ name: "Hal Ply", font: "bebas-neue", plate: "hug" });
  const hug = await build(p, ctxFor(p));
  const rect = await build({ ...p, plate: "rect" }, ctxFor(p));
  const temps = [];
  const t = o => { temps.push(o); return o; };
  try {
    assert.ok(solidNamed(hug, "Plate").volume() < solidNamed(rect, "Plate").volume() * 1.01);
    const base = t(solidNamed(hug, "Plate").slice(0.1));
    const letters = t(solidNamed(hug, "Name").slice(p.thickness_mm - p.relief_mm / 2));
    assert.ok(t(t(letters.offset(p.plate_margin_mm - 0.1, "Round", 2, 24)).subtract(base)).area() < 1e-3, "margin kept around every letter");
  } finally { temps.forEach(o => o.delete()); freeAll(hug); freeAll(rect); }
});

test("hug works with every style, the loop, and keeps parts disjoint", async () => {
  for (const style of ["raised", "outline", "shadow", "inlay"]) {
    const p = params({ name: "Mary Ann", font: "lobster", plate: "hug", style, keychain_loop: true });
    const built = await build(p, ctxFor(p));
    try {
      assert.equal(built.solids[0].name, "Plate");
      assert.ok(built.loop);
      for (let i = 0; i < built.solids.length; i++) for (let j = i + 1; j < built.solids.length; j++) {
        const both = built.solids[i].solid.intersect(built.solids[j].solid);
        try { assert.ok(both.volume() < 1e-3, `${built.solids[i].name} ∩ ${built.solids[j].name}`); } finally { both.delete(); }
      }
    } finally { freeAll(built); }
  }
});

test("plate_margin_mm sets the pill and rectangle padding too", async () => {
  for (const plate of ["pill", "rect"]) {
    const [a, b] = await Promise.all([4, 6].map(async margin => {
      const p = params({ name: "Alex", plate, plate_margin_mm: margin });
      const built = await build(p, ctxFor(p));
      const bb = solidNamed(built, "Plate").boundingBox();
      freeAll(built);
      return bb.max[1] - bb.min[1];
    }));
    assert.ok(Math.abs(b - a - 4) < 0.05, `${plate}: ${a} -> ${b}`);
  }
});

test("hug builds without leaking temporaries, and a failed build does not leak either", async () => {
  const p = params({ name: "Hal Ply", font: "lobster", plate: "hug", keychain_loop: true, style: "outline" });
  const tracker = trackLiveObjects(wasm);
  try {
    const built = await build(p, { wasm: tracker.ctxWasm, font: fonts.lobster });
    assert.equal(tracker.live.size, built.solids.length);
    built.solids.forEach(s => s.solid.delete());
    assert.equal(tracker.live.size, 0);
    await assert.rejects(() => build(params({ name: "_".repeat(20), font: "bebas-neue", plate: "hug" }), { wasm: tracker.ctxWasm, font: fonts["bebas-neue"] }), /too small/);
    assert.equal(tracker.live.size, 0);
  } finally { tracker.restore(); }
});

test("requests made at version 1 (no margin, an explicit plate) still validate, and the plate they chose is kept", async () => {
  const { normalizeCustomization } = await import("../../lib/customization/domain.js");
  const old = normalizeCustomization({ generatorId: "name-plate", generatorVersion: 1, params: { name: "Sam", plate: "pill" } });
  assert.equal(old.params.plate, "pill");
  assert.equal(old.params.plate_margin_mm, 3);
  assert.equal(normalizeCustomization({ generatorId: "name-plate", generatorVersion: 2, params: { name: "Sam" } }).params.plate, "hug");
});

// ---- Definition contract -------------------------------------------------------------------------

test("sections, focus map and a section for every field", async () => {
  const def = getGenerator("name-plate");
  const keys = Object.keys(def.sections);
  assert.ok(keys.length >= 3);
  for (const [name, field] of Object.entries(def.schema)) {
    if (name === "font_license_ack") continue;
    assert.ok(keys.includes(field.section), `${name} has a section`);
    assert.ok(field.group, `${name} keeps its group`);
  }
  for (const f of def.focus) assert.ok(keys.includes(f.section));
  for (const style of ["raised", "outline", "shadow"]) {
    const p = params({ style, keychain_loop: true });
    const built = await build(p, ctxFor(p));
    try {
      for (const s of built.solids) assert.ok(def.focus.some(f => s.name.startsWith(f.part)), `${s.name} has no focus entry`);
    } finally { freeAll(built); }
  }
});
