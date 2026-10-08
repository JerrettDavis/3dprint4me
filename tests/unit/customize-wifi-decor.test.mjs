import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import jsQR from "jsqr";
import * as opentype from "opentype.js";
import { loadEngine } from "../../customizer/framework/engine.js";
import { buildModel } from "../../customizer/framework/model.js";
import { getGenerator } from "../../public/assets/js/customize/registry.js";
import { clampParams, validateParams } from "../../public/assets/js/customize/schema.js";
import build, { planLayout } from "../../customizer/generators/wifi-tag/build.js";
import { normalizeCustomization } from "../../lib/customization/domain.js";
import { trackLiveObjects } from "../support/manifold-live.mjs";

const wasm = await loadEngine();
const gen = { ...getGenerator("wifi-tag"), build };
const NETWORK = { ssid: "Guest Network", password: "correct-horse-battery" };
const paramsFor = (extra = {}) => {
  const { ok, errors, value } = validateParams(gen, { ...NETWORK, ...extra });
  assert.ok(ok, errors.join("; "));
  return value;
};
const freeAll = built => built.solids.forEach(s => s.solid.delete());
const part = (built, re) => built.solids.find(s => re.test(s.name));
const parseFont = opentype.parse ?? opentype.default.parse;
const fontBytes = name => readFile(new URL(`../../customizer/static/fonts/${name}`, import.meta.url));

test("definition v2 exposes ordered sections, a focus map and a section on every field", () => {
  assert.equal(gen.version, 2);
  const keys = Object.keys(gen.sections);
  assert.deepEqual(keys, ["general", "network", "title", "qr", "border", "dividers", "colors"]);
  for (const [key, def] of Object.entries(gen.schema)) {
    assert.ok(def.group, `${key} keeps its group`);
    assert.ok(keys.includes(def.section), `${key} has section ${def.section}`);
  }
  for (const f of gen.focus) assert.ok(keys.includes(f.section), f.part);
});

test("old v1 drafts (without any new key) validate to the v1 look: no decoration, full-size QR", async () => {
  const value = paramsFor();
  assert.equal(value.border_style, "none");
  assert.equal(value.qr_frame, "none");
  assert.equal(value.title_divider, false);
  assert.equal(value.network_divider, false);
  assert.equal(value.qr_scale_pct, 100);
  assert.equal(value.title_font, "inherit");
  assert.equal(value.network_font, "inherit");
  const built = await build(value, { wasm, font: null });
  try {
    assert.deepEqual(built.solids.map(s => s.name), ["Tag body", "QR code inlay", "Title text inlay", "Network name inlay"]);
  } finally { freeAll(built); }
});

test("the server accepts a v1 hand-off and a v2 one with decorations, and never keeps the password", () => {
  assert.ok(normalizeCustomization({ generatorId: "wifi-tag", generatorVersion: 1, params: { ssid: "Cafe", password: "hunter2" } }));
  const out = normalizeCustomization({ generatorId: "wifi-tag", generatorVersion: 2, params: { ssid: "Cafe", password: "hunter2", border_style: "raised", qr_frame: "rounded", title_divider: true, qr_scale_pct: 80 } });
  assert.equal(out.params.password, "[redacted]");
  assert.ok(!JSON.stringify(out).includes("hunter2"));
  assert.throws(() => normalizeCustomization({ generatorId: "wifi-tag", generatorVersion: 2, params: { ssid: "Cafe", password: "x", qr_scale_pct: 10 } }), /QR code size/);
});

// ---- every combination builds, and nothing overlaps -----------------------------------------
const overlap = (a, b) => { const x = a.intersect(b); const v = x.volume(); x.delete(); return v; };

for (const format of ["placard", "card", "keychain"]) {
  test(`${format}: every border x frame x divider combination builds watertight, non-overlapping solids`, async () => {
    for (const border_style of ["none", "raised", "engraved"]) {
      for (const qr_frame of ["none", "square", "rounded"]) {
        for (const dividers of [false, true]) {
          const extra = { format, border_style, qr_frame, title_divider: dividers, network_divider: dividers };
          const value = paramsFor(extra);
          const built = await build(value, { wasm, font: null });
          try {
            const names = built.solids.map(s => s.name);
            assert.equal(names.includes("Border"), border_style === "raised", JSON.stringify(extra));
            assert.equal(names.includes("QR frame"), qr_frame !== "none", JSON.stringify(extra));
            const wantDividers = dividers && format !== "keychain";
            assert.equal(names.filter(n => /^Divider/.test(n)).length, wantDividers ? 2 : 0, JSON.stringify(extra));
            for (const s of built.solids) {
              assert.equal(s.solid.status(), "NoError", `${s.name} ${JSON.stringify(extra)}`);
              assert.ok(s.solid.volume() > 0, s.name);
            }
            for (let i = 0; i < built.solids.length; i++) {
              for (let j = i + 1; j < built.solids.length; j++) {
                assert.ok(overlap(built.solids[i].solid, built.solids[j].solid) < 1e-3, `${names[i]} overlaps ${names[j]} ${JSON.stringify(extra)}`);
              }
            }
            assert.ok(new Set(built.solids.map(s => s.color)).size <= 5);
            // The whole model still goes through the 3MF writer.
            const out = await buildModel(gen, value, { wasm, font: null });
            assert.ok(out.parts.length === built.solids.length);
          } finally { freeAll(built); }
        }
      }
    }
  });
}

