// Pumpkin generator: schema rules, builds on real Manifold across every type and option, the
// joinery (peg hole, bowl joint), single-color behaviour, leak guard and readable failures.
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import test from "node:test";
import { loadEngine } from "../../customizer/framework/engine.js";
import { buildModel } from "../../customizer/framework/model.js";
import { loadBuilder } from "../../customizer/generators/index.js";
import { groupFields, hasAdvanced, isFieldVisible, renderFormHtml } from "../../customizer/framework/form.js";
import pumpkin from "../../public/assets/js/customize/generators/pumpkin.js";
import { clampParams, validateParams } from "../../public/assets/js/customize/schema.js";
import { analyzeModelBytes } from "../../public/assets/js/print-estimation/geometry.js";
import { trackLiveObjects } from "../support/manifold-live.mjs";

const wasm = await loadEngine();
const { default: build } = await loadBuilder.pumpkin();
const gen = { ...pumpkin, build };
const inflateRaw = async (b, max) => new Uint8Array(inflateRawSync(b, { maxOutputLength: max }));
const defaults = Object.fromEntries(Object.entries(pumpkin.schema).map(([k, d]) => [k, d.default]));
const check = over => validateParams(pumpkin, clampParams(pumpkin, { ...defaults, ...over }));
const ok = over => { const r = check(over); assert.ok(r.ok, r.errors.join("; ")); return r.value; };

async function make(over, { ctxWasm = wasm } = {}) {
  const out = await buildModel(gen, ok(over), { wasm: ctxWasm, font: null });
  const analysis = await analyzeModelBytes({ name: out.filename, bytes: out.data, inflateRaw });
  return { out, analysis, names: out.parts.map(p => p.name) };
}
const clean = a => a.analysis.warnings.filter(w => w !== "embedded_settings_ignored");

// ---- Schema and rules ---------------------------------------------------------------------

test("defaults validate; the default design equals the defaults and every design is valid", () => {
  assert.ok(validateParams(pumpkin, {}).ok);
  assert.equal(pumpkin.designs.find(d => d.id === pumpkin.defaultDesign).params && Object.keys(pumpkin.designs.find(d => d.id === pumpkin.defaultDesign).params).length, 0, "the default design adds nothing to the defaults");
  for (const d of pumpkin.designs) {
    for (const key of Object.keys(d.params)) assert.ok(Object.hasOwn(pumpkin.schema, key), `${d.id}: unknown key ${key}`);
    const r = check(d.params);
    assert.ok(r.ok, `${d.id}: ${r.errors.join("; ")}`);
  }
});

test("parameters stay well under the server's 8000-byte limit", () => {
  assert.ok(JSON.stringify(ok({})).length < 2500);
});

test("vase mode and an open top ignore the face and stem but keep the customer's choices", async () => {
  const v = ok({ style: "vase", face: "cute", stem: "peg" });
  assert.equal(v.face, "cute", "kept, so switching back to Solid restores it");
  assert.equal(v.stem, "peg");
  const vase = await make({ style: "vase", face: "cute", stem: "peg" });
  assert.deepEqual(vase.names, ["Pumpkin"], "no face or stem part in a vase");
  const open = await make({ style: "hollow", opening: "top", face: "none", stem: "fused" });
  assert.deepEqual(open.names, ["Pumpkin"], "an open top gets no stem");
  assert.equal(ok({ style: "hollow", opening: "top", stem: "fused" }).stem, "fused");
  // A rule on a face the vase never prints must not block it.
  assert.ok(check({ style: "vase", face: "cute", diameter_mm: 50, face_size_pct: 30 }).ok);
});

test("a cut-through face needs a hollow shell or a bowl", () => {
  const r = check({ style: "solid", face_style: "cutout" });
  assert.equal(r.ok, false);
  assert.match(r.fieldErrors.face_style, /hollow/);
  assert.ok(check({ style: "hollow", face_style: "cutout", multicolor: false }).ok);
  assert.ok(check({ style: "bowl", wall_mm: 2.4, face_style: "cutout", face_height_pct: 30, face_size_pct: 40 }).ok);
});

