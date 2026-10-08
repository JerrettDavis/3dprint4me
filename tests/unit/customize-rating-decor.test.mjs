import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import * as opentype from "opentype.js";
import { loadEngine } from "../../customizer/framework/engine.js";
import { buildModel } from "../../customizer/framework/model.js";
import { getGenerator } from "../../public/assets/js/customize/registry.js";
import { clampParams, validateParams } from "../../public/assets/js/customize/schema.js";
import build, { planLayout, CARD } from "../../customizer/generators/rating-card/build.js";
import { normalizeCustomization } from "../../lib/customization/domain.js";
import { trackLiveObjects } from "../support/manifold-live.mjs";

const wasm = await loadEngine();
const gen = { ...getGenerator("rating-card"), build };
const paramsFor = (extra = {}) => {
  const { ok, errors, value } = validateParams(gen, extra);
  assert.ok(ok, errors.join("; "));
  return value;
};
const freeAll = built => built.solids.forEach(s => s.solid.delete());
const part = (built, re) => built.solids.find(s => re.test(s.name));
const overlap = (a, b) => { const x = a.intersect(b); const v = x.volume(); x.delete(); return v; };
const parseFont = opentype.parse ?? opentype.default.parse;

test("definition v2 exposes ordered sections, a focus map and a section on every field", () => {
  assert.equal(gen.version, 2);
  const keys = Object.keys(gen.sections);
  assert.deepEqual(keys, ["general", "icon", "rating", "caption", "border", "dividers", "colors"]);
  for (const [key, def] of Object.entries(gen.schema)) {
    assert.ok(def.group, `${key} keeps its group`);
    assert.ok(keys.includes(def.section), `${key} has section ${def.section}`);
  }
  for (const f of gen.focus) assert.ok(keys.includes(f.section), f.part);
});

test("v1 drafts validate to the v1 look: same parts, same layout, no decoration", async () => {
  const value = paramsFor();
  for (const [k, v] of Object.entries({ border_style: "none", frame_style: "none", divider: "none", corner_style: "round", caption_font: "inherit" })) assert.equal(value[k], v, k);
  const L = planLayout(value);
  assert.equal(L.margin, 4);
  assert.equal(L.iconZone, 31);
  assert.equal(L.dividers.length, 0);
  const built = await build(value, { wasm, font: null });
  try {
    assert.deepEqual(built.solids.map(s => s.name), ["Card base", "Icon", "Empty stars", "Filled stars", "Caption"]);
  } finally { freeAll(built); }
});

test("the server accepts a v1 and a v2 hand-off", () => {
  assert.ok(normalizeCustomization({ generatorId: "rating-card", generatorVersion: 1, params: { caption: "Hi" } }));
  const out = normalizeCustomization({ generatorId: "rating-card", generatorVersion: 2, params: { border_style: "raised", divider: "both", corner_style: "chamfer" } });
  assert.equal(out.params.border_style, "raised");
  assert.throws(() => normalizeCustomization({ generatorId: "rating-card", generatorVersion: 2, params: { divider: "diagonal" } }), /unsupported/);
});

