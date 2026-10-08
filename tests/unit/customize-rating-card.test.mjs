import assert from "node:assert/strict";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import { loadEngine } from "../../customizer/framework/engine.js";
import { buildModel } from "../../customizer/framework/model.js";
import { getGenerator } from "../../public/assets/js/customize/registry.js";
import { clampParams, validateParams } from "../../public/assets/js/customize/schema.js";
import { contrastRatio } from "../../public/assets/js/customize/color.js";
import { analyzeModelBytes } from "../../public/assets/js/print-estimation/geometry.js";
import { renderFormHtml } from "../../customizer/framework/form.js";
import { normalizeCustomization } from "../../lib/customization/domain.js";
import build, { planLayout, CARD } from "../../customizer/generators/rating-card/build.js";
import { traceImage } from "../../customizer/framework/image-trace.js";
import { trackLiveObjects } from "../support/manifold-live.mjs";

const wasm = await loadEngine();
const gen = { ...getGenerator("rating-card"), build };
const inflateRaw = async (b, max) => new Uint8Array(inflateRawSync(b, { maxOutputLength: max }));
const paramsFor = (extra = {}) => {
  const { ok, errors, value } = validateParams(gen, extra);
  assert.ok(ok, errors.join("; "));
  return value;
};
const part = (out, name) => out.parts.find(p => p.name === name);
const partVolume = async (out, name) => {
  const p = part(out, name);
  if (!p) return 0;
  // Signed volume of a closed triangle mesh.
  let v = 0;
  for (const [a, b, c] of p.mesh.triangles) {
    const [p0, p1, p2] = [a, b, c].map(i => p.mesh.vertices[i]);
    v += (p0[0] * (p1[1] * p2[2] - p1[2] * p2[1]) - p0[1] * (p1[0] * p2[2] - p1[2] * p2[0]) + p0[2] * (p1[0] * p2[1] - p1[1] * p2[0])) / 6;
  }
  return v;
};

// A small traced "image": a filled disc on white, as the page would trace it.
function discContours() {
  const W = 48, H = 48, px = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - 24) ** 2 + (y - 24) ** 2 < 18 ** 2) { const i = (y * W + x) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
  return traceImage({ pixels: px, width: W, height: H });
}

test("generator definition: id, version, category, provenance", () => {
  assert.equal(gen.id, "rating-card");
  assert.equal(gen.version, 2);
  assert.equal(gen.category, "cards");
  assert.equal(gen.origin, "house");
  assert.deepEqual(gen.rights, { publishable: true, note: "House design." });
  assert.deepEqual(Object.keys(gen.presets).sort(), ["dark", "heart", "house", "mug", "ticket", "toilet"]);
  for (const name of ["heart", "house", "mug", "toilet"]) assert.equal(paramsFor(gen.presets[name]).icon, name);
});

test("defaults: toilet, 3.5 stars, the caption, business-card colors", () => {
  const p = paramsFor();
  assert.equal(p.icon, "toilet");
  assert.equal(p.rating, 3.5);
  assert.equal(p.caption, "Would poop here again");
  assert.equal(p.show_stars, true);
  assert.equal(p.thickness_mm, 1.6);
  assert.equal(p.relief_mm, 0.6);
  assert.equal(p.corner_radius_mm, 3);
  assert.equal(p.image_threshold, 128);
  assert.equal(p.image_invert, false);
  assert.equal(p.image_scale_pct, 100);
});

test("the canonical card builds at business-card size with five or fewer colors", async () => {
  const { ok, value } = validateParams(gen, { icon: "toilet", rating: 3.5, caption: "Would poop here again" });
  assert.ok(ok);
  const out = await buildModel(gen, value, { wasm, font: null });
  const a = await analyzeModelBytes({ name: out.filename, bytes: out.data, inflateRaw });
  assert.ok(Math.abs(a.dimensionsMm[0] - 85.6) < 0.5 && Math.abs(a.dimensionsMm[1] - 54) < 0.5, a.dimensionsMm.join("x"));
  assert.ok(Math.abs(a.dimensionsMm[2] - 1.6) < 0.01, `height ${a.dimensionsMm[2]}`);
  assert.equal(out.metrics.unique_colors, 5);
  assert.deepEqual(out.parts.map(p => p.name), ["Card base", "Icon", "Empty stars", "Filled stars", "Caption"]);
  assert.deepEqual(out.warnings, []);
  assert.equal(out.filename, "rating-card-Would-poop-here-again.3mf");
});

