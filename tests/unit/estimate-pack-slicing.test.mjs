// Pack status and estimate caps with the real slice-job runner writing per-part slicer rows.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createEstimateSessionUseCases } from "../../lib/print-estimation/application/estimate-session.js";
import { createSliceJobRunner } from "../../lib/print-estimation/application/slice-jobs.js";
import { createLocalFileStore } from "../../lib/print-estimation/adapters/local-file-store.js";
import { createLocalPrintRepository } from "../../lib/print-estimation/adapters/local-print-repository.js";
import { serverModelLimits } from "../../lib/print-estimation/geometry/analyze-model.js";
import { SliceError } from "../../lib/print-estimation/slicer-contract.js";
import { buildZip } from "../support/zip-fixtures.mjs";

const cube = (name, size) => {
  const v = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(p => p.map(n => n * size));
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return `solid ${name}\n${f.map(t => `facet normal 0 0 0\nouter loop\n${t.map(i => `vertex ${v[i].join(" ")}`).join("\n")}\nendloop\nendfacet`).join("\n")}\nendsolid ${name}\n`;
};
const materialCosts = { materialCost: async () => ({ source: "fallback", landedUsdPerKg: 20, inventoryIds: [] }) };

async function harness({ policy, slicer = { estimateSlice: async () => ({ engine: "stub", engineVersion: "1", profileId: "stub-profile", elapsedSeconds: 3600, materialGrams: 5 }) } } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pack-slicing-"));
  const fileStore = createLocalFileStore({ root, origin: "http://127.0.0.1:4173" });
  const repository = createLocalPrintRepository({ path: join(root, "state.json"), workLookup: async () => null });
  const limits = serverModelLimits();
  const useCases = createEstimateSessionUseCases({ repository, fileStore, materialCosts, slicerEnabled: true, limits, ...(policy ? { policy } : {}) });
  const runner = createSliceJobRunner({ repository, fileStore, slicer, materialCosts, limits, workerId: "w1" });
  const created = await useCases.create({});
  const zip = buildZip([{ name: "a.stl", data: cube("a", 10), method: "deflate" }, { name: "b.stl", data: cube("b", 20), method: "deflate" }]);
  const auth = await useCases.authorizeUpload({ ...created, filename: "pack.zip", size: zip.length, contentType: "application/zip" });
  await fileStore.put((await repository.findAsset(auth.assetId)).blobPath, zip);
  const pack = await useCases.analyze({ ...created, assetId: auth.assetId });
  const body = { ...created, assetId: auth.assetId, options: {}, selections: pack.pack.parts.map(part => ({ partId: part.partId, quantity: 1 })) };
  return { repository, fileStore, useCases, runner, created, body, parts: pack.pack.parts, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("a worker-completed part slice never takes over the pack status, and the pack is ready only when every part is sliced", async () => {
  const h = await harness();
  try {
    const geometry = await h.useCases.estimatePack(h.body);
    assert.equal(geometry.slice.status, "pending");
    assert.equal((await h.runner.runOnce({ batchSize: 1 })).ready, 1);
    const half = await h.useCases.status(h.created);
    assert.equal(half.model.format, "zip", "status still reports the pack");
    assert.equal(half.pack.parts.length, 2);
    assert.equal(half.slice.status, "pending", "one sliced part does not make the pack ready");
    assert.equal(half.confidence, "rough", "a partly sliced pack stays a rough estimate");
    assert.equal((await h.runner.runOnce({ batchSize: 1 })).ready, 1);
    const done = await h.useCases.status(h.created);
    assert.equal(done.model.format, "zip");
    assert.equal(done.slice.status, "ready");
    assert.equal(done.slice.production.estimatedGramsPerUnit, 10, "the pack total of both parts, not one part");
    assert.equal(done.slice.production.estimatedHoursPerUnit, 2);
  } finally { await h.cleanup(); }
});

test("part slicer rows never consume the session estimate cap", async () => {
  const h = await harness({ policy: { sessionTtlHours: 24, maxAssetsPerSession: 3, maxEstimatesPerSession: 2 } });
  try {
    await h.useCases.estimatePack(h.body);
    assert.equal((await h.runner.runOnce({ batchSize: 10 })).ready, 2);
    const second = await h.useCases.estimatePack({ ...h.body, selections: [h.body.selections[0]] });
    assert.equal(second.status, "ready", "a second preview fits the cap of 2 despite two slicer rows");
    assert.equal((await h.useCases.estimatePack({ ...h.body, purpose: "submission" })).status, "ready");
  } finally { await h.cleanup(); }
});

test("a permanently failed part surfaces as failed in status, which re-queues nothing", async () => {
  const h = await harness({ slicer: { estimateSlice: async () => { throw new SliceError("unsupported", "no profile"); } } });
  try {
    await h.useCases.estimatePack(h.body);
    assert.equal((await h.runner.runOnce({ batchSize: 10 })).failed, 2);
    const jobs = async () => (await Promise.all(h.parts.map(part => h.repository.listAssetJobs(part.partId)))).flat().map(job => job.state);
    assert.deepEqual(await jobs(), ["failed", "failed"]);
    const status = await h.useCases.status(h.created);
    assert.equal(status.slice.status, "failed");
    assert.deepEqual(await jobs(), ["failed", "failed"], "a read-only status never queues a job");
    const preview = await h.useCases.estimatePack({ ...h.body, selections: [h.body.selections[1]] });
    assert.equal(preview.slice.status, "pending", "a new preview still re-queues a failed part");
  } finally { await h.cleanup(); }
});

test("a failed part beside a pending part keeps the pack pending in status", async () => {
  const h = await harness({ slicer: { estimateSlice: async () => { throw new SliceError("unsupported", "no profile"); } } });
  try {
    await h.useCases.estimatePack(h.body);
    assert.equal((await h.runner.runOnce({ batchSize: 1 })).failed, 1);
    assert.equal((await h.useCases.status(h.created)).slice.status, "pending");
  } finally { await h.cleanup(); }
});

test("estimate-pack on a second ZIP clears the first ZIP's part selections", async () => {
  const h = await harness();
  try {
    await h.useCases.estimatePack(h.body);
    const zip = buildZip([{ name: "c.stl", data: cube("c", 12), method: "deflate" }]);
    const auth = await h.useCases.authorizeUpload({ ...h.created, filename: "other.zip", size: zip.length, contentType: "application/zip" });
    await h.fileStore.put((await h.repository.findAsset(auth.assetId)).blobPath, zip);
    const other = await h.useCases.analyze({ ...h.created, assetId: auth.assetId });
    await h.useCases.estimatePack({ ...h.created, assetId: auth.assetId, options: {}, selections: [{ partId: other.pack.parts[0].partId, quantity: 2 }] });
    assert.deepEqual((await h.repository.listChildren(h.body.assetId)).map(row => row.selected), [false, false]);
    assert.deepEqual((await h.repository.listChildren(auth.assetId)).map(row => [row.selected, row.quantity]), [[true, 2]]);
  } finally { await h.cleanup(); }
});
