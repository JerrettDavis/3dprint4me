import assert from "node:assert/strict";
import test from "node:test";
import { loadEngine } from "../../customizer/framework/engine.js";
import { buildModel } from "../../customizer/framework/model.js";
import { isFieldVisible } from "../../customizer/framework/form.js";
import { getGenerator } from "../../public/assets/js/customize/registry.js";
import { validateParams } from "../../public/assets/js/customize/schema.js";
import build, { OFFICE } from "../../customizer/generators/name-plate/build.js";
import { traceImage } from "../../customizer/framework/image-trace.js";

const wasm = await loadEngine();
const gen = { ...getGenerator("name-plate"), build };
const paramsFor = extra => {
  const { ok, errors, value } = validateParams(gen, extra);
  assert.ok(ok, errors.join("; "));
  return value;
};
function discContours() {
  const W = 48, H = 48, px = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - 24) ** 2 + (y - 24) ** 2 < 18 ** 2) { const i = (y * W + x) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
  return traceImage({ pixels: px, width: W, height: H });
}
const boxOf = (built, name) => built.solids.find(s => s.name === name).solid.boundingBox();
const dispose = built => built.solids.forEach(s => s.solid.delete());

test("the office size is exactly 8 x 2 inches", () => {
  assert.ok(Math.abs(OFFICE.w - 8 * 25.4) < 1e-9 && Math.abs(OFFICE.h - 2 * 25.4) < 1e-9);
});

test("the default size still fits the name and the office preset sets it", () => {
  assert.equal(paramsFor({}).size, "fit");
  assert.equal(paramsFor({}).plate_image, "none");
  assert.equal(gen.presets.office.size, "office");
});

test("office plate is the 8 x 2 in rectangle whatever the plate and loop settings say", async () => {
  for (const extra of [{}, { plate: "none", keychain_loop: true }, { plate: "hug", style: "shadow" }, { style: "inlay", name: "Dr. Montgomery Jones" }]) {
    const built = await build(paramsFor({ size: "office", ...extra }), { wasm, font: null });
    try {
      const b = boxOf(built, "Plate");
      assert.ok(Math.abs(b.max[0] - b.min[0] - OFFICE.w) < 1e-6, JSON.stringify(extra));
      assert.ok(Math.abs(b.max[1] - b.min[1] - OFFICE.h) < 1e-6, JSON.stringify(extra));
      assert.equal(built.loop, null);
      const n = boxOf(built, "Name");
      assert.ok(n.min[0] >= b.min[0] + 4.9 && n.max[0] <= b.max[0] - 4.9 && n.min[1] >= b.min[1] + 4.9 && n.max[1] <= b.max[1] - 4.9, "name stays inside the margin");
    } finally { dispose(built); }
  }
});

test("an optional image sits at the left, clear of the name, as its own part", async () => {
  const p = paramsFor({ size: "office", plate_image: "custom", name: "Jordan Lee" });
  await assert.rejects(() => build(p, { wasm, font: null, imageContours: null }), /choose an image/i);
  const built = await build(p, { wasm, font: null, imageContours: discContours() });
  try {
    const img = boxOf(built, "Image"), name = boxOf(built, "Name"), plate = boxOf(built, "Plate");
    assert.ok(img.max[0] < name.min[0], "image is left of the name");
    assert.ok(img.min[0] >= plate.min[0] + 4.9);
    assert.equal(built.solids.find(s => s.name === "Image").color, p.image_color);
  } finally { dispose(built); }
  const out = await buildModel(gen, p, { wasm, font: null, imageContours: discContours() });
  assert.ok(out.parts.some(x => x.name === "Image"));
  const inlay = await buildModel(gen, { ...p, style: "inlay" }, { wasm, font: null, imageContours: discContours() });
  assert.ok(inlay.parts.some(x => x.name === "Image"));
});

test("the image is ignored outside the office size and without the option", async () => {
  for (const extra of [{ plate_image: "custom" }, { size: "office" }]) {
    const built = await build(paramsFor(extra), { wasm, font: null, imageContours: discContours() });
    try { assert.equal(built.solids.some(s => s.name === "Image"), false); } finally { dispose(built); }
  }
});

test("rules and visibility follow the size", () => {
  const d = paramsFor({});
  assert.equal(isFieldVisible(gen.schema.plate_image, d), false);
  assert.equal(isFieldVisible(gen.schema.plate, paramsFor({ size: "office" })), false);
  assert.equal(isFieldVisible(gen.schema.keychain_loop, paramsFor({ size: "office" })), false);
  const withImage = paramsFor({ size: "office", plate_image: "custom" });
  assert.equal(isFieldVisible(gen.schema.image_color, withImage), true);
  assert.equal(isFieldVisible(gen.schema.image_threshold, withImage), true);
  assert.equal(isFieldVisible(gen.schema.image_color, d), false);
  assert.deepEqual(gen.onParamChange("size", { ...withImage, size: "fit" }), { plate_image: "none" });
  const low = gen.rules({ ...withImage, image_color: withImage.plate_color });
  assert.match(low.errors.join(" "), /Image color/);
  // inlay with plate "none" is fine on the office sign, which always has a plate.
  assert.deepEqual(gen.rules({ ...paramsFor({ size: "office", style: "inlay" }), plate: "none" }).errors, []);
});