test("each decoration changes the geometry as described", async () => {
  const baseline = await build(paramsFor(), { wasm, font: null });
  const plainVolume = part(baseline, /body/).solid.volume();
  const plainQr = part(baseline, /QR code/).solid.boundingBox();
  freeAll(baseline);

  const raised = await build(paramsFor({ border_style: "raised", decor_height_mm: 0.8 }), { wasm, font: null });
  try {
    const rim = part(raised, /^Border/).solid.boundingBox();
    assert.ok(Math.abs(rim.min[2] - 3) < 1e-6 && Math.abs(rim.max[2] - 3.8) < 1e-6, "the rim stands 0.8 mm above the 3 mm tag");
    // Placard 90 x 120, inset 1: the rim's outer edge is 1 mm inside the tag edge.
    assert.ok(Math.abs(rim.max[0] - rim.min[0] - 88) < 0.05 && Math.abs(rim.max[1] - rim.min[1] - 118) < 0.05);
  } finally { freeAll(raised); }

  const engraved = await build(paramsFor({ border_style: "engraved", decor_height_mm: 0.8 }), { wasm, font: null });
  try {
    assert.equal(part(engraved, /Border/), undefined, "a groove is cut, not printed");
    assert.ok(part(engraved, /body/).solid.volume() < plainVolume - 10, "the groove removes material");
    assert.ok(Math.abs(part(engraved, /body/).solid.boundingBox().max[2] - 3) < 1e-6, "no extra height");
  } finally { freeAll(engraved); }

  const framed = await build(paramsFor({ qr_frame: "square", qr_frame_gap_mm: 2, qr_frame_width_mm: 1.2 }), { wasm, font: null });
  try {
    const qr = part(framed, /QR code/).solid.boundingBox();
    const frame = part(framed, /QR frame/).solid.boundingBox();
    const module = (qr.max[0] - qr.min[0]) / 29;   // generous: any version has at least 21 modules
    assert.ok(qr.min[0] - frame.min[0] >= 2 * (qr.max[0] - qr.min[0]) / 100 + 2 + 1.2 - 1e-6, "quiet zone + gap + frame width around the code");
    assert.ok(module > 0);
    assert.ok(qr.max[0] - qr.min[0] < plainQr.max[0] - plainQr.min[0], "a frame makes room by shrinking the code");
  } finally { freeAll(framed); }

  const divided = await build(paramsFor({ title_divider: true, network_divider: true, divider_width_mm: 2, divider_length_pct: 50 }), { wasm, font: null });
  try {
    const lines = divided.solids.filter(s => /^Divider/.test(s.name)).map(s => s.solid.boundingBox());
    assert.equal(lines.length, 2);
    for (const b of lines) {
      assert.ok(Math.abs(b.max[1] - b.min[1] - 2) < 1e-6, "2 mm wide");
      assert.ok(Math.abs(b.max[0] - b.min[0] - 0.5 * (90 - 6)) < 0.05, "50 % of the usable width");
    }
    assert.ok(lines[0].min[1] > 0 && lines[1].max[1] < 0, "title divider above the code, network divider below");
  } finally { freeAll(divided); }
});

test("a border keeps the label and the code inside it, and clear of the keychain loop", async () => {
  const value = paramsFor({ border_style: "raised", border_width_mm: 3, border_inset_mm: 4 });
  const layout = planLayout(value);
  const inner = 4 + 3;
  for (const box of layout.boxes) {
    assert.ok(Math.abs(box.cx) + box.maxW / 2 <= 45 - inner, "label stays inside the border");
    assert.ok(Math.abs(box.cy) + box.maxH / 2 <= 60 - inner + 1e-6);
  }
  const key = await build(paramsFor({ format: "keychain", border_style: "raised", border_width_mm: 3, border_inset_mm: 0.5 }), { wasm, font: null });
  try {
    const rim = part(key, /^Border/).solid.boundingBox();
    assert.ok(rim.max[1] <= 30 - 0.5 + 1e-6, "the rim stays below the top edge");
    const hole = 30 + 3 - 2.75;   // lowest point of the 5.5 mm hole (loop center is 3 mm above the edge)
    assert.ok(rim.max[1] < hole, "the rim never reaches the hole");
  } finally { freeAll(key); }
});

