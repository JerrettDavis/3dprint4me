import assert from "node:assert/strict";
import test from "node:test";
import { loadEngine } from "../../customizer/framework/engine.js";
import { blockText, fitCrossSection } from "../../customizer/framework/text.js";
import { qrCrossSection } from "../../customizer/framework/qr.js";
import { roundedRect, star, partialStar, ring, keyLoop } from "../../customizer/framework/shapes.js";
import { buildModel } from "../../customizer/framework/model.js";
import { analyzeModelBytes } from "../../public/assets/js/print-estimation/geometry.js";
import { inflateRawSync } from "node:zlib";
import { unzipSync, strFromU8 } from "fflate";

const wasm = await loadEngine();
const { CrossSection } = wasm;
const area = cs => cs.area();

const shoelace = pts => Math.abs(pts.reduce((a, [x, y], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; return a + x * y2 - x2 * y; }, 0)) / 2;

test("shapes have sensible area", () => {
  assert.ok(Math.abs(area(roundedRect(CrossSection, 20, 10, 0)) - 200) < 1e-6);
  assert.ok(Math.abs(area(roundedRect(CrossSection, 20, 10, 3)) - (200 - (4 - Math.PI) * 9)) < 0.5);
  const pts = [];
  for (let i = 0; i < 10; i++) { const r = i % 2 === 0 ? 10 : 4; const a = Math.PI / 2 + i * Math.PI / 5; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
  const analytic = shoelace(pts);
  assert.ok(Math.abs(area(star(CrossSection, 10)) - analytic) / analytic < 0.01);
  const full = area(partialStar(CrossSection, 10, 1)), halfStar = partialStar(CrossSection, 10, 0.5), half = area(halfStar);
  assert.ok(Math.abs(full - area(star(CrossSection, 10))) < 1e-6);
  assert.ok(half > full * 0.35 && half < full * 0.65);
  assert.ok(halfStar.bounds().max[0] <= 1e-3, "half star keeps the left side");
  const rg = area(ring(CrossSection, 5, 3));
  assert.ok(Math.abs(rg - Math.PI * (25 - 9)) < 0.5);
  assert.ok(Math.abs(area(keyLoop(CrossSection, { outerR: 5, holeR: 2.5, cx: 3, cy: 4 })) - area(ring(CrossSection, 5, 2.5))) < 1e-6);
});

test("QR cross-section reports module size, is top-left oriented, and rejects dense payloads", () => {
  const q = qrCrossSection(CrossSection, "WIFI:T:WPA;S:Cafe;P:hunter22;;", 40);
  assert.ok(q.module >= 0.82 && q.modules >= 21 && !q.cs.isEmpty());
  // Finder pattern: the top-left module is dark, bottom-left/top-right corners too, but bottom-right corner is not.
  const probe = (x, y) => !q.cs.intersect(CrossSection.square([q.module * 0.4, q.module * 0.4], true).translate([x, y])).isEmpty();
  const m = q.module, h = 20;
  assert.ok(probe(-h + m / 2, h - m / 2), "top-left module dark");
  assert.ok(probe(h - m / 2, h - m / 2), "top-right finder");
  assert.ok(probe(-h + m / 2, -h + m / 2), "bottom-left finder");
  assert.ok(!probe(-h + m * 1.5, h - m * 1.5), "finder interior ring gap is light");
  assert.throws(() => qrCrossSection(CrossSection, "x".repeat(400), 20), /too dense/);
});

test("block text fits a box without distortion", () => {
  const fitted = fitCrossSection(blockText(CrossSection, "HELLO"), { maxWidth: 30, maxHeight: 6 });
  const b = fitted.bounds();
  assert.ok(area(fitted) > 0);
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
  for (const p of out.parts) for (const [x, y] of p.mesh.vertices) assert.ok(x >= 2 - 1e-6 && y >= 2 - 1e-6);
});

test("buildModel forwards the entire ctx to generator.build", async () => {
  let seen;
  const gen = { id: "ctx", build: (p, ctx) => { seen = ctx; return { solids: [{ name: "a", color: "#ffffff", solid: ctx.wasm.Manifold.cube([1, 1, 1]) }] }; } };
  const ctx = { wasm, font: null, imageContours: [1, 2] };
  await buildModel(gen, {}, ctx);
  assert.equal(seen, ctx);
});

const fake = (counter, over = {}) => ({
  boundingBox: () => ({ min: [0, 0, 0], max: [1, 1, 1] }),
  translate() { return fake(counter); },
  simplify() { return fake(counter); },
  getMesh: () => ({ numVert: 0, numProp: 3, vertProperties: [], triVerts: [] }),
  delete() { counter.n++; },
  ...over
});
const genOf = solids => ({ id: "f", build: () => ({ solids }) });

test("buildModel frees solids on every error path", async () => {
  let c = { n: 0 };
  await assert.rejects(buildModel(genOf([{ name: "a", color: "#ffffff", solid: fake(c, { boundingBox() { throw new Error("x"); } }) }, { name: "b", color: "#ffffff", solid: fake(c) }]), {}, {}), /x/);
  assert.equal(c.n, 2);
  c = { n: 0 };
  await assert.rejects(buildModel(genOf(Array.from({ length: 6 }, (_, i) => ({ name: `p${i}`, color: `#00000${i}`, solid: fake(c) }))), {}, {}), e => e.code === "too-many-colors" && /6 colors/.test(e.message));
  assert.equal(c.n, 6);
  c = { n: 0 };
  await assert.rejects(buildModel(genOf([{ name: "Icon", color: "#xyz", solid: fake(c) }]), {}, {}), e => e.code === "invalid-color" && e.message === 'Part "Icon" has an invalid color "#xyz".');
  assert.equal(c.n, 1);
  await assert.rejects(buildModel(genOf([]), {}, {}), e => e.code === "no-geometry" && /no geometry/.test(e.message));
  // throw in getMesh after the shifted and cleaned copies exist: original, shifted and cleaned are freed
  c = { n: 0 };
  const cleanBad = fake(c, { getMesh() { throw new Error("mesh"); } });
  const shifted = fake(c, { simplify: () => cleanBad });
  await assert.rejects(buildModel(genOf([{ name: "a", color: "#ffffff", solid: fake(c, { translate: () => shifted }) }]), {}, {}), /mesh/);
  assert.equal(c.n, 3);
});

test("buildModel frees real solids and normalizes colors", async () => {
  const gen = { id: "n", build: (p, { wasm }) => ({ filenameBase: "my file!", solids: [
    { name: "a", color: "#F00", solid: wasm.Manifold.cube([2, 2, 2]) },
    { name: "b", color: "#FF0000FF", solid: wasm.Manifold.cube([2, 2, 2]).translate([5, 0, 0]) }
  ] }) };
  const out = await buildModel(gen, {}, { wasm });
  assert.equal(out.metrics.unique_colors, 1);
  assert.equal(out.parts[0].color, "#ff0000");
  assert.equal(out.filename, "my-file.3mf");
});

test("buildModel does not embed sensitive params in 3MF metadata", async () => {
  const gen = {
    id: "s", schema: { secret: { type: "text", max: 20, sensitive: true, optional: true, default: "" } },
    publicParams: p => ({ ...p, extra: "stripped-ok" }),
    build: (p, { wasm }) => ({ solids: [{ name: "a", color: "#ffffff", solid: wasm.Manifold.cube([2, 2, 2]) }] })
  };
  const out = await buildModel(gen, { secret: "hunter2" }, { wasm });
  const files = unzipSync(out.data);
  let sawRedacted = false;
  for (const [name, bytes] of Object.entries(files)) {
    const text = strFromU8(bytes);
    assert.ok(!text.includes("hunter2"), `${name} leaks the secret`);
    if (name.endsWith("customizer.json")) { sawRedacted = text.includes("[redacted]") && text.includes("stripped-ok"); }
  }
  assert.ok(sawRedacted, "customizer.json holds [redacted]");
});

test("loadEngine retries after a failed load", async () => {
  const { loadEngine: fresh } = await import("../../customizer/framework/engine.js?fresh");
  await assert.rejects(fresh(undefined, () => Promise.reject(new Error("boom"))), /boom/);
  const ok = await fresh(undefined, () => Promise.resolve({ setup() {}, tag: "ok" }));
  assert.equal(ok.tag, "ok");
  assert.equal(await fresh(undefined, () => { throw new Error("not called"); }), ok);
});

test("shape helpers free their intermediates: only the returned cross-section stays alive", async () => {
  const { trackLiveObjects } = await import("../support/manifold-live.mjs");
  const tracker = trackLiveObjects(wasm);
  const CS = tracker.ctxWasm.CrossSection;
  try {
    for (const make of [
      () => roundedRect(CS, 20, 10, 3), () => roundedRect(CS, 20, 10, 0),
      () => partialStar(CS, 10, 0), () => partialStar(CS, 10, 0.5), () => partialStar(CS, 10, 1)
    ]) {
      const out = make();
      assert.equal(tracker.live.size, 1, String(make));
      assert.ok(tracker.live.has(out));
      out.delete();
      assert.equal(tracker.live.size, 0);
    }
  } finally { tracker.restore(); }
});

test("the 0.82 mm/module floor is exact: module == 0.82 builds, a hair smaller throws", async () => {
  const { default: qrcode } = await import("qrcode-generator");
  const data = "https://3dprint4.me/";
  const qr = qrcode(0, "M"); qr.addData(data); qr.make();
  const n = qr.getModuleCount();
  const ok = qrCrossSection(CrossSection, data, n * 0.82);
  assert.ok(Math.abs(ok.module - 0.82) < 1e-12, String(ok.module));
  ok.cs.delete();
  assert.throws(() => qrCrossSection(CrossSection, data, n * 0.82 - 1e-9), /too dense/);
});