// ---- every combination builds, stays inside the card and never overlaps ----------------------
test("every corner x border x frame x divider combination builds clean, inside the card, without overlaps", async () => {
  const T = 1.6, R = 0.6;
  for (const corner_style of ["round", "chamfer", "notch"]) {
    for (const border_style of ["none", "raised", "engraved"]) {
      for (const frame_style of ["none", "raised", "engraved"]) {
        for (const divider of ["none", "caption", "icon", "both"]) {
          const extra = { corner_style, border_style, frame_style, divider, corner_radius_mm: 3 };
          const value = paramsFor(extra);
          const built = await build(value, { wasm, font: null });
          try {
            const names = built.solids.map(s => s.name);
            assert.equal(names.includes("Border"), border_style === "raised", JSON.stringify(extra));
            assert.equal(names.includes("Inner frame"), frame_style === "raised", JSON.stringify(extra));
            assert.equal(names.filter(n => /^Divider/.test(n)).length, { none: 0, caption: 1, icon: 1, both: 2 }[divider], JSON.stringify(extra));
            for (const s of built.solids) {
              assert.equal(s.solid.status(), "NoError", `${s.name} ${JSON.stringify(extra)}`);
              assert.ok(s.solid.volume() > 0);
              const b = s.solid.boundingBox();
              assert.ok(b.min[0] >= -CARD.w / 2 - 1e-6 && b.max[0] <= CARD.w / 2 + 1e-6 && b.min[1] >= -CARD.h / 2 - 1e-6 && b.max[1] <= CARD.h / 2 + 1e-6, s.name);
              assert.ok(b.max[2] <= T + 1e-6 && b.min[2] >= -1e-6, `${s.name} stays within the ${T} mm height`);
              if (s.name !== "Card base") assert.ok(b.min[2] >= T - R - 1e-6, `${s.name} stands on the base`);
            }
            for (let i = 0; i < built.solids.length; i++) {
              for (let j = i + 1; j < built.solids.length; j++) {
                assert.ok(overlap(built.solids[i].solid, built.solids[j].solid) < 1e-3, `${names[i]} overlaps ${names[j]} ${JSON.stringify(extra)}`);
              }
            }
            assert.ok(new Set(built.solids.map(s => s.color)).size <= 5, "decorations reuse an existing color");
            // The content stays inside the margin the decorations leave.
            const L = planLayout(value);
            for (const name of ["Icon", "Filled stars", "Empty stars", "Caption"]) {
              const s = part(built, new RegExp(`^${name}`));
              if (!s) continue;
              const b = s.solid.boundingBox();
              assert.ok(b.min[0] >= -CARD.w / 2 + L.margin - 1e-6 && b.max[0] <= CARD.w / 2 - L.margin + 1e-6, `${name} x ${JSON.stringify(extra)}`);
              assert.ok(b.min[1] >= -CARD.h / 2 + L.margin - 1e-6 && b.max[1] <= CARD.h / 2 - L.margin + 1e-6, `${name} y ${JSON.stringify(extra)}`);
            }
          } finally { freeAll(built); }
        }
      }
    }
  }
});

test("a raised border, an inner frame and dividers all print in the Icon color", async () => {
  const value = paramsFor({ border_style: "raised", frame_style: "raised", divider: "both", icon_color: "#223344" });
  const built = await build(value, { wasm, font: null });
  try {
    for (const name of [/^Border/, /^Inner frame/, /^Divider \(caption\)/, /^Divider \(icon\)/, /^Icon/]) assert.equal(part(built, name).color, "#223344", String(name));
  } finally { freeAll(built); }
});

test("geometry of each decoration", async () => {
  const plain = await build(paramsFor(), { wasm, font: null });
  const plainBase = part(plain, /base/i).solid.volume();
  freeAll(plain);

  const raised = await build(paramsFor({ border_style: "raised", border_inset_mm: 1, border_width_mm: 1.2 }), { wasm, font: null });
  try {
    const b = part(raised, /^Border/).solid.boundingBox();
    assert.ok(Math.abs(b.max[0] - b.min[0] - (CARD.w - 2)) < 0.05 && Math.abs(b.max[1] - b.min[1] - (CARD.h - 2)) < 0.05, "1 mm inside the card edge");
    assert.ok(Math.abs(b.min[2] - 1.0) < 1e-6 && Math.abs(b.max[2] - 1.6) < 1e-6, "flush with the other relief");
  } finally { freeAll(raised); }

  const engraved = await build(paramsFor({ border_style: "engraved", groove_depth_mm: 0.4 }), { wasm, font: null });
  try {
    assert.equal(part(engraved, /^Border/), undefined);
    assert.ok(part(engraved, /base/i).solid.volume() < plainBase - 5, "the groove removes material");
    assert.ok(Math.abs(part(engraved, /base/i).solid.boundingBox().max[2] - 1.0) < 1e-6);
  } finally { freeAll(engraved); }

  const framed = await build(paramsFor({ border_style: "raised", frame_style: "raised" }), { wasm, font: null });
  try {
    const border = part(framed, /^Border/).solid.boundingBox();
    const frame = part(framed, /^Inner frame/).solid.boundingBox();
    assert.ok(Math.abs((border.min[0] + 1.2 + 0.8) - frame.min[0]) < 0.05, "0.8 mm between the border and the frame");
    assert.ok(planLayout(paramsFor({ border_style: "raised", frame_style: "raised" })).margin > 4, "content moves in");
  } finally { freeAll(framed); }
});