test("a lattice needs a hollow shell and no face", () => {
  assert.match(check({ style: "solid", decoration: "lattice" }).fieldErrors.decoration, /hollow/);
  assert.match(check({ style: "bowl", wall_mm: 2.4, decoration: "lattice", face: "none" }).fieldErrors.decoration, /hollow/);
  assert.match(check({ style: "hollow", decoration: "lattice", face: "cute" }).fieldErrors.face, /lattice/i);
  assert.ok(check({ style: "hollow", decoration: "lattice", face: "none", multicolor: false }).ok);
});

test("walls: hollow shells need 1.2 mm, bowls 2 mm, and grooves plus texture must leave 0.8 mm", () => {
  assert.equal(clampParams(pumpkin, { ...defaults, style: "bowl", wall_mm: 1.6 }, "style").wall_mm, 2, "choosing a bowl lifts the wall");
  assert.match(validateParams(pumpkin, { ...defaults, style: "bowl", wall_mm: 1.6 }).fieldErrors.wall_mm, /bowl needs/);
  assert.match(check({ style: "hollow", wall_mm: 1.2, rib_depth_pct: 25, decoration: "knit", texture_depth_mm: 1, tealight_fit: false }).fieldErrors.wall_mm ?? "", /too thin/);
});

test("tealight fit: too small a pumpkin is refused with the diameter that works", () => {
  const r = validateParams(pumpkin, { ...defaults, style: "hollow", opening: "bottom", tealight_fit: true, diameter_mm: 60 });
  assert.equal(r.ok, false);
  assert.match(r.fieldErrors.diameter_mm, /at least \d+ mm wide/);
  const need = Number(/at least (\d+) mm/.exec(r.fieldErrors.diameter_mm)[1]);
  assert.ok(validateParams(pumpkin, { ...defaults, style: "hollow", opening: "bottom", tealight_fit: true, diameter_mm: need }).ok);
});

test("face rules: color contrast, minimum size and placement", () => {
  assert.match(check({ face_color: "#f28a1d" }).fieldErrors.face_color, /too similar/);
  assert.ok(check({ face_color: "#f28a1d", multicolor: false }).ok, "no contrast needed when everything is one color");
  assert.match(check({ diameter_mm: 50, face_size_pct: 30 }).fieldErrors.face_size_pct, /at least 24 mm/);
  assert.match(check({ face_height_pct: 75, face_size_pct: 90 }).fieldErrors.face_size_pct, /top of the pumpkin/);
  assert.match(check({ style: "bowl", wall_mm: 2.4, split_pct: 55, face_height_pct: 50 }).fieldErrors.split_pct, /reaches the lid/);
});

test("a peg is limited by the stem width", () => {
  assert.match(validateParams(pumpkin, { ...defaults, stem: "peg", stem_width_mm: 7, peg_diameter_mm: 8 }).fieldErrors.peg_diameter_mm, /at most/);
});

// ---- Simple / Advanced ---------------------------------------------------------------------

test("advanced fields hide in Simple mode but remain in the schema, validated and built", () => {
  assert.ok(hasAdvanced(pumpkin));
  const advanced = Object.entries(pumpkin.schema).filter(([, d]) => d.advanced).map(([k]) => k);
  const simple = Object.entries(pumpkin.schema).filter(([, d]) => !d.advanced).map(([k]) => k);
  assert.ok(advanced.length >= 15 && simple.length >= 8 && simple.length <= 16, `${simple.length} simple controls`);
  for (const k of ["style", "diameter_mm", "segments", "decoration", "face", "stem", "multicolor", "body_color"]) assert.ok(simple.includes(k), `${k} is a simple control`);
  const values = ok({});
  assert.equal(isFieldVisible(pumpkin.schema.boxiness_pct, values, false), false);
  assert.equal(isFieldVisible(pumpkin.schema.boxiness_pct, values, true), true);
  assert.equal(isFieldVisible(pumpkin.schema.style, values, false), true);
  const html = renderFormHtml(pumpkin, values, { advanced: false });
  assert.match(html, /data-field="boxiness_pct" hidden/);
  assert.doesNotMatch(html, /data-field="style" hidden/);
  assert.ok(html.includes('name="boxiness_pct"'), "hidden advanced controls are still rendered, so they keep their values");
  assert.doesNotMatch(renderFormHtml(pumpkin, values, { advanced: true }), /data-field="boxiness_pct" hidden/);
});

