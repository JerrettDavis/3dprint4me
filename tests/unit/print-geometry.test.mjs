import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { analyzeModelBytes, estimateProductionFromGeometry, geometryWarnings, MODEL_WARNING_MESSAGES } from "../../public/assets/js/print-estimation/geometry.js";
import { resolveModelLimits } from "../../public/assets/js/print-estimation/mesh.js";
import { analyzeModelOnServer, nodeInflateRaw, publicAnalysisFailure, serverModelLimits } from "../../lib/print-estimation/geometry/analyze-model.js";

const fixture = async name => new Uint8Array(await readFile(new URL(`../fixtures/print-estimation/${name}`, import.meta.url)));
const analyze = async (name, limits) => (await analyzeModelOnServer({ name, bytes: await fixture(name), limits })).metrics;
const rejectsWith = async (promise, code) => assert.rejects(promise, error => { assert.equal(error.name, "ModelAnalysisError"); assert.equal(error.code, code); return true; });

test("ASCII STL reports dimensions, volume, area, and assumed units", async () => {
  const metrics = await analyze("cube-10mm-ascii.stl");
  assert.equal(metrics.format, "stl");
  assert.equal(metrics.encoding, "ascii");
  assert.equal(metrics.triangleCount, 12);
  assert.deepEqual(metrics.dimensionsMm, [10, 10, 10]);
  assert.equal(metrics.volumeMm3, 1000);
  assert.equal(metrics.surfaceAreaMm2, 600);
  assert.ok(metrics.warnings.includes("units_assumed"));
  assert.equal(metrics.warnings.includes("inverted_normals"), false);
});

test("binary STL is parsed from its exact declared length and hashed on the server", async () => {
  const result = await analyzeModelOnServer({ name: "part.STL", bytes: await fixture("cube-20mm-binary.stl") });
  assert.equal(result.metrics.encoding, "binary");
  assert.equal(result.metrics.volumeMm3, 8000);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});

test("malformed STL files fail closed", async () => {
  await rejectsWith(analyze("truncated-binary.stl"), "malformed");
  await rejectsWith(analyze("incomplete-ascii.stl"), "malformed");
  await rejectsWith(analyzeModelOnServer({ name: "empty.stl", bytes: new Uint8Array(3) }), "empty_file");
  const nan = Buffer.from("solid nan\nfacet normal 0 0 0\nouter loop\nvertex NaN 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid\n", "latin1");
  await rejectsWith(analyzeModelOnServer({ name: "nan.stl", bytes: nan }), "invalid_number");
});

test("3MF applies build-item and component transforms and ignores embedded slicer settings", async () => {
  const metrics = await analyze("two-cubes.3mf");
  assert.equal(metrics.format, "3mf");
  assert.equal(metrics.triangleCount, 24, "cube once directly and once through a component");
  assert.equal(metrics.volumeMm3, 2000);
  assert.deepEqual(metrics.boundsMm.min, [5, 0, 0], "item translated by (5,5); component cube starts at x=20");
  assert.deepEqual(metrics.dimensionsMm, [25, 15, 10]);
  assert.equal(metrics.embeddedSlicerSettings, true);
  assert.ok(metrics.warnings.includes("embedded_settings_ignored"));
  assert.match(MODEL_WARNING_MESSAGES.embedded_settings_ignored, /not trusted or used/);
});

test("3MF units are normalized to millimetres", async () => {
  const metrics = await analyze("inch-cube.3mf");
  assert.equal(metrics.unit, "inch");
  assert.deepEqual(metrics.dimensionsMm, [533.4, 25.4, 25.4], "1 in cube plus a copy offset by 20 in");
  assert.equal(metrics.volumeMm3, 32774.128);
});

test("3MF archive hostility is refused before unbounded expansion", async () => {
  await rejectsWith(analyze("traversal.3mf"), "zip_unsafe_path");
  await rejectsWith(analyze("zip-bomb.3mf"), "zip_limit");
  await rejectsWith(analyze("size-lie.3mf"), "zip_limit");
  await rejectsWith(analyze("doctype-entity.3mf"), "xml_forbidden");
  await rejectsWith(analyze("too-many-entries.3mf"), "zip_limit");
  await rejectsWith(analyze("encrypted.3mf"), "zip_encrypted");
  await rejectsWith(analyze("not-a-zip.3mf"), "malformed");
});

test("configurable limits bound file size, triangles, entries, and total expansion", async () => {
  await rejectsWith(analyze("cube-10mm-ascii.stl", resolveModelLimits({ maxModelBytes: 100 })), "too_large");
  await rejectsWith(analyze("cube-20mm-binary.stl", resolveModelLimits({ maxTriangles: 11 })), "too_many_triangles");
  await rejectsWith(analyze("two-cubes.3mf", resolveModelLimits({ maxTriangles: 11 })), "too_many_triangles");
  await rejectsWith(analyze("two-cubes.3mf", resolveModelLimits({ maxZipEntries: 3 })), "zip_limit");
  await rejectsWith(analyze("two-cubes.3mf", resolveModelLimits({ maxZipUncompressedBytes: 500 })), "zip_limit");
  await rejectsWith(analyze("two-cubes.3mf", resolveModelLimits({ maxXmlNodes: 10 })), "too_complex");
  const limits = serverModelLimits({ PRINT_ESTIMATE_MAX_BYTES: "2048", PRINT_ESTIMATE_MAX_TRIANGLES: "abc" });
  assert.equal(limits.maxModelBytes, 2048);
  assert.equal(limits.maxTriangles, 1_500_000, "invalid overrides keep the safe default");
});