test("corner styles cut the stated amount from the plate", async () => {
  const area = async extra => {
    const built = await build(paramsFor(extra), { wasm, font: null });
    try { return part(built, /base/i).solid.volume() / 1.0; } finally { freeAll(built); }
  };
  const full = CARD.w * CARD.h;
  const chamfer = await area({ corner_style: "chamfer", corner_radius_mm: 3 });
  assert.ok(Math.abs(chamfer - (full - 2 * 9)) / full < 0.002, `chamfer ${chamfer}`);
  const notch = await area({ corner_style: "notch", corner_radius_mm: 3 });
  assert.ok(Math.abs(notch - (full - Math.PI * 9)) / full < 0.003, `notch ${notch}`);
  const square = await area({ corner_style: "round", corner_radius_mm: 0 });
  assert.ok(Math.abs(square - full) / full < 1e-6);
  const round = await area({ corner_style: "round", corner_radius_mm: 3 });
  assert.ok(round < square && round > notch - 1);
});

test("corner size limits per style, engraving depth limits and clamping", () => {
  assert.equal(validateParams(gen, { corner_style: "notch", corner_radius_mm: 5 }).ok, false);
  assert.match(validateParams(gen, { corner_style: "notch", corner_radius_mm: 5 }).fieldErrors.corner_radius_mm, /at most 4 mm/);
  assert.equal(validateParams(gen, { corner_style: "notch", corner_radius_mm: 4 }).ok, true);
  assert.equal(validateParams(gen, { corner_style: "chamfer", corner_radius_mm: 6.5 }).ok, false);
  assert.equal(validateParams(gen, { corner_style: "round", corner_radius_mm: 8 }).ok, true);
  const clamped = clampParams(gen, { ...paramsFor({ corner_radius_mm: 8 }), corner_style: "notch" }, "corner_style");
  assert.equal(clamped.corner_radius_mm, 4);
  // 1.6 mm card with the 0.6 mm relief leaves 1.0 mm: 0.4 mm engraving keeps 0.6 mm.
  assert.equal(validateParams(gen, { border_style: "engraved", groove_depth_mm: 0.4 }).ok, true);
  const deep = validateParams(gen, { border_style: "engraved", groove_depth_mm: 0.6 });
  assert.equal(deep.ok, false);
  assert.match(deep.fieldErrors.groove_depth_mm, /Engraving depth must be 0.2–0.4 mm/);
  assert.equal(validateParams(gen, { border_style: "none", groove_depth_mm: 0.6 }).ok, true, "not engraved, no limit");
  const thin = validateParams(gen, { frame_style: "engraved", thickness_mm: 1.2, relief_mm: 0.6 });
  assert.equal(thin.ok, false, "1.2 - 0.6 leaves too little for any groove");
  assert.match(thin.fieldErrors.groove_depth_mm, /needs at least 0.6 mm/);
});

test("dividers: skipped with a warning when there is nothing to divide", async () => {
  const noCaption = await build(paramsFor({ caption: "", divider: "caption" }), { wasm, font: null });
  try {
    assert.ok(noCaption.warnings.some(w => /above the caption was left out/.test(w)));
    assert.equal(noCaption.solids.filter(s => /^Divider/.test(s.name)).length, 0);
  } finally { freeAll(noCaption); }
  const noStars = await build(paramsFor({ show_stars: false, divider: "both" }), { wasm, font: null });
  try {
    assert.ok(noStars.warnings.some(w => /between the icon and the stars was left out/.test(w)));
    assert.deepEqual(noStars.solids.filter(s => /^Divider/.test(s.name)).map(s => s.name), ["Divider (caption)"]);
  } finally { freeAll(noStars); }
  const wide = await build(paramsFor({ divider: "caption", divider_width_mm: 1.6, divider_length_pct: 50 }), { wasm, font: null });
  try {
    const b = part(wide, /^Divider/).solid.boundingBox();
    assert.ok(Math.abs(b.max[1] - b.min[1] - 1.6) < 1e-6);
    assert.ok(Math.abs(b.max[0] - b.min[0] - 0.5 * (CARD.w - 8)) < 0.05);
  } finally { freeAll(wide); }
});