test("other generators have no advanced fields and keep every control", async () => {
  const { GENERATORS } = await import("../../public/assets/js/customize/registry.js");
  for (const g of Object.values(GENERATORS)) if (g.id !== "pumpkin") assert.equal(hasAdvanced(g), false, g.id);
  const route = GENERATORS["route-shield"];
  assert.doesNotMatch(renderFormHtml(route, validateParams(route, {}).value, { advanced: false }), /data-field="top_text" hidden/);
});

test("sections list every field once", () => {
  const keys = groupFields(pumpkin, "section").flatMap(g => g.keys);
  assert.deepEqual([...keys].sort(), Object.keys(pumpkin.schema).sort());
});

// ---- Builds ---------------------------------------------------------------------------------

const MATRIX = [
  ["solid, cute inlay, fused stem", {}, ["Pumpkin", "Face", "Cheeks", "Stem"], 4],
  ["solid, engraved face", { face_style: "engraved", multicolor: true }, ["Pumpkin", "Stem"], 2],
  ["solid, single color: inlay becomes engraving, fused stem merges", { multicolor: false }, ["Pumpkin"], 1],
  ["solid, peg stem, no face", { stem: "peg", face: "none" }, ["Pumpkin", "Stem"], 2],
  ["solid, no stem, no face", { stem: "none", face: "none" }, ["Pumpkin"], 1],
  ["solid, traditional inlay", { face: "traditional" }, ["Pumpkin", "Face", "Stem"], 3],
  ["solid, custom face", { face: "custom", eye_shape: "star", nose_shape: "nostrils", mouth_shape: "cat", cheeks: false }, ["Pumpkin", "Face", "Stem"], 3],
  ["solid, ridged", { decoration: "ridges" }, ["Pumpkin", "Face", "Cheeks", "Stem"], 4],
  ["solid, knitted", { decoration: "knit" }, ["Pumpkin", "Face", "Cheeks", "Stem"], 4],
  ["hollow open bottom, cut-through face", { style: "hollow", opening: "bottom", face: "traditional", face_style: "cutout", multicolor: false, stem: "peg", diameter_mm: 110 }, ["Pumpkin", "Stem"], 1],
  ["hollow open bottom, inlay face, fused stem", { style: "hollow", opening: "bottom", diameter_mm: 100 }, ["Pumpkin", "Face", "Cheeks", "Stem"], 4],
  ["hollow sealed", { style: "hollow", opening: "closed", face: "none" }, ["Pumpkin", "Stem"], 2],
  ["hollow open top", { style: "hollow", opening: "top", face: "spooky", face_style: "cutout", multicolor: false }, ["Pumpkin"], 1],
  ["hollow lattice diamonds", { style: "hollow", decoration: "lattice", face: "none", diameter_mm: 120, multicolor: false, stem: "peg" }, ["Pumpkin", "Stem"], 1],
  ["hollow lattice circles", { style: "hollow", decoration: "lattice", lattice_shape: "round", face: "none", diameter_mm: 120, multicolor: false }, ["Pumpkin"], 1],
  ["hollow lattice slots", { style: "hollow", decoration: "lattice", lattice_shape: "slot", face: "none", diameter_mm: 120, multicolor: false }, ["Pumpkin"], 1],
  ["hollow ridged tealight", { style: "hollow", decoration: "ridges", segments: 12, face: "none", diameter_mm: 120, multicolor: false, tealight_fit: true }, ["Pumpkin"], 1],
  ["bowl with lid and peg stem", { style: "bowl", wall_mm: 2.4, stem: "peg", face: "none", diameter_mm: 120 }, ["Bowl", "Lid", "Stem"], 2],
  ["bowl with a face and attached stem", { style: "bowl", wall_mm: 2.4, face: "happy", face_height_pct: 35, face_size_pct: 45 }, ["Bowl", "Face", "Cheeks", "Lid", "Stem"], 4],
  ["vase", { style: "vase", segments: 12, rib_depth_pct: 14 }, ["Pumpkin"], 1],
  ["oblong twisted irregular", { oblong_pct: 20, twist_deg: -60, irregularity_pct: 90, taper_pct: 25, face: "sleepy" }, ["Pumpkin", "Face", "Stem"], 3]
];