test("the Node inflater enforces its maximum output", async () => {
  const { deflateRawSync } = await import("node:zlib");
  const packed = deflateRawSync(Buffer.alloc(10_000, 1));
  assert.equal((await nodeInflateRaw(packed, 10_000)).length, 10_000);
  await rejectsWith(nodeInflateRaw(packed, 100), "zip_limit");
});

test("unsupported names and mismatched containers are rejected", async () => {
  await rejectsWith(analyzeModelBytes({ name: "model.obj", bytes: new Uint8Array(100) }), "unsupported_format");
  await rejectsWith(analyzeModelBytes({ name: "model.stl", bytes: await fixture("two-cubes.3mf") }), "malformed");
});

test("public failure categories stay generic while private codes remain diagnostic", () => {
  assert.deepEqual(publicAnalysisFailure({ name: "ModelAnalysisError", code: "zip_unsafe_path" }), { code: "zip_unsafe_path", reason: "analysis_unavailable" });
  assert.deepEqual(publicAnalysisFailure({ name: "ModelAnalysisError", code: "too_large" }), { code: "too_large", reason: "file_too_large" });
  assert.equal(publicAnalysisFailure(new Error("database password leaked")).reason, "analysis_unavailable");
});

test("geometry warnings flag suspicious meshes", () => {
  const base = { triangleCount: 1000, degenerateTriangles: 0, dimensionsMm: [20, 20, 20], volumeMm3: 4000, signedVolumeMm3: 4000 };
  assert.deepEqual(geometryWarnings(base), []);
  assert.ok(geometryWarnings({ ...base, dimensionsMm: [400, 20, 20] }).includes("exceeds_build_volume"));
  assert.ok(geometryWarnings({ ...base, volumeMm3: 0.1, signedVolumeMm3: 0.1 }).includes("near_zero_volume"));
  assert.ok(geometryWarnings({ ...base, signedVolumeMm3: -4000 }).includes("inverted_normals"));
  assert.ok(geometryWarnings({ ...base, degenerateTriangles: 50 }).includes("degenerate_triangles"));
  assert.ok(geometryWarnings({ ...base, dimensionsMm: [1, 1, 1] }).includes("tiny_model"));
});

test("geometry production estimate responds to material, quality, supports, colors, and batching", async () => {
  const metrics = await analyze("cube-20mm-binary.stl");
  const standard = estimateProductionFromGeometry(metrics, { material: "pla", quality: "standard", supports: "none", colors: 1, quantity: 1 });
  assert.equal(standard.source, "geometry");
  assert.ok(standard.gramsPerUnit > 2 && standard.gramsPerUnit < 10, `20 mm cube grams ${standard.gramsPerUnit}`);
  const fine = estimateProductionFromGeometry(metrics, { material: "pla", quality: "fine", quantity: 1 });
  assert.ok(fine.hoursPerUnit > standard.hoursPerUnit);
  const supported = estimateProductionFromGeometry(metrics, { material: "pla", supports: "heavy", quantity: 1 });
  assert.ok(supported.gramsPerUnit > standard.gramsPerUnit);
  const multicolor = estimateProductionFromGeometry(metrics, { material: "pla", colors: 3, quantity: 1 });
  assert.ok(multicolor.hoursPerUnit > standard.hoursPerUnit && multicolor.gramsPerUnit > standard.gramsPerUnit);
  const batch = estimateProductionFromGeometry(metrics, { material: "pla", quantity: 12 });
  assert.equal(batch.plates, 1, "small parts share a plate");
  assert.equal(batch.unitsPerPlate, 12);
  const large = estimateProductionFromGeometry({ ...metrics, dimensionsMm: [200, 200, 20] }, { material: "pla", quantity: 3 });
  assert.equal(large.plates, 3);
});

test("the browser inflater is bounded and yields the same metrics as the server", async () => {
  const { browserInflateRaw } = await import("../../public/assets/js/print-estimation/controller.js");
  const { deflateRawSync } = await import("node:zlib");
  const packed = deflateRawSync(Buffer.alloc(50_000, 7));
  assert.equal((await browserInflateRaw(packed, 50_000)).length, 50_000);
  await rejectsWith(browserInflateRaw(packed, 1_000), "zip_limit");
  const bytes = await fixture("two-cubes.3mf");
  const browser = await analyzeModelBytes({ name: "two-cubes.3mf", bytes, inflateRaw: browserInflateRaw });
  const server = await analyze("two-cubes.3mf");
  assert.deepEqual(browser, server);
});

test("the browser model controller picks the first STL/3MF and ignores stale analyses", async () => {
  const { createModelEstimateController } = await import("../../public/assets/js/print-estimation/controller.js");
  const renders = [];
  const file = (name, bytes) => ({ name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  const cube = file("cube.stl", await fixture("cube-20mm-binary.stl"));
  const photo = file("photo.png", new Uint8Array(10));
  const controller = createModelEstimateController({ limits: resolveModelLimits(), render: state => renders.push(state) });
  controller.sync([photo, cube]);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(controller.state().status, "analyzed");
  assert.equal(controller.state().file.name, "cube.stl");
  const estimate = controller.modelEstimate({ material: "pla", quality: "standard", quantity: 1 });
  assert.equal(estimate.source, "geometry");
  assert.ok(estimate.grams > 0 && estimate.hours >= 0.25);
  controller.sync([photo]);
  assert.equal(controller.state().status, "idle");
  assert.equal(controller.modelEstimate({}), null);
  assert.ok(renders.some(state => state.status === "reading"));
});