test("star, icon and traced-image features still work with decorations", async () => {
  const tracked = [[[0, 0], [10, 0], [10, 10], [0, 10]]];
  const imageContours = tracked;
  const value = paramsFor({ icon: "custom", border_style: "raised", frame_style: "raised", divider: "both", rating: 2.5 });
  const built = await build(value, { wasm, font: null, imageContours });
  try {
    assert.ok(part(built, /^Icon/) && part(built, /^Filled stars/) && part(built, /^Empty stars/));
  } finally { freeAll(built); }
  const heart = await build(paramsFor({ icon: "heart", rating: 5, border_style: "raised", frame_style: "raised" }), { wasm, font: null });
  try {
    assert.equal(part(heart, /^Empty stars/), undefined, "five full stars leave no empty ones");
    assert.ok(part(heart, /^Filled stars/));
  } finally { freeAll(heart); }
});

test("the caption can use its own font; inherit follows the main font", async () => {
  const bebas = parseFont((await readFile(new URL("../../customizer/static/fonts/BebasNeue-Regular.ttf", import.meta.url))).buffer.slice(0));
  const pacifico = parseFont((await readFile(new URL("../../customizer/static/fonts/Pacifico-Regular.ttf", import.meta.url))).buffer.slice(0));
  const volume = async (extra, ctx) => {
    const built = await build(paramsFor({ caption: "Great", ...extra }), { wasm, ...ctx });
    try { return part(built, /^Caption/).solid.volume(); } finally { freeAll(built); }
  };
  const main = await volume({ font: "bebas-neue" }, { font: bebas, fonts: {} });
  const same = await volume({ font: "bebas-neue", caption_font: "bebas-neue" }, { font: bebas, fonts: { "bebas-neue": bebas } });
  assert.ok(Math.abs(main - same) < 1e-6);
  const other = await volume({ font: "bebas-neue", caption_font: "pacifico" }, { font: bebas, fonts: { pacifico } });
  assert.ok(Math.abs(main - other) > 1e-3, "the caption switched font");
  const block = await volume({ font: "bebas-neue", caption_font: "block" }, { font: bebas, fonts: {} });
  assert.ok(Math.abs(main - block) > 1e-3);
  await assert.rejects(() => build(paramsFor({ caption_font: "pacifico" }), { wasm, font: null, fonts: {} }), /isn't loaded/);
});

test("decorated builds free every temporary, even when they fail", async () => {
  const value = paramsFor({ corner_style: "notch", corner_radius_mm: 3, border_style: "engraved", frame_style: "raised", divider: "both" });
  for (const extra of [{}, { corner_style: "chamfer" }, { icon: "mug", rating: 5 }]) {
    const tracker = trackLiveObjects(wasm);
    try {
      const built = await build({ ...value, ...extra }, { wasm: tracker.ctxWasm, font: null });
      assert.equal(tracker.live.size, built.solids.length, JSON.stringify(extra));
      built.solids.forEach(s => s.solid.delete());
      assert.equal(tracker.live.size, 0);
    } finally { tracker.restore(); }
  }
  // Bypasses the rule on purpose: the build is the backstop.
  const tracker = trackLiveObjects(wasm);
  try {
    await assert.rejects(() => build({ ...value, thickness_mm: 1.2, groove_depth_mm: 0.6 }, { wasm: tracker.ctxWasm, font: null }), /at least 0.6 mm of card/);
    assert.equal(tracker.live.size, 0);
  } finally { tracker.restore(); }
  assert.equal(gen.errorField("Engraved lines need at least 0.6 mm of card under them."), "groove_depth_mm");
});

test("the whole model goes through the 3MF writer with every preset", async () => {
  for (const name of Object.keys(gen.presets)) {
    const out = await buildModel(gen, paramsFor(gen.presets[name]), { wasm, font: null });
    assert.ok(out.parts.length >= 4, name);
    assert.ok(out.metrics.unique_colors <= 5);
  }
});
