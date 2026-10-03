import assert from "node:assert/strict";
import test from "node:test";
import { loadEngine } from "../../customizer/framework/engine.js";
import { blockText, fitCrossSection } from "../../customizer/framework/text.js";
import { qrCrossSection } from "../../customizer/framework/qr.js";
import { roundedRect, star, partialStar, ring, keyLoop } from "../../customizer/framework/shapes.js";
import { buildModel } from "../../customizer/framework/model.js";
import { analyzeModelBytes } from "../../public/assets/js/print-estimation/geometry.js";
import { inflateRawSync } from "node:zlib";

const wasm = await loadEngine();
const { CrossSection } = wasm;
const area = cs => cs.area();

test("shapes have sensible area", () => {
  assert.ok(Math.abs(area(roundedRect(CrossSection, 20, 10, 0)) - 200) < 1e-6);
  assert.ok(area(roundedRect(CrossSection, 20, 10, 3)) < 200);
  assert.ok(area(star(CrossSection, 10)) > 0);
  const full = area(partialStar(CrossSection, 10, 1)), half = area(partialStar(CrossSection, 10, 0.5));
  assert.ok(Math.abs(full - area(star(CrossSection, 10))) < 1e-6);
  assert.ok(half > full * 0.35 && half < full * 0.65);
  assert.ok(Math.abs(area(ring(CrossSection, 5, 3)) - Math.PI * (25 - 9)) < 0.5);
  assert.ok(area(keyLoop(CrossSection, { outerR: 5, holeR: 2.5, cx: 0, cy: 0 })) > 0);
});

test("QR cross-section reports module size and rejects dense payloads", () => {
  const q = qrCrossSection(CrossSection, "WIFI:T:WPA;S:Cafe;P:hunter22;;", 40);
  assert.ok(q.module >= 0.82 && q.modules >= 21 && !q.cs.isEmpty());
  assert.throws(() => qrCrossSection(CrossSection, "x".repeat(400), 20), /too dense/);
});

test("block text fits a box without distortion", () => {
  const fitted = fitCrossSection(blockText(CrossSection, "HELLO"), { maxWidth: 30, maxHeight: 6 });
  const b = fitted.bounds();
  assert.ok(b.max[0] - b.min[0] <= 30 + 1e-6 && b.max[1] - b.min[1] <= 6 + 1e-6);
});

test("buildModel produces a 3MF the site's own analyzer accepts, in positive XY", async () => {
  const gen = {
    id: "slab",
    build: (p, { wasm }) => ({
      title: "slab", filenameBase: "slab",
      solids: [
        { name: "base", color: "#ffffff", solid: wasm.Manifold.cube([20, 10, 2]) },
        { name: "top", color: "#ff0000", solid: wasm.Manifold.cube([10, 5, 1]).translate([5, 2.5, 2]) }
      ]
    })
  };
  const out = await buildModel(gen, {}, { wasm, font: null });
  assert.equal(out.parts.length, 2);
  assert.match(out.filename, /^slab.*\.3mf$/);
  const analysis = await analyzeModelBytes({ name: out.filename, bytes: out.data, inflateRaw: async (b, max) => new Uint8Array(inflateRawSync(b, { maxOutputLength: max })) });
  assert.ok(Math.abs(analysis.volumeMm3 - (20 * 10 * 2 + 10 * 5 * 1)) < 1);
  assert.equal(out.metrics.unique_colors, 2);
});

test("buildModel forwards the entire ctx to generator.build", async () => {
  let seen;
  const gen = { id: "ctx", build: (p, ctx) => { seen = ctx; return { solids: [{ name: "a", color: "#ffffff", solid: ctx.wasm.Manifold.cube([1, 1, 1]) }] }; } };
  const ctx = { wasm, font: null, imageContours: [1, 2] };
  await buildModel(gen, {}, ctx);
  assert.equal(seen, ctx);
});