test("the caption default uses only characters the block font draws", async () => {
  const { unsupportedBlockChars } = await import("../../customizer/framework/text.js");
  assert.deepEqual(unsupportedBlockChars(paramsFor().caption), []);
});

test("half stars: 3.5 has more filled area than 3 and less than 4; the star row's total stays the same", async () => {
  const at = async r => buildModel(gen, paramsFor({ rating: r }), { wasm, font: null });
  const outs = await Promise.all([3, 3.5, 4].map(at));
  const filled = await Promise.all(outs.map(o => partVolume(o, "Filled stars")));
  const empty = await Promise.all(outs.map(o => partVolume(o, "Empty stars")));
  assert.ok(filled[0] < filled[1] && filled[1] < filled[2], filled.join(" < "));
  // A half star fills half of one star (the star is symmetric about its vertical axis).
  const oneStar = filled[2] - filled[0];
  assert.ok(Math.abs((filled[1] - filled[0]) / oneStar - 0.5) < 0.02, `half fraction ${(filled[1] - filled[0]) / oneStar}`);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(filled[i] + empty[i] - (filled[0] + empty[0])) < 0.01, "filled + empty is always five stars");
});

test("rating 0 has no filled stars and rating 5 has no empty stars", async () => {
  const zero = await buildModel(gen, paramsFor({ rating: 0 }), { wasm, font: null });
  assert.equal(part(zero, "Filled stars"), undefined);
  assert.ok(part(zero, "Empty stars"));
  const five = await buildModel(gen, paramsFor({ rating: 5 }), { wasm, font: null });
  assert.equal(part(five, "Empty stars"), undefined);
  assert.ok(part(five, "Filled stars"));
  const hidden = await buildModel(gen, paramsFor({ show_stars: false }), { wasm, font: null });
  assert.equal(hidden.parts.some(p => /stars/i.test(p.name)), false);
});

test("rating 0 and 5 are valid; 5.5 and 3.3 are not", () => {
  assert.equal(validateParams(gen, { rating: 0 }).ok, true);
  assert.equal(validateParams(gen, { rating: 5 }).ok, true);
  assert.equal(validateParams(gen, { rating: 5.5 }).ok, false);
  assert.equal(validateParams(gen, { rating: 3.3 }).ok, false);
  assert.equal(clampParams(gen, { ...paramsFor(), rating: 3.3 }, "rating").rating, 3.5);
});

test("layout: icon, star row and caption band are separated and inside the card margin", () => {
  for (const show_stars of [true, false]) {
    const L = planLayout({ ...paramsFor({ show_stars }) });
    const inside = (b, what) => {
      assert.ok(b.x0 >= -CARD.w / 2 + L.margin - 1e-9 && b.x1 <= CARD.w / 2 - L.margin + 1e-9, `${what} x inside`);
      assert.ok(b.y0 >= -CARD.h / 2 + L.margin - 1e-9 && b.y1 <= CARD.h / 2 - L.margin + 1e-9, `${what} y inside`);
    };
    const apart = (a, b, what) => assert.ok(a.x1 + L.gap <= b.x0 || b.x1 + L.gap <= a.x0 || a.y1 + L.gap <= b.y0 || b.y1 + L.gap <= a.y0, what);
    inside(L.icon, "icon"); inside(L.caption, "caption");
    apart(L.icon, L.caption, "icon/caption");
    if (show_stars) {
      inside(L.stars.box, "stars");
      apart(L.icon, L.stars.box, "icon/stars");
      apart(L.stars.box, L.caption, "stars/caption");
      // Neighboring stars: tip-to-tip gap at least 1 mm (star width is 2·R·sin 72°).
      const width = 2 * L.stars.r * Math.sin((72 * Math.PI) / 180);
      assert.ok(L.stars.pitch - width >= 1.0 - 1e-9, `star gap ${L.stars.pitch - width}`);
      assert.equal(L.stars.centers.length, 5);
    }
  }
  assert.ok(CARD.w === 85.6 && CARD.h === 54);
});

