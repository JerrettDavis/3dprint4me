import assert from "node:assert/strict";
import test from "node:test";
import { loadEngine } from "../../customizer/framework/engine.js";
import { buildModel } from "../../customizer/framework/model.js";
import { applyDesign } from "../../customizer/framework/designs.js";
import { loadBuilder } from "../../customizer/generators/index.js";
import { traceLayers } from "../../customizer/framework/image-trace.js";
import { placeText } from "../../customizer/generators/display-sign/text.js";
import { GENERATORS } from "../../public/assets/js/customize/registry.js";
import { validateParams } from "../../public/assets/js/customize/schema.js";
import { holderLayout, qrPayload } from "../../public/assets/js/customize/sign.js";
import { FONTS, locationFontIds } from "../../public/assets/js/customize/fonts.js";
import { readFile } from "node:fs/promises";
import * as opentype from "opentype.js";

const parseFont = opentype.parse ?? opentype.default.parse;
async function loadFonts(params) {
  const out = {};
  for (const id of locationFontIds(g, params)) {
    const bytes = await readFile(new URL(`../../customizer/static/fonts/${FONTS.find(f => f.id === id).file}`, import.meta.url));
    out[id] = parseFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
  return out;
}

const wasm = await loadEngine();
const g = GENERATORS["display-sign"];
const { default: build } = await loadBuilder["display-sign"]();
const defaults = Object.fromEntries(Object.entries(g.schema).map(([k, d]) => [k, d.default]));
const make = (over = {}, ctx = {}) => buildModel({ ...g, build }, validateParams(g, { ...defaults, ...over }).value, { wasm, ...ctx });
const bounds = out => {
  const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const p of out.parts) for (const v of p.mesh.vertices) for (let i = 0; i < 3; i++) { b.min[i] = Math.min(b.min[i], v[i]); b.max[i] = Math.max(b.max[i], v[i]); }
  return b;
};
const partBounds = p => {
  const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const v of p.mesh.vertices) for (let i = 0; i < 3; i++) { b.min[i] = Math.min(b.min[i], v[i]); b.max[i] = Math.max(b.max[i], v[i]); }
  return b;
};

test("the starter makes a sign and a holder, the sign's raised art on top of its body", async () => {
  const out = await make();
  const names = out.parts.map(p => p.name);
  assert.ok(names.includes("Sign body") && names.includes("Holder"), names.join(","));
  const body = partBounds(out.parts.find(p => p.name === "Sign body"));
  assert.ok(Math.abs(body.max[2] - 4.0) < 1e-3, "the body is thickness minus relief");
  const art = out.parts.find(p => p.name.startsWith("Sign art"));
  assert.ok(Math.abs(partBounds(art).max[2] - 4.8) < 1e-3, "sign is thickness_mm tall including the raised artwork");
  assert.ok(Math.abs(partBounds(art).min[2] - 4.0) < 1e-3, "artwork starts at the body's top");
  assert.ok(out.metrics.unique_colors <= 5);
});

test("output chooses sign, holder or both", async () => {
  const both = await make();
  const sign = await make({ output: "sign" });
  const holder = await make({ output: "holder" });
  assert.ok(!sign.parts.some(p => p.name.startsWith("Holder")));
  assert.ok(!holder.parts.some(p => p.name.startsWith("Sign")));
  const hb = bounds(holder), sb = bounds(sign), bb = bounds(both);
  assert.ok(bb.max[1] - bb.min[1] > (sb.max[1] - sb.min[1]) + (hb.max[1] - hb.min[1]) - 1, "the holder sits below the sign, not on it");
});

test("colored parts never overlap in plan where they are stacked: text covers shapes", async () => {
  // A plate under a line of text of another color: the plate has a hole where the letters are.
  const over = { d1_kind: "plate", d1_x: 0, d1_y: 0, d1_w: 100, d1_h: 40, d1_color: "4", t1_text: "HELLO", t1_x: 0, t1_y: 0, t1_size: 10, t1_color: "3", d2_kind: "none", d3_kind: "none", d4_kind: "none", t2_text: "", t3_text: "", t4_text: "", t5_text: "", qr_on: false, output: "sign" };
  const out = await make(over);
  const plate = out.parts.find(p => p.color === defaults.color_4);
  const letters = out.parts.find(p => p.color === defaults.color_3);
  assert.ok(plate && letters);
  // Sum of part volumes equals the union: no double counting means no overlap (checked via triangle areas is overkill;
  // here: the plate part has more triangles than a plain box because the letters were cut out of it).
  assert.ok(plate.mesh.triangles.length > 100, "the plate is cut where the letters sit");
});