for (const [label, over, names, colors] of MATRIX) {
  test(`builds: ${label}`, async () => {
    const started = performance.now();
    const m = await make(over);
    assert.ok(performance.now() - started < 6000, "under six seconds");
    assert.deepEqual(m.names, names);
    assert.equal(m.out.metrics.unique_colors, colors);
    assert.deepEqual(clean(m), [], "analyzer clean");
    assert.ok(m.analysis.volumeMm3 > 100);
  });
}

test("extreme shapes build: boxy, max dimple, max taper both ways, twist, sharp deep grooves", async () => {
  for (const over of [
    { boxiness_pct: 100, dimple_pct: 20, height_pct: 55 }, { taper_pct: 30, height_pct: 130 }, { taper_pct: -30, height_pct: 55 },
    { twist_deg: 90, segments: 16, rib_sharpness: 8, rib_depth_pct: 25 }, { twist_deg: -90, oblong_pct: 25, irregularity_pct: 100 },
    { diameter_mm: 50, height_pct: 55 }, { diameter_mm: 180 }
  ]) {
    const m = await make({ ...over, face: "none", stem: "none" });
    assert.deepEqual(clean(m), [], JSON.stringify(over));
  }
  for (const over of [{ style: "hollow", opening: "bottom", boxiness_pct: 100, dimple_pct: 20, rib_depth_pct: 25, rib_sharpness: 8, wall_mm: 3 }, { style: "hollow", taper_pct: -30, twist_deg: 90, wall_mm: 2 }]) {
    const m = await make({ ...over, face: "none", stem: "none" });
    assert.deepEqual(clean(m), [], JSON.stringify(over));
  }
});

test("the same settings build the same model (deterministic)", async () => {
  const a = await make({ irregularity_pct: 70, seed: 5 }), b = await make({ irregularity_pct: 70, seed: 5 }), c = await make({ irregularity_pct: 70, seed: 6 });
  assert.equal(a.analysis.volumeMm3, b.analysis.volumeMm3);
  assert.notEqual(a.analysis.volumeMm3, c.analysis.volumeMm3);
});

test("hollow shells are hollow: far lighter than solid, with the wall about as asked", async () => {
  const solid = await make({ face: "none", stem: "none" });
  const shell = await make({ style: "hollow", opening: "bottom", face: "none", stem: "none", wall_mm: 2 });
  assert.ok(shell.analysis.volumeMm3 < solid.analysis.volumeMm3 * 0.25, `${shell.analysis.volumeMm3} vs ${solid.analysis.volumeMm3}`);
  const thin = await make({ style: "hollow", opening: "bottom", face: "none", stem: "none", wall_mm: 1.2 });
  assert.ok(thin.analysis.volumeMm3 < shell.analysis.volumeMm3);
});

test("a cut-through face removes material; an inlay does not change the total", async () => {
  const none = await make({ style: "hollow", face: "none", stem: "none", multicolor: false });
  const cut = await make({ style: "hollow", face: "traditional", face_style: "cutout", stem: "none", multicolor: false });
  assert.ok(cut.analysis.volumeMm3 < none.analysis.volumeMm3 - 100);
  const inlay = await make({ style: "hollow", face: "traditional", face_style: "inlay", stem: "none", cheeks: false });
  assert.ok(Math.abs(inlay.analysis.volumeMm3 - none.analysis.volumeMm3) < 5, "the inlay fills what the body gives up");
});

test("the inlay is a partition of the body: body + inlay volume equals the plain pumpkin", async () => {
  const plain = await make({ face: "none", stem: "none" });
  const inlaid = await make({ face: "traditional", stem: "none" });
  assert.ok(Math.abs(inlaid.analysis.volumeMm3 - plain.analysis.volumeMm3) < 5);
  assert.equal(inlaid.names.length, 2);
});