test("parts never overlap: the sum of part volumes equals the union volume (within 0.5%)", async () => {
  const { Manifold } = wasm;
  for (const extra of [{}, { rating: 5 }, { icon: "mug", rating: 0.5 }, { icon: "house", caption: "W".repeat(40) }, { icon: "heart", show_stars: false }]) {
    const value = paramsFor(extra);
    const built = await build(value, { wasm, font: null });
    try {
      const sum = built.solids.reduce((s, x) => s + x.solid.volume(), 0);
      const union = Manifold.union(built.solids.map(x => x.solid));
      const u = union.volume();
      union.delete();
      assert.ok(Math.abs(sum - u) / u < 0.005, `${JSON.stringify(extra)}: sum ${sum} vs union ${u}`);
    } finally { built.solids.forEach(s => s.solid.delete()); }
  }
});

test("the relief is clipped by the card only as a safety net: nothing visible is cut off", async () => {
  for (const extra of [{}, { icon: "custom", image_scale_pct: 120 }, { corner_radius_mm: 8 }]) {
    const built = await build(paramsFor(extra), { wasm, font: null, imageContours: discContours() });
    try { assert.ok(built.clippedArea < 0.01, `${JSON.stringify(extra)} clipped ${built.clippedArea}`); }
    finally { built.solids.forEach(s => s.solid.delete()); }
  }
});

test("a 40-character caption fits by splitting onto two lines and an empty caption is allowed", async () => {
  const long = validateParams(gen, { caption: "W".repeat(40) });
  assert.ok(long.ok);
  const out = await buildModel(gen, long.value, { wasm, font: null });
  assert.deepEqual(out.warnings, []);
  assert.ok(part(out, "Caption"));
  assert.equal(validateParams(gen, { caption: "W".repeat(41) }).ok, false);
  const empty = validateParams(gen, { caption: "" });
  assert.equal(empty.ok, true);
  const none = await buildModel(gen, empty.value, { wasm, font: null });
  assert.equal(part(none, "Caption"), undefined);
  assert.equal(none.filename, "rating-card.3mf");
});

test("caption: unsupported characters become '?' with a warning; the filename and title stay plain", async () => {
  const out = await buildModel(gen, paramsFor({ caption: "<b>5★ café</b>" }), { wasm, font: null });
  assert.ok(out.warnings.some(w => /replaced with '\?'/.test(w)));
  assert.match(out.filename, /^[A-Za-z0-9_-]+\.3mf$/);
  assert.ok(out.filename.length <= 44);
  const { unzipSync, strFromU8 } = await import("fflate");
  const xml = strFromU8(unzipSync(out.data)["3D/3dmodel.model"]);
  assert.ok(!xml.includes("<b>"), "markup in the caption is escaped in the 3MF");
});

test("a custom image is used when icon is custom and refused when absent", async () => {
  const { value } = validateParams(gen, { icon: "custom" });
  await assert.rejects(() => buildModel(gen, value, { wasm, font: null, imageContours: null }), /choose an image/i);
  const out = await buildModel(gen, value, { wasm, font: null, imageContours: discContours() });
  assert.ok(part(out, "Icon"));
  const small = await buildModel(gen, { ...value, image_scale_pct: 50 }, { wasm, font: null, imageContours: discContours() });
  assert.ok(await partVolume(small, "Icon") < (await partVolume(out, "Icon")) * 0.4);
});

test("the image scale applies only to a custom image, never to the built-in icons", async () => {
  const a = await buildModel(gen, paramsFor({ image_scale_pct: 30 }), { wasm, font: null });
  const b = await buildModel(gen, paramsFor({ image_scale_pct: 120 }), { wasm, font: null });
  assert.ok(Math.abs(await partVolume(a, "Icon") - await partVolume(b, "Icon")) < 1e-6);
});

test("malformed or oversized traced data is refused with a readable error", async () => {
  const value = paramsFor({ icon: "custom" });
  for (const bad of ["x", [[[0, 0], [1, 1]]], [[[0, 0], [Number.NaN, 0], [1, 1]]], [Array.from({ length: 200_001 }, (_, i) => [i % 7, i % 11])]]) {
    await assert.rejects(() => buildModel(gen, value, { wasm, font: null, imageContours: bad }), /image|outline/i);
  }
});