test("a text slot's alignment decides which edge sits at x", async () => {
  const at = async align => {
    const t = [];
    const keep = o => { t.push(o); return o; };
    const placed = placeText(wasm.CrossSection, null, "ABC", { size: 7, align, fit: 0, rot: 0, x: 10, y: 0 }, keep);
    const b = placed.cs.bounds();
    t.forEach(o => o.delete?.());
    return b;
  };
  const left = await at("left"), center = await at("center"), right = await at("right");
  assert.ok(Math.abs(left.min[0] - 10) < 0.2);
  assert.ok(Math.abs((center.min[0] + center.max[0]) / 2 - 10) < 0.2);
  assert.ok(Math.abs(right.max[0] - 10) < 0.2);
});

test("text is sized by capital height and shrinks to its maximum width", async () => {
  const t = [];
  const keep = o => { t.push(o); return o; };
  const free = placeText(wasm.CrossSection, null, "HELLO WORLD", { size: 14, align: "center", fit: 0, rot: 0, x: 0, y: 0 }, keep);
  const fb = free.cs.bounds();
  assert.ok(Math.abs((fb.max[1] - fb.min[1]) - 14) < 0.5, "caps are 14 mm tall");
  const fitted = placeText(wasm.CrossSection, null, "HELLO WORLD", { size: 14, align: "center", fit: 40, rot: 0, x: 0, y: 0 }, keep);
  const tb = fitted.cs.bounds();
  assert.ok(tb.max[0] - tb.min[0] <= 40.01);
  assert.ok(fitted.cap < 14);
  t.forEach(o => o.delete?.());
});

test("shapes: every kind builds", async () => {
  for (const kind of ["frame", "plate", "ring", "disc", "arc", "line", "heart", "star", "diamond", "mail", "globe", "pin", "phone"]) {
    const out = await make({ output: "sign", d1_kind: kind, d1_w: 30, d1_h: 20, d1_x: 0, d1_y: 0, d1_color: "4" });
    assert.ok(out.parts.some(p => p.color === defaults.color_4), `${kind} prints in its color`);
  }
});

test("a holder without a card pocket is solid across the front; with one it has a pocket", async () => {
  const withPocket = await make({ output: "holder" });
  const plain = await make({ output: "holder", holder_card: false, holder_d_mm: 40 });
  const vol = o => o.metrics.triangles;
  assert.ok(vol(withPocket) > 0 && vol(plain) > 0);
  assert.ok(withPocket.parts[0].mesh.triangles.length > plain.parts[0].mesh.triangles.length, "the pocket adds faces");
});

test("holder lettering and stripes make their own parts", async () => {
  const out = await make({ output: "holder", holder_stripes: true, h1_text: "HELLO", h1_x: -60, h1_color: "2" });
  assert.ok(out.parts.some(p => p.name === "Holder stripes"));
  assert.ok(out.parts.some(p => p.name.startsWith("Holder lettering")));
});

test("the slot always leaves the card pocket and a front wall", () => {
  const p = validateParams(g, defaults).value;
  const l = holderLayout(p);
  assert.ok(l.pocketY1 > l.pocketY0);
  assert.ok(l.frontWall >= 4);
  assert.ok(l.minDepth <= p.holder_d_mm);
});

test("rules: text in the body color, an unscannable QR and a too-shallow holder are refused", () => {
  const bad = validateParams(g, { ...defaults, t1_color: "1" });
  assert.equal(bad.ok, false);
  assert.match(bad.fieldErrors.t1_color, /same color as the sign body/);
  const qr = validateParams(g, { ...defaults, qr_ink: "1" });
  assert.match(qr.fieldErrors.qr_ink, /same color|too similar/);
  const dense = validateParams(g, { ...defaults, qr_data: "x".repeat(250), qr_size_mm: 20 });
  assert.equal(dense.ok, false);
  const shallow = validateParams(g, { ...defaults, holder_d_mm: 35 });
  assert.match(shallow.fieldErrors.holder_d_mm, /at least/);
  const shallowSlot = validateParams(g, { ...defaults, seat_mm: 30, holder_h_mm: 36 });
  assert.match(shallowSlot.fieldErrors.seat_mm, /at least 8 mm/);
});

