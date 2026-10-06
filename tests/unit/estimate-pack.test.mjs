import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createEstimateSessionUseCases } from "../../lib/print-estimation/application/estimate-session.js";
import { rollUpPackProduction } from "../../lib/print-estimation/application/estimate-pack.js";
import { createLocalFileStore } from "../../lib/print-estimation/adapters/local-file-store.js";
import { createLocalPrintRepository } from "../../lib/print-estimation/adapters/local-print-repository.js";
import { serverModelLimits, estimateProductionFromGeometry } from "../../lib/print-estimation/geometry/analyze-model.js";
import { normalizeEstimateOptions } from "../../lib/print-estimation/domain.js";
import { presentPack, entryLabel } from "../../lib/print-estimation/application/pack.js";
import { buildZip } from "../support/zip-fixtures.mjs";

const cube = (name, size = 10) => {
  const v = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(p => p.map(n => n * size));
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return `solid ${name}\n${f.map(t => `facet normal 0 0 0\nouter loop\n${t.map(i => `vertex ${v[i].join(" ")}`).join("\n")}\nendloop\nendfacet`).join("\n")}\nendsolid ${name}\n`;
};

async function harness({ slicerEnabled = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pack-estimate-"));
  const fileStore = createLocalFileStore({ root, origin: "http://127.0.0.1:4173" });
  const repository = createLocalPrintRepository({ path: join(root, "state.json"), workLookup: async () => null });
  const useCases = createEstimateSessionUseCases({ repository, fileStore, materialCosts: { materialCost: async () => ({ source: "fallback", landedUsdPerKg: 20, inventoryIds: [] }) }, slicerEnabled, limits: serverModelLimits() });
  const created = await useCases.create({});
  const zip = buildZip([{ name: "a.stl", data: cube("a", 10), method: "deflate" }, { name: "b.stl", data: cube("b", 30), method: "deflate" }]);
  const auth = await useCases.authorizeUpload({ ...created, filename: "pack.zip", size: zip.length, contentType: "application/zip" });
  await fileStore.put((await repository.findAsset(auth.assetId)).blobPath, zip);
  const pack = await useCases.analyze({ ...created, assetId: auth.assetId });
  return { root, repository, fileStore, useCases, created, assetId: auth.assetId, parts: pack.pack.parts, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("rollup sums grams and hours across parts and quantities and prices one job", () => {
  const options = normalizeEstimateOptions({ quantity: 2 });
  const asset = { geometryMetrics: { volumeMm3: 1000, surfaceAreaMm2: 600, dimensionsMm: [10, 10, 10] } };
  const one = estimateProductionFromGeometry(asset.geometryMetrics, { ...options, quantity: 2 });
  const two = estimateProductionFromGeometry(asset.geometryMetrics, { ...options, quantity: 6 });
  const rolled = rollUpPackProduction({ parts: [{ asset, quantity: 1, slicerProduction: null }, { asset, quantity: 3, slicerProduction: null }], options });
  assert.equal(rolled.source, "geometry");
  assert.ok(Math.abs(rolled.totalGrams - (one.totalGrams + two.totalGrams)) < 0.02);
  assert.ok(Math.abs(rolled.totalHours - (one.totalHours + two.totalHours)) < 0.02);
  assert.equal(rolled.plates, one.plates + two.plates);
  assert.ok(Math.abs(rolled.gramsPerUnit * options.quantity - rolled.totalGrams) < 0.02);
});

test("rollup uses slicer figures only when every part has one", () => {
  const options = normalizeEstimateOptions({ quantity: 1 });
  const asset = { geometryMetrics: { volumeMm3: 1000, surfaceAreaMm2: 600, dimensionsMm: [10, 10, 10] } };
  const mixed = rollUpPackProduction({ parts: [{ asset, quantity: 1, slicerProduction: { gramsPerUnit: 5, hoursPerUnit: 1 } }, { asset, quantity: 1, slicerProduction: null }], options });
  assert.equal(mixed.source, "geometry");
  const sliced = rollUpPackProduction({ parts: [{ asset, quantity: 2, slicerProduction: { gramsPerUnit: 5, hoursPerUnit: 1 } }, { asset, quantity: 1, slicerProduction: { gramsPerUnit: 7, hoursPerUnit: 2 } }], options });
  assert.equal(sliced.source, "slicer");
  assert.equal(sliced.totalGrams, 17);
  assert.equal(sliced.totalHours, 4);
});

test("estimate-pack validates selections, persists them, and prices the selected parts", async () => {
  const h = await harness();
  try {
    const [a, b] = h.parts;
    const body = { ...h.created, assetId: h.assetId, options: {} };
    for (const selections of [[], [{ partId: a.partId, quantity: 0 }], [{ partId: a.partId, quantity: 100 }], [{ partId: a.partId, quantity: 1 }, { partId: a.partId, quantity: 1 }], [{ partId: "asset_" + "f".repeat(32), quantity: 1 }], [{ partId: a.partId, quantity: 1.5 }], "x"]) {
      await assert.rejects(h.useCases.estimatePack({ ...body, selections }), error => error.status === 400, JSON.stringify(selections));
    }
    const result = await h.useCases.estimatePack({ ...body, selections: [{ partId: a.partId, quantity: 2 }, { partId: b.partId, quantity: 1 }] });
    assert.equal(result.status, "ready");
    assert.ok(result.price.low > 0 && result.price.high >= result.price.low);
    assert.deepEqual(result.pack.parts.map(part => [part.selected, part.quantity]), [[true, 2], [true, 1]]);
    const single = await h.useCases.estimatePack({ ...body, selections: [{ partId: a.partId, quantity: 1 }] });
    assert.ok(single.production.estimatedGramsPerUnit < result.production.estimatedGramsPerUnit);
    assert.deepEqual((await h.repository.listChildren(h.assetId)).map(row => row.selected), [true, false]);
    assert.equal(JSON.stringify(result).includes("print-estimates/"), false);
  } finally { await h.cleanup(); }
});

test("estimate-pack queues one slice job per selected part when a slicer is configured", async () => {
  const h = await harness({ slicerEnabled: true });
  try {
    const [a, b] = h.parts;
    const result = await h.useCases.estimatePack({ ...h.created, assetId: h.assetId, options: {}, selections: [{ partId: b.partId, quantity: 1 }] });
    assert.equal(result.slice.status, "pending");
    assert.equal((await h.repository.listAssetJobs(b.partId)).length, 1);
    assert.equal((await h.repository.listAssetJobs(a.partId)).length, 0);
    await h.useCases.estimatePack({ ...h.created, assetId: h.assetId, options: {}, selections: [{ partId: b.partId, quantity: 1 }] });
    assert.equal((await h.repository.listAssetJobs(b.partId)).length, 1, "re-estimating never duplicates an active job");
  } finally { await h.cleanup(); }
});

test("a foreign session cannot estimate someone else's pack", async () => {
  const h = await harness();
  try {
    const other = await h.useCases.create({});
    await assert.rejects(h.useCases.estimatePack({ ...other, assetId: h.assetId, options: {}, selections: [{ partId: h.parts[0].partId, quantity: 1 }] }), error => error.status === 404);
  } finally { await h.cleanup(); }
});

test("partId from another ZIP in the same session is rejected", async () => {
  const h = await harness();
  try {
    const zip2 = buildZip([{ name: "c.stl", data: cube("c", 12), method: "deflate" }]);
    const auth = await h.useCases.authorizeUpload({ ...h.created, filename: "other.zip", size: zip2.length, contentType: "application/zip" });
    await h.fileStore.put((await h.repository.findAsset(auth.assetId)).blobPath, zip2);
    const other = await h.useCases.analyze({ ...h.created, assetId: auth.assetId });
    await assert.rejects(h.useCases.estimatePack({ ...h.created, assetId: h.assetId, options: {}, selections: [{ partId: other.pack.parts[0].partId, quantity: 1 }] }), error => error.status === 400);
  } finally { await h.cleanup(); }
});

test("estimate-pack rejects an unanalyzed pack", async () => {
  const h = await harness();
  try {
    const zip2 = buildZip([{ name: "c.stl", data: cube("c", 12), method: "deflate" }]);
    const auth = await h.useCases.authorizeUpload({ ...h.created, filename: "other.zip", size: zip2.length, contentType: "application/zip" });
    await h.fileStore.put((await h.repository.findAsset(auth.assetId)).blobPath, zip2);
    await assert.rejects(h.useCases.estimatePack({ ...h.created, assetId: auth.assetId, options: {}, selections: [{ partId: h.parts[0].partId, quantity: 1 }] }), error => error.status === 409);
  } finally { await h.cleanup(); }
});

test("status recomputes a pack estimate read-only", async () => {
  const h = await harness({ slicerEnabled: true });
  try {
    const [a, b] = h.parts;
    await h.useCases.estimatePack({ ...h.created, assetId: h.assetId, options: {}, selections: [{ partId: b.partId, quantity: 2 }] });
    const before = JSON.stringify([await h.repository.listSessionEstimates(h.created.sessionId, 50), await h.repository.listChildren(h.assetId), await h.repository.listAssetJobs(a.partId), await h.repository.listAssetJobs(b.partId)]);
    const status = await h.useCases.status({ sessionId: h.created.sessionId, token: h.created.token });
    assert.equal(status.pack.parts.find(part => part.partId === b.partId).quantity, 2);
    assert.equal(status.slice.status, "pending");
    const after = JSON.stringify([await h.repository.listSessionEstimates(h.created.sessionId, 50), await h.repository.listChildren(h.assetId), await h.repository.listAssetJobs(a.partId), await h.repository.listAssetJobs(b.partId)]);
    assert.equal(after, before);
  } finally { await h.cleanup(); }
});

test("presentPack sanitizes ignored entry names", () => {
  const view = presentPack({ id: "asset_x", originalName: "p.zip", geometryMetrics: { pack: { ignored: [{ name: "a‮bc.png", kind: "image" }] } } }, []);
  assert.deepEqual(view.pack.ignored, [{ name: "abc.png", kind: "image" }]);
  assert.equal(entryLabel("x".repeat(300)).length, 255);
});