test("the traced image never reaches the params, the 3MF metadata or the provenance record", async () => {
  const value = paramsFor({ icon: "custom" });
  assert.equal(Object.keys(value).some(k => /contour|pixels|file|name/i.test(k)), false);
  assert.equal(validateParams(gen, { ...value, imageContours: discContours() }).ok, false, "unknown keys are refused");
  const out = await buildModel(gen, value, { wasm, font: null, imageContours: discContours() });
  const { unzipSync, strFromU8 } = await import("fflate");
  const files = unzipSync(out.data);
  // (The slicer profile has an unrelated "xy_contour_compensation" setting, so check the
  // generator's own metadata and the model's metadata elements.)
  const meta = strFromU8(files["Metadata/customizer.json"]) + (strFromU8(files["3D/3dmodel.model"]).match(/<metadata[^>]*>[^<]*<\/metadata>/g) ?? []).join("\n");
  assert.ok(meta.includes("rating-card"));
  assert.ok(!/contour|imageContours|\[\[/i.test(meta), meta);
  const record = normalizeCustomization({ generatorId: "rating-card", generatorVersion: 1, params: value });
  assert.ok(!JSON.stringify(record).includes("[["), "no coordinates in the record");
});

test("contrast rules: base vs icon, star and text colors at 3:1, naming both fields", () => {
  assert.ok(contrastRatio("#ffffff", gen.schema.star_color.default) >= 3);
  for (const key of ["icon_color", "star_color", "text_color"]) {
    const r = validateParams(gen, { base_color: "#ffffff", [key]: "#eeeeee" });
    assert.equal(r.ok, false, key);
    assert.ok(r.fieldErrors.base_color && r.fieldErrors[key], key);
    assert.match(r.fieldErrors[key], /too similar/);
  }
  assert.equal(validateParams(gen, { base_color: "#ffffff", empty_star_color: "#fefefe" }).ok, true, "empty stars need no contrast rule");
  assert.equal(validateParams(gen, { show_stars: false, star_color: "#fefefe" }).ok, true, "hidden stars need no contrast");
  assert.equal(validateParams(gen, { caption: "", text_color: "#fefefe" }).ok, true, "no caption, no text contrast rule");
  // Exactly at 3:1 passes.
  assert.equal(validateParams(gen, { base_color: "#ffffff", icon_color: "#949494" }).ok, contrastRatio("#ffffff", "#949494") >= 3);
});

test("relief depth leaves at least 0.8 mm of card under the relief", () => {
  const r = validateParams(gen, { thickness_mm: 1.2, relief_mm: 0.6 });
  assert.equal(r.ok, false);
  assert.ok(r.fieldErrors.relief_mm);
  assert.deepEqual(gen.rules({ ...paramsFor(), thickness_mm: 1.2 }).limits.relief_mm, [0.4, 0.4]);
  assert.equal(clampParams(gen, { ...paramsFor(), relief_mm: 1.2, thickness_mm: 1.4 }, "thickness_mm").relief_mm, 0.6);
});

test("errorField maps image and caption geometry errors to their controls", () => {
  assert.equal(gen.errorField("Choose an image first, or pick a built-in icon."), "icon");
  assert.equal(gen.errorField("The traced image is too detailed."), "icon");
  assert.equal(gen.errorField("The caption is too long to print legibly on the card. Shorten it."), "caption");
  assert.equal(gen.errorField("something else"), null);
});

test("the image controls are shown only for a custom icon", () => {
  const html = renderFormHtml(gen, paramsFor());
  for (const key of ["image_threshold", "image_invert", "image_scale_pct"]) assert.match(html, new RegExp(`data-field="${key}" hidden>`));
  const custom = renderFormHtml(gen, paramsFor({ icon: "custom" }));
  for (const key of ["image_threshold", "image_invert", "image_scale_pct"]) assert.doesNotMatch(custom, new RegExp(`data-field="${key}" hidden>`));
  assert.match(html, /id="cz-rating-range"[^>]*step="0.5"/);
});

test("build() frees every temporary: only the returned solids stay alive", async () => {
  const cases = [{}, { rating: 0 }, { rating: 5 }, { rating: 2.5, icon: "heart" }, { icon: "house", caption: "" }, { icon: "mug", show_stars: false }, { caption: "W".repeat(40) }, { icon: "custom" }, { corner_radius_mm: 0 }];
  for (const extra of cases) {
    const value = paramsFor(extra);
    const tracker = trackLiveObjects(wasm);
    try {
      const built = await build(value, { wasm: tracker.ctxWasm, font: null, imageContours: discContours() });
      assert.equal(tracker.live.size, built.solids.length, `live ${tracker.live.size} vs solids ${built.solids.length} (${JSON.stringify(extra)})`);
      for (const s of built.solids) assert.ok(tracker.live.has(s.solid));
      built.solids.forEach(s => s.solid.delete());
      assert.equal(tracker.live.size, 0);
    } finally { tracker.restore(); }
  }
});

test("failed builds do not leak either", async () => {
  const tracker = trackLiveObjects(wasm);
  try {
    await assert.rejects(() => build(paramsFor({ icon: "custom" }), { wasm: tracker.ctxWasm, font: null }), /choose an image/i);
    assert.equal(tracker.live.size, 0);
    await assert.rejects(() => build(paramsFor({ icon: "custom" }), { wasm: tracker.ctxWasm, font: null, imageContours: [[[0, 0], [1, 1]]] }), /image/i);
    assert.equal(tracker.live.size, 0);
    // A caption that splits badly (one 38-character word) is too small to read: an error.
    await assert.rejects(() => build(paramsFor({ caption: `A ${"W".repeat(38)}` }), { wasm: tracker.ctxWasm, font: null }), /caption is too long/i);
    assert.equal(tracker.live.size, 0);
    // A traced image of nothing but specks smaller than the nozzle can print.
    const specks = [];
    for (let i = 0; i < 40; i += 4) specks.push([[i, 0], [i + 1, 0], [i + 1, 1], [i, 1]]);
    await assert.rejects(() => build(paramsFor({ icon: "custom", image_scale_pct: 30 }), { wasm: tracker.ctxWasm, font: null, imageContours: specks }), /too (small|thin)|nothing/i);
    assert.equal(tracker.live.size, 0);
  } finally { tracker.restore(); }
});

test("the server re-validates a rating-card customization", () => {
  const ok = normalizeCustomization({ generatorId: "rating-card", generatorVersion: 1, params: paramsFor() });
  assert.equal(ok.generatorId, "rating-card");
  assert.throws(() => normalizeCustomization({ generatorId: "rating-card", generatorVersion: 1, params: { rating: 3.3 } }), err => err.status === 400);
});

test("the hand-off record never carries traced contours, even if they leak into the page state", async () => {
  // The image check moved to customize-image-input.test.mjs (sniffed bytes, not the claimed type).
  const { continuePayload, continueToOrder } = await import("../../customizer/framework/continue.js");
  const contours = discContours();
  const marker = JSON.stringify(contours[0]);
  const out = await buildModel(gen, paramsFor({ icon: "custom" }), { wasm, font: null, imageContours: contours });
  // Worst case: a careless page put the contours (and a file name) into its params and result.
  const pageParams = { ...paramsFor({ icon: "custom" }), imageContours: contours, imageName: "secret-paw.png" };
  const pageResult = { ...out, imageContours: contours };
  const payload = continuePayload(gen, pageParams, pageResult);
  let written = null;
  await continueToOrder(payload, { writeHandoff: async record => { written = record; }, download() {}, navigate() {} });
  const { file, ...record } = written;
  assert.ok(file instanceof Blob);
  const text = JSON.stringify(record);
  assert.ok(!text.includes(marker) && !text.includes("[[") && !/contour|secret-paw/i.test(text), text);
  assert.deepEqual(Object.keys(record.params).sort(), Object.keys(gen.schema).sort(), "only schema parameters are handed off");
});

test("the dark preset passes every contrast rule and builds with no warnings", async () => {
  const value = paramsFor(gen.presets.dark);
  assert.equal(value.base_color, "#1d2733");
  const out = await buildModel(gen, value, { wasm, font: null });
  assert.deepEqual(out.warnings, []);
  assert.equal(out.metrics.unique_colors, 5);
});

test("filled and empty stars that look alike are a warning naming both colors, not an error", async () => {
  assert.equal(validateParams(gen, { empty_star_color: "#bf8300" }).ok, true);
  const out = await buildModel(gen, paramsFor({ empty_star_color: "#c08401" }), { wasm, font: null });
  assert.ok(out.warnings.some(w => /Star color and Empty star color are very similar/.test(w)), out.warnings.join("|"));
  const ok = await buildModel(gen, paramsFor(), { wasm, font: null });
  assert.ok(contrastRatio(gen.schema.star_color.default, gen.schema.empty_star_color.default) >= 1.5);
  assert.deepEqual(ok.warnings, []);
  const hidden = await buildModel(gen, paramsFor({ show_stars: false, empty_star_color: "#bf8300" }), { wasm, font: null });
  assert.deepEqual(hidden.warnings, [], "no stars, no star warning");
});