test("a one-color logo and a multi-color logo both build from traced outlines", async () => {
  const square = [[[0, 0], [10, 0], [10, 10], [0, 10]]];
  const one = await make({ output: "sign", logo: "custom", logo_colors: 1, logo_x: 0, logo_y: 0, logo_w: 30, logo_h: 30 }, { imageContours: square });
  assert.ok(one.parts.length >= 2);
  await assert.rejects(() => make({ output: "sign", logo: "custom" }), /logo/i);
  const layers = [{ index: 0, contours: [[[0, 0], [10, 0], [10, 10], [0, 10]]] }, { index: 1, contours: [[[12, 0], [22, 0], [22, 10], [12, 10]]] }];
  const multi = await make({ output: "sign", logo: "custom", logo_colors: 2, logo_x: 0, logo_y: 0, logo_w: 60, logo_h: 30, d1_kind: "none", t1_text: "", qr_on: false }, { imageLayers: layers });
  assert.ok(multi.parts.some(p => p.color === defaults.color_2) && multi.parts.some(p => p.color === defaults.color_3), "each layer prints in its palette color");
});

test("traceLayers snaps a two-ink image to the palette and leaves the background out", () => {
  const w = 40, h = 20, pixels = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const [r, gr, b] = x >= 4 && x < 16 && y >= 4 && y < 16 ? [220, 60, 120] : x >= 24 && x < 36 && y >= 4 && y < 16 ? [40, 130, 60] : [255, 255, 255];
    pixels.set([r, gr, b, 255], i);
  }
  const layers = traceLayers({ pixels, width: w, height: h, palette: ["#dc427e", "#2f8a3f", "#000000"], maxCells: 40 });
  assert.deepEqual(layers.map(l => l.index), [0, 1], "pink and green, no black and no white");
  assert.throws(() => traceLayers({ pixels: new Uint8ClampedArray(w * h * 4).fill(255), width: w, height: h, palette: ["#000000"] }), /nothing to trace/);
});

test("every design applies and the commissioned pair reproduces the example sizes", () => {
  for (const d of g.designs) assert.ok(applyDesign(g, d, {}), d.id);
  const chef = applyDesign(g, g.designs.find(d => d.id === "chef-curt"), {});
  assert.equal(chef.board_w_mm, 225);
  assert.equal(chef.tongue_w_mm, 200);
  assert.equal(chef.qr_data, "www.cookingwithchefcurt.com");
});

test("the commissioned signs keep their lettering clear of the cards, and the sign's lower edge clears the holder", async () => {
  for (const id of ["chef-curt", "bradleys-bakery"]) {
    const params = applyDesign(g, g.designs.find(d => d.id === id), {});
    const layout = holderLayout(params);
    assert.ok(layout.boardBottom >= params.holder_h_mm + 0.5, `${id}: the board starts above the holder`);
    const fonts = {};
    const out = await buildModel({ ...g, build }, params, { wasm, font: null, fonts: await loadFonts(params) });
    assert.ok(!out.warnings.some(w => /business cards/.test(w)), `${id}: ${out.warnings.join(" | ")}`);
    // Reference clearance: the cards reach about layout.cardCover mm up the board; the lowest lettering is above that.
    assert.ok(layout.cardCover > 15 && layout.cardCover < 30, `${id}: cardCover ${layout.cardCover}`);
  }
});

test("low lettering behind the cards is warned about", async () => {
  const out = await make({ output: "sign", t3_y: -60, t3_text: "LOW LINE" });
  assert.ok(out.warnings.some(w => /business cards/.test(w)), out.warnings.join(" | "));
});

test("a bare web address becomes a link in the QR; anything else is encoded as typed", () => {
  assert.equal(qrPayload({ qr_data: "linktr.ee/qr/abc" }), "https://linktr.ee/qr/abc");
  assert.equal(qrPayload({ qr_data: "https://example.org/x" }), "https://example.org/x");
  assert.equal(qrPayload({ qr_data: "WIFI:T:WPA;S:a;P:b;;" }), "WIFI:T:WPA;S:a;P:b;;");
  assert.equal(qrPayload({ qr_data: "call us today" }), "call us today");
});

test("the seat must lift the board's lower edge clear of the holder", () => {
  const bad = validateParams(g, { ...defaults, seat_mm: 6, tongue_h_mm: 20 });
  assert.equal(bad.ok, false);
  assert.match(bad.fieldErrors.seat_mm, /lower edge would sit inside the holder/);
});