test("peg stem: the pumpkin gets a socket (less material), the stem lies on the bed upside down with its peg up", async () => {
  const none = await make({ face: "none", stem: "none" });
  const peg = await make({ face: "none", stem: "peg" });
  const body = peg.out.parts.find(p => p.name === "Pumpkin");
  const bodyVolume = none.analysis.volumeMm3;
  assert.ok(peg.analysis.volumeMm3 > bodyVolume, "the loose stem adds its own volume");
  const stem = peg.out.parts.find(p => p.name === "Stem");
  const zs = stem.mesh.vertices.map(v => v[2]);
  assert.ok(Math.abs(Math.min(...zs)) < 1e-3, "the stem rests on the bed");
  assert.ok(Math.max(...zs) > 14 + 8, "flange + stem height + peg stand above the bed");
  assert.ok(body.mesh.vertices.length > 0);
  const stemCenterX = (Math.min(...stem.mesh.vertices.map(v => v[0])) + Math.max(...stem.mesh.vertices.map(v => v[0]))) / 2;
  const bodyMaxX = Math.max(...body.mesh.vertices.map(v => v[0]));
  assert.ok(stemCenterX > bodyMaxX, "the stem is laid out beside the pumpkin, not on it");
});

test("a longer or wider peg changes the model, and the clearance opens the hole", async () => {
  const a = await make({ face: "none", stem: "peg", peg_clearance_mm: 0.1 });
  const b = await make({ face: "none", stem: "peg", peg_clearance_mm: 0.5 });
  const body = r => r.out.parts.find(p => p.name === "Pumpkin");
  assert.notEqual(body(a).mesh.triangles.length === 0, true);
  assert.ok(a.analysis.volumeMm3 > b.analysis.volumeMm3, "a roomier hole removes more material");
  const long = await make({ face: "none", stem: "peg", peg_length_mm: 12 });
  assert.ok(long.analysis.volumeMm3 > a.analysis.volumeMm3 - 1000);
});

test("bowl: the lid has a recess, the bowl a tongue, and the two never overlap (clearance on every side)", async () => {
  const m = await make({ style: "bowl", wall_mm: 2.4, face: "none", stem: "none", diameter_mm: 100 });
  assert.deepEqual(m.names, ["Bowl", "Lid"]);
  const lid = m.out.parts.find(p => p.name === "Lid"), bowl = m.out.parts.find(p => p.name === "Bowl");
  const minZ = p => Math.min(...p.mesh.vertices.map(v => v[2]));
  assert.ok(Math.abs(minZ(lid)) < 1e-3 && Math.abs(minZ(bowl)) < 1e-3, "both rest on the bed");
  const maxX = p => Math.max(...p.mesh.vertices.map(v => v[0])), minX = p => Math.min(...p.mesh.vertices.map(v => v[0]));
  assert.ok(minX(lid) > maxX(bowl), "the lid is laid out beside the bowl");
});

test("bowl assembly: translating the lid back onto the bowl leaves a clear gap and no overlap", async () => {
  const gBowl = { ...gen };
  const params = ok({ style: "bowl", wall_mm: 2.4, face: "none", stem: "none", diameter_mm: 100 });
  const built = await build(params, { wasm, font: null });
  try {
    const [bowl, lid] = built.solids;
    const lidBox = lid.solid.boundingBox(), bowlBox = bowl.solid.boundingBox();
    const { splitCut, geometry, baseCut } = await import("../../public/assets/js/customize/pumpkin-shape.js");
    const g = geometry(params);
    const zs = splitCut(params, g).z, zb = baseCut(params, g).z;
    // The lid sits at dx beside the bowl with its rim on z = 0 (its split plane); put it back.
    const dx = -(lidBox.min[0] + lidBox.max[0]) / 2 + (bowlBox.min[0] + bowlBox.max[0]) / 2;
    const seated = lid.solid.translate([dx, 0, zs - zb]);
    const overlap = seated.intersect(bowl.solid);
    const touching = overlap.volume();
    seated.delete(); overlap.delete();
    assert.ok(touching < 1, `the lid and bowl overlap by ${touching.toFixed(2)} mm3 (clearance expected)`);
  } finally { for (const s of built.solids) s.solid.delete(); }
});