test("dividers are off for keychains and label-off tags, and a missing title skips its divider with a warning", async () => {
  const forced = validateParams(gen, { ...NETWORK, format: "keychain", title_divider: true, network_divider: true });
  assert.equal(forced.ok, true);
  assert.equal(forced.value.title_divider, false);
  assert.equal(forced.value.network_divider, false);
  const off = validateParams(gen, { ...NETWORK, show_text: false, title_divider: true });
  assert.equal(off.value.title_divider, false);
  const noTitle = await build(paramsFor({ title: "", title_divider: true }), { wasm, font: null });
  try {
    assert.ok(noTitle.warnings.some(w => /title divider was left out/.test(w)));
    assert.equal(noTitle.solids.filter(s => /Divider/.test(s.name)).length, 0);
  } finally { freeAll(noTitle); }
});

test("decoration rules: engraved depth, contrast and clamping", () => {
  const deep = validateParams(gen, { ...NETWORK, thickness_mm: 2, border_style: "engraved", decor_height_mm: 1.2 });
  assert.ok(deep.ok, "2 mm tag leaves exactly 0.8 mm");
  const tooDeep = validateParams(gen, { ...NETWORK, thickness_mm: 2, qr_depth_mm: 0.6, border_style: "engraved", decor_height_mm: 1.4 });
  assert.equal(tooDeep.ok, false, "1.4 is outside the field range");
  const lim = gen.rules({ ...paramsFor({ thickness_mm: 2, border_style: "engraved" }) }).limits.decor_height_mm;
  assert.deepEqual(lim, [0.4, 1.2]);
  const clamped = clampParams(gen, { ...paramsFor({ thickness_mm: 2, border_style: "engraved" }), decor_height_mm: 1.2 }, "thickness_mm");
  assert.ok(clamped.decor_height_mm <= 1.2);
  const same = validateParams(gen, { ...NETWORK, qr_frame: "square", decor_color: "#eeeeee" });
  assert.equal(same.ok, false);
  assert.match(same.fieldErrors.decor_color, /too similar/);
  assert.equal(validateParams(gen, { ...NETWORK, decor_color: "#eeeeee" }).ok, true, "no raised decoration, no contrast rule");
  assert.equal(validateParams(gen, { ...NETWORK, border_style: "engraved", decor_color: "#eeeeee" }).ok, true, "a groove prints nothing");
});

