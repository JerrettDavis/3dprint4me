import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createSliceJobRunner } from "../../lib/print-estimation/application/slice-jobs.js";

function harness({ bytes = Buffer.from("model"), sha = true, maxModelBytes = 25 * 1024 * 1024 } = {}) {
  let reads = 0, slices = 0, time = 0;
  const asset = { id: "asset", state: "ready", blobPath: "private/model.stl", sha256: sha ? createHash("sha256").update(bytes).digest("hex") : null };
  const repository = {
    findAsset: async () => asset,
    claimJobs: async () => [{ id: "job", assetId: asset.id, options: {}, attemptCount: 1, maxAttempts: 3 }],
    failJob: async () => ({ state: "pending" })
  };
  const runner = createSliceJobRunner({ repository, fileStore: { read: async () => { reads++; return bytes; } },
    slicer: { estimateSlice: async () => { slices++; throw new Error("retry"); } }, limits: { maxModelBytes }, now: () => new Date(time) });
  return { runner, asset, reads: () => reads, slices: () => slices, advance: ms => { time += ms; } };
}

test("worker reuses verified bytes on retry, expires them and honors deleted state", async () => {
  const h = harness();
  await h.runner.runOnce(); await h.runner.runOnce();
  assert.equal(h.reads(), 1);
  h.advance(300001); await h.runner.runOnce();
  assert.equal(h.reads(), 2);
  h.asset.state = "deleted"; await h.runner.runOnce();
  assert.equal(h.slices(), 3);
});

test("missing hashes bypass reuse and changed hashes cannot use old bytes", async () => {
  const h = harness({ sha: false });
  await h.runner.runOnce(); await h.runner.runOnce();
  assert.equal(h.reads(), 2);
  h.asset.sha256 = "0".repeat(64);
  await h.runner.runOnce();
  assert.equal(h.slices(), 2, "mismatched downloaded bytes never reach slicer");
});

test("models larger than cache budget are read for every attempt", async () => {
  const h = harness({ bytes: Buffer.alloc(32 * 1024 * 1024 + 1), maxModelBytes: 40 * 1024 * 1024 });
  await h.runner.runOnce(); await h.runner.runOnce();
  assert.equal(h.reads(), 2);
});

test("remote slicers never read model bytes", async () => {
  const h = harness();
  let downloads = 0, received = "not called";
  const runner = createSliceJobRunner({ repository: { findAsset: async () => h.asset, claimJobs: async () => [{ assetId: h.asset.id, options: {}, attemptCount: 1, maxAttempts: 2 }], failJob: async () => ({state: "pending"}) }, fileStore: { read: async () => { downloads++; throw new Error("unexpected download"); } }, slicer: { needsBytes: false, estimateSlice: async ({bytes}) => { received = bytes; throw new Error("remote retry"); } }, limits: {maxModelBytes: 100} });
  assert.equal((await runner.runOnce()).retrying, 1);
  assert.equal(downloads, 0);
  assert.equal(received, null);
});


test("cache budget evicts older paths and does not share by hash alone", async () => {
  const h = harness({ bytes: Buffer.alloc(17 * 1024 * 1024) });
  await h.runner.runOnce();
  h.asset.blobPath = "private/second.stl";
  await h.runner.runOnce();
  h.asset.blobPath = "private/model.stl";
  await h.runner.runOnce();
  assert.equal(h.reads(), 3, "two 17MiB entries cannot fit the 32MiB budget");
});

test("over-limit downloads never reach slicer even if hash matches", async () => {
  const h = harness({ maxModelBytes: 2 });
  await h.runner.runOnce();
  assert.equal(h.slices(), 0);
});