test("single color: everything shares the body color, no inlay part, and a note says why", async () => {
  const m = await make({ multicolor: false });
  assert.equal(m.out.metrics.unique_colors, 1);
  assert.deepEqual(m.names, ["Pumpkin"]);
  assert.ok(m.out.warnings.some(w => /engraved instead of inlaid/.test(w)));
});

test("multi-color uses at most four colors: body, stem, face, cheeks", async () => {
  const m = await make({});
  assert.equal(new Set(m.out.parts.map(p => p.color)).size, 4);
});

test("notes: tealight size, supports, vase mode and sealed shells", async () => {
  const tea = await make({ style: "hollow", opening: "bottom", face: "none", diameter_mm: 120, stem: "none" });
  assert.ok(tea.out.warnings.some(w => /tealight/.test(w)));
  assert.ok(tea.out.warnings.some(w => /supports/.test(w)));
  const vase = await make({ style: "vase" });
  assert.ok(vase.out.warnings.some(w => /Spiral vase/.test(w)));
  const sealed = await make({ style: "hollow", opening: "closed", face: "none", stem: "none" });
  assert.ok(sealed.out.warnings.some(w => /traps its print supports/.test(w)));
  const wide = await make({ style: "bowl", wall_mm: 2.4, face: "none", stem: "peg", diameter_mm: 180 });
  assert.ok(wide.out.warnings.some(w => /fit your printer's bed/.test(w)));
});

test("a vase is the solid body cut flat: no inner cavity for the slicer to double-print", async () => {
  const m = await make({ style: "vase" });
  assert.equal(m.names.length, 1);
  const solid = await make({ face: "none", stem: "none" });
  assert.ok(m.analysis.volumeMm3 > solid.analysis.volumeMm3 * 0.4);
});

// ---- Leaks and failures ------------------------------------------------------------------------

test("every temporary is freed: only the returned solids stay alive, for every type", async () => {
  for (const over of [{}, { style: "hollow", decoration: "lattice", face: "none", multicolor: false, diameter_mm: 120 }, { style: "bowl", wall_mm: 2.4, stem: "peg", face: "traditional", face_style: "cutout", multicolor: false, face_height_pct: 35, face_size_pct: 45 }, { style: "vase" }, { decoration: "knit", stem: "peg" }]) {
    const tracked = trackLiveObjects(wasm);
    try {
      const built = await build(ok(over), { wasm: tracked.ctxWasm, font: null });
      assert.equal(tracked.live.size, built.solids.length, `${JSON.stringify(over)}: ${tracked.live.size} alive for ${built.solids.length} solids`);
      for (const s of built.solids) s.solid.delete();
      assert.equal(tracked.live.size, 0);
    } finally { tracked.restore(); }
  }
});

test("a failed build leaves nothing alive and speaks plainly", async () => {
  const tracked = trackLiveObjects(wasm);
  try {
    const bad = { ...ok({ style: "hollow", decoration: "lattice", face: "none", multicolor: false, diameter_mm: 120 }), lattice_rows: 12, lattice_cols: 36, lattice_open_pct: 80 };
    let message = "";
    try { const b = await build(bad, { wasm: tracked.ctxWasm, font: null }); for (const s of b.solids) s.solid.delete(); } catch (e) { message = e.message; }
    if (message) assert.match(message, /lattice|pieces|room/i);
    assert.equal(tracked.live.size > 0 && !message, false);
    if (message) assert.equal(tracked.live.size, 0);
    // A cut-through face on a solid is refused by the builder itself, with nothing left over.
    await assert.rejects(() => build({ ...ok({}), face_style: "cutout" }, { wasm: tracked.ctxWasm, font: null }), /hollow shell or a bowl/);
    assert.equal(tracked.live.size, 0);
  } finally { tracked.restore(); }
});

test("errorField sends geometry errors to the right control", () => {
  assert.equal(pumpkin.errorField("The lattice holes would cut the pumpkin into pieces."), "lattice_cols");
  assert.equal(pumpkin.errorField("A tealight does not fit."), "diameter_mm");
  assert.equal(pumpkin.errorField("The face reaches the base."), "face");
  assert.equal(pumpkin.errorField("The wall doesn't fit inside this shape."), "wall_mm");
  assert.equal(pumpkin.errorField("something else"), null);
});