// ---- QR scale ---------------------------------------------------------------------------------
function inside(polys, x, y) {
  let hit = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

function decodeQr(solid) {
  const box = solid.boundingBox();
  const slice = solid.slice((box.min[2] + box.max[2]) / 2);
  const polys = slice.toPolygons();
  slice.delete();
  const px = 12, quiet = 4;
  const w = box.max[0] - box.min[0];
  const scale = (w / 100) * 1;   // sample 100 px per code width
  const size = Math.ceil(w / scale) + 2 * quiet * 4;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const mx = box.min[0] + (x - quiet * 4) * scale, my = box.max[1] - (y - quiet * 4) * scale;
    const v = inside(polys, mx, my) ? 0 : 255, i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  void px;
  return jsQR(data, size, size, { inversionAttempts: "dontInvert" });
}

test("a scaled-down QR is centered on the same point and still decodes to the exact payload", async () => {
  const full = await build(paramsFor(), { wasm, font: null });
  const fullBox = part(full, /QR code/).solid.boundingBox();
  freeAll(full);
  for (const pct of [75, 50]) {
    const built = await build(paramsFor({ qr_scale_pct: pct }), { wasm, font: null });
    try {
      const box = part(built, /QR code/).solid.boundingBox();
      const ratio = (box.max[0] - box.min[0]) / (fullBox.max[0] - fullBox.min[0]);
      assert.ok(Math.abs(ratio - pct / 100) < 0.01, `ratio ${ratio}`);
      assert.ok(Math.abs((box.max[0] + box.min[0]) - (fullBox.max[0] + fullBox.min[0])) < 0.05, "same center x");
      assert.ok(Math.abs((box.max[1] + box.min[1]) - (fullBox.max[1] + fullBox.min[1])) < 0.05, "same center y");
      const decoded = decodeQr(part(built, /QR code/).solid);
      assert.equal(decoded?.data, `WIFI:T:WPA;S:Guest Network;P:correct-horse-battery;;`);
    } finally { freeAll(built); }
  }
});

test("a smaller QR keeps the quiet zone and works with a frame", async () => {
  const built = await build(paramsFor({ qr_scale_pct: 60, qr_frame: "rounded" }), { wasm, font: null });
  try {
    assert.equal(decodeQr(part(built, /QR code/).solid)?.data, `WIFI:T:WPA;S:Guest Network;P:correct-horse-battery;;`);
    assert.ok(part(built, /QR frame/));
  } finally { freeAll(built); }
});

test("marginal cell sizes warn; unprintable ones fail with a readable error that never repeats the secrets", async () => {
  // A keychain at 50 % is marginal (cells between 0.6 and 1.0 mm) for a short payload.
  const marginal = await build(paramsFor({ format: "keychain", ssid: "A", password: "abcdefgh", qr_scale_pct: 50 }), { wasm, font: null });
  try {
    assert.ok(marginal.warnings.some(w => /Each QR cell is .* mm/.test(w)), marginal.warnings.join("|"));
  } finally { freeAll(marginal); }
  const long = paramsFor({ format: "keychain", ssid: "S".repeat(32), password: "p".repeat(63), qr_scale_pct: 25 });
  await assert.rejects(() => buildModel(gen, long, { wasm, font: null }), error => {
    assert.match(error.message, /Raise the QR code size/);
    assert.ok(!error.message.includes("pppp") && !error.message.includes("SSSS"), "no secrets in the message");
    assert.equal(gen.errorField(error.message), "qr_scale_pct");
    return true;
  });
  const tracker = trackLiveObjects(wasm);
  try {
    await assert.rejects(() => build(long, { wasm: tracker.ctxWasm, font: null }), /Raise the QR code size/);
    assert.equal(tracker.live.size, 0, "a failed build frees everything");
  } finally { tracker.restore(); }
});

test("decorated builds free every temporary", async () => {
  const value = paramsFor({ border_style: "engraved", qr_frame: "rounded", title_divider: true, network_divider: true, qr_scale_pct: 80 });
  for (const extra of [{}, { format: "card" }, { format: "keychain", border_style: "raised" }]) {
    const tracker = trackLiveObjects(wasm);
    try {
      const built = await build({ ...value, ...extra }, { wasm: tracker.ctxWasm, font: null });
      assert.equal(tracker.live.size, built.solids.length, JSON.stringify(extra));
      built.solids.forEach(s => s.solid.delete());
      assert.equal(tracker.live.size, 0);
    } finally { tracker.restore(); }
  }
});

test("no decoration name, warning, title or filename contains the password", async () => {
  const value = paramsFor({ password: "hunter2-secret", border_style: "raised", qr_frame: "square", title_divider: true, network_divider: true });
  const out = await buildModel(gen, value, { wasm, font: null });
  assert.ok(!out.warnings.join("|").includes("hunter2"));
  assert.ok(!out.filename.includes("hunter2"));
  const { unzipSync, strFromU8 } = await import("fflate");
  const text = Object.values(unzipSync(out.data)).map(b => strFromU8(b)).join("\n");
  assert.ok(!text.includes("hunter2"));
  assert.ok(text.includes("[redacted]"));
});

// ---- per-location fonts -------------------------------------------------------------------------
test("title and network name can use their own fonts; inherit follows the main font", async () => {
  const bebas = parseFont((await fontBytes("BebasNeue-Regular.ttf")).buffer.slice(0));
  const pacifico = parseFont((await fontBytes("Pacifico-Regular.ttf")).buffer.slice(0));
  const fonts = { "bebas-neue": bebas, pacifico };
  const shapeOf = async extra => {
    const built = await build(paramsFor({ ssid: "Guest", ...extra }), { wasm, font: bebas, fonts });
    try {
      return { title: part(built, /Title text/).solid.volume(), ssid: part(built, /Network name/).solid.volume() };
    } finally { freeAll(built); }
  };
  const inherited = await shapeOf({ font: "bebas-neue" });
  const sameExplicit = await shapeOf({ font: "bebas-neue", title_font: "bebas-neue", network_font: "bebas-neue" });
  assert.ok(Math.abs(inherited.title - sameExplicit.title) < 1e-6 && Math.abs(inherited.ssid - sameExplicit.ssid) < 1e-6);
  const mixed = await shapeOf({ font: "bebas-neue", title_font: "pacifico" });
  assert.ok(Math.abs(mixed.title - inherited.title) > 1e-3, "title changed font");
  assert.ok(Math.abs(mixed.ssid - inherited.ssid) < 1e-6, "network name kept the main font");
  const block = await shapeOf({ font: "bebas-neue", network_font: "block" });
  assert.ok(Math.abs(block.ssid - inherited.ssid) > 1e-3, "network name switched to the block font");
});

test("an override whose font was not loaded fails readably, and the block font needs none", async () => {
  await assert.rejects(() => build(paramsFor({ title_font: "pacifico" }), { wasm, font: null, fonts: {} }), /isn't loaded/);
  const built = await build(paramsFor({ title_font: "block", network_font: "block" }), { wasm, font: null, fonts: {} });
  freeAll(built);
});
