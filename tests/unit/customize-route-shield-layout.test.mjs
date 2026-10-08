import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as opentype from "opentype.js";
import { loadEngine } from "../../customizer/framework/engine.js";
import { buildModel } from "../../customizer/framework/model.js";
import { getGenerator } from "../../public/assets/js/customize/registry.js";
import { validateParams } from "../../public/assets/js/customize/schema.js";
import { FONTS } from "../../public/assets/js/customize/fonts.js";
import { qrModuleEstimate, qrModuleStatus } from "../../public/assets/js/customize/qr.js";
import build from "../../customizer/generators/route-shield/build.js";
import qrcode from "qrcode-generator";
import { trackLiveObjects } from "../support/manifold-live.mjs";

const wasm = await loadEngine();
const parse = opentype.parse ?? opentype.default.parse;
const gen = { ...getGenerator("route-shield"), build };
const FONT_DIR = new URL("../../customizer/static/fonts/", import.meta.url);
const fonts = {};
for (const f of FONTS) {
  const b = await readFile(new URL(f.file, FONT_DIR));
  fonts[f.id] = parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
const params = (extra = {}) => {
  const { ok, errors, value } = validateParams(gen, extra);
  assert.ok(ok, errors.join("; "));
  return value;
};
const ctxFor = p => ({ wasm, fonts, font: p.font === "block" ? null : fonts[p.font] });
const sig = solid => `${solid.volume().toFixed(6)} ${JSON.stringify(solid.boundingBox())}`;
const centerY =solid => { const b = solid.boundingBox(); return (b.min[1] + b.max[1]) / 2; };
const buildSolids = async p => {
  const out = await build(p, ctxFor(p));
  return { out, by: name => out.solids.find(s => s.name === name)?.solid, free: () => out.solids.forEach(s => s.solid.delete()) };
};

test("front text is centered on its color field for any font, string and size (offset 0)", async () => {
  const fontIds = ["block", ...FONTS.map(f => f.id)];
  const strings = [["ROUTE", "66"], ["Gypsy", "Gypsy 66"], ["Hy", "Jpgy 9"], ["Sign", "11"]];
  for (const font of fontIds) {
    for (const [top_text, lower_text] of strings) {
      for (const pct of [100, 70]) {
        const p = params({ font, top_text, lower_text, top_scale_pct: pct, lower_scale_pct: pct, qr_enabled: false, back_text: "" });
        const b = await buildSolids(p);
        try {
          for (const [text, field] of [["Upper text", "Upper color field"], ["Lower text", "Lower color field"]]) {
            const delta = Math.abs(centerY(b.by(text)) - centerY(b.by(field)));
            assert.ok(delta < 0.02, `${font} "${top_text}/${lower_text}" ${pct}%: ${text} is ${delta.toFixed(3)} mm off the field center`);
          }
        } finally { b.free(); }
      }
    }
  }
});

test("the offset moves text from the centered position (positive is up)", async () => {
  const base = await buildSolids(params({}));
  const moved = await buildSolids(params({ top_offset_mm: 1.5, lower_offset_mm: -1 }));
  try {
    assert.ok(Math.abs(centerY(moved.by("Upper text")) - centerY(base.by("Upper text")) - 1.5) < 1e-6);
    assert.ok(Math.abs(centerY(moved.by("Lower text")) - centerY(base.by("Lower text")) + 1) < 1e-6);
  } finally { base.free(); moved.free(); }
});

test("a per-location font changes only that location's glyphs", async () => {
  const same = params({ font: "block" });
  const base = await buildSolids(same);
  try {
    for (const [key, changed, others] of [["top_font", "Upper text", ["Lower text", "Back text"]], ["lower_font", "Lower text", ["Upper text", "Back text"]], ["back_font", "Back text", ["Upper text", "Lower text"]]]) {
      const p = params({ font: "block", [key]: "lobster" });
      const alt = await buildSolids(p);
      try {
        assert.notEqual(sig(alt.by(changed)), sig(base.by(changed)), `${key} should reshape ${changed}`);
        for (const name of others) assert.equal(sig(alt.by(name)), sig(base.by(name)), `${key} must not touch ${name}`);
      } finally { alt.free(); }
    }
    // "inherit" follows the main font; a block override beats a curated main font.
    const main = await buildSolids(params({ font: "lobster" }));
    const inherit = await buildSolids(params({ font: "lobster", top_font: "inherit" }));
    const blockTop = await buildSolids(params({ font: "lobster", top_font: "block" }));
    try {
      assert.equal(inherit.by("Upper text").volume(), main.by("Upper text").volume());
      assert.ok(Math.abs(blockTop.by("Upper text").volume() - base.by("Upper text").volume()) < 1e-6);
      assert.equal(blockTop.by("Lower text").volume(), main.by("Lower text").volume());
    } finally { main.free(); inherit.free(); blockTop.free(); }
  } finally { base.free(); }
});

test("an override font that was not loaded fails readably", async () => {
  const p = params({ top_font: "lobster" });
  await assert.rejects(() => build(p, { wasm, font: null, fonts: {} }), /isn't loaded/);
});

test("QR size scales independently and stays centered in its slot", async () => {
  const full = await buildSolids(params({}));
  const half = await buildSolids(params({ qr_scale_pct: 50 }));
  try {
    const [a, b] = [full.by("QR code").boundingBox(), half.by("QR code").boundingBox()];
    assert.ok(Math.abs((b.max[0] - b.min[0]) / (a.max[0] - a.min[0]) - 0.5) < 0.02);
    assert.ok(Math.abs((b.min[0] + b.max[0]) / 2 - (a.min[0] + a.max[0]) / 2) < 0.02, "stays centered across the stem");
    assert.ok(Math.abs((b.min[1] + b.max[1]) / 2 - (a.min[1] + a.max[1]) / 2) < 0.02, "stays centered in its slot");
  } finally { full.free(); half.free(); }
});

test("QR printability: marginal cells warn, cells below the 0.6 mm floor fail on qr_scale_pct", async () => {
  const marginal = await build(params({ qr_scale_pct: 40 }), { wasm });
  try {
    assert.ok(marginal.warnings.some(w => /QR cell is 0\.\d+ mm/.test(w)), marginal.warnings.join("|"));
  } finally { marginal.solids.forEach(s => s.solid.delete()); }
  const ok = await build(params({}), { wasm });
  try { assert.ok(!ok.warnings.some(w => /QR cell/.test(w))); } finally { ok.solids.forEach(s => s.solid.delete()); }
  const tiny = params({ qr_scale_pct: 25 });
  await assert.rejects(() => buildModel(gen, tiny, { wasm }), error => {
    assert.match(error.message, /scaled too small/);
    assert.equal(gen.errorField(error.message), "qr_scale_pct");
    return true;
  });
  assert.equal(validateParams(gen, { qr_scale_pct: 20 }).ok, false);
  assert.equal(validateParams(gen, { qr_scale_pct: 105 }).ok, false);
});

test("qrModuleEstimate agrees with the real encoder for byte-mode content and never underestimates", () => {
  for (const data of ["https://3dprint4.me/", "https://example.com/some/long/path?x=1&y=2", "héllo wörld", "a".repeat(300)]) {
    const qr = qrcode(0, "M");
    qr.addData(data);
    qr.make();
    const est = qrModuleEstimate(data, 40);
    assert.ok(est.modules >= qr.getModuleCount(), data);
  }
  assert.equal(qrModuleEstimate("https://3dprint4.me/", 40).modules, 25);
  assert.equal(qrModuleEstimate("a".repeat(5000), 40), null);
  assert.equal(qrModuleEstimate("https://3dprint4.me/", 10).level, "unprintable");
  assert.equal(qrModuleStatus(0.8).level, "marginal");
});

test("definition exports ordered sections, a part focus map and a section for every field", () => {
  const def = getGenerator("route-shield");
  assert.equal(def.version, 3);
  const keys = Object.keys(def.sections);
  assert.deepEqual(keys, ["general", "top", "lower", "back", "qr", "shape", "colors"]);
  for (const [name, field] of Object.entries(def.schema)) {
    if (name === "font_license_ack") continue;
    assert.ok(keys.includes(field.section), `${name} has a section`);
    assert.ok(field.group, `${name} keeps its group`);
  }
  for (const f of def.focus) assert.ok(keys.includes(f.section));
});

test("every part name resolves to a focus entry", async () => {
  const def = getGenerator("route-shield");
  const b = await buildSolids(params({}));
  try {
    for (const s of b.out.solids) assert.ok(def.focus.some(f => s.name.startsWith(f.part)), `${s.name} has no focus entry`);
  } finally { b.free(); }
});

test("old v1/v2 parameter sets still validate (new keys take their defaults)", () => {
  const { ok, value } = validateParams(gen, { top_text: "OLD", top_offset_mm: 1 });
  assert.ok(ok);
  assert.equal(value.top_font, "inherit");
  assert.equal(value.qr_scale_pct, 100);
});

test("scaled QR and per-location fonts build without leaking", async () => {
  const p = params({ qr_scale_pct: 70, top_font: "bebas-neue", back_font: "block", font: "lobster" });
  const tracker = trackLiveObjects(wasm);
  try {
    const built = await build(p, { wasm: tracker.ctxWasm, font: fonts.lobster, fonts });
    assert.equal(tracker.live.size, built.solids.length);
    built.solids.forEach(s => s.solid.delete());
    assert.equal(tracker.live.size, 0);
    const bad = params({ qr_scale_pct: 25 });
    await assert.rejects(() => build(bad, { wasm: tracker.ctxWasm, font: null, fonts }), /scaled too small/);
    assert.equal(tracker.live.size, 0);
  } finally { tracker.restore(); }
});
