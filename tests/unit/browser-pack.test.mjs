import assert from "node:assert/strict";
import test from "node:test";

import { analyzeModelBytes } from "../../public/assets/js/print-estimation/geometry.js";
import { resolveModelLimits } from "../../public/assets/js/print-estimation/mesh.js";
import { packProduction, readPackLocally } from "../../public/assets/js/print-estimation/pack.js";
import { createModelEstimateController } from "../../public/assets/js/print-estimation/controller.js";
import { createPrintEstimateClient, createPrivateEstimateFlow } from "../../public/assets/js/print-estimation/client.js";
import { nodeInflateRaw } from "../../lib/print-estimation/geometry/analyze-model.js";
import { buildZip } from "../support/zip-fixtures.mjs";

const cube = (name, size) => {
  const v = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(p => p.map(n => n * size));
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return `solid ${name}\n${f.map(t => `facet normal 0 0 0\nouter loop\n${t.map(i => `vertex ${v[i].join(" ")}`).join("\n")}\nendloop\nendfacet`).join("\n")}\nendsolid ${name}\n`;
};
const limits = resolveModelLimits();
const analyze = ({ name, bytes }) => analyzeModelBytes({ name, bytes, limits, inflateRaw: nodeInflateRaw });
const options = { material: "pla", quality: "standard", colors: 1, supports: "none", quantity: 1 };
const fakeFile = (name, bytes) => ({ name, size: bytes.length, type: "application/zip", arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
const packZip = () => buildZip([
  { name: "a.stl", data: cube("a", 10), method: "deflate" },
  { name: "b.stl", data: cube("b", 20), method: "deflate" },
  { name: "bad.stl", data: "nope", method: "deflate" },
  { name: "x.png", data: "p" }
]);
const settle = () => new Promise(resolve => setTimeout(resolve, 30));

test("reads a ZIP locally into measured parts and an ignored list", async () => {
  const bytes = buildZip([{ name: "a.stl", data: cube("a", 10), method: "deflate" }, { name: "bad.stl", data: "nope", method: "deflate" }, { name: "x.png", data: "p" }]);
  const pack = await readPackLocally({ bytes, limits, inflateRaw: nodeInflateRaw, analyze });
  assert.deepEqual(pack.parts.map(part => [part.name, part.format, Boolean(part.metrics), Boolean(part.error)]), [["a.stl", "stl", true, false], ["bad.stl", "stl", false, true]]);
  assert.deepEqual(pack.ignored, [{ name: "x.png", kind: "image" }]);
});

test("a refused archive surfaces its code and no parts", async () => {
  await assert.rejects(readPackLocally({ bytes: buildZip([{ name: "../e.stl", data: "x" }]), limits, inflateRaw: nodeInflateRaw, analyze }), error => error.code === "zip_unsafe_path");
});

test("pack production sums selected measured parts with quantities", async () => {
  const bytes = buildZip([{ name: "a.stl", data: cube("a", 10), method: "deflate" }, { name: "b.stl", data: cube("b", 20), method: "deflate" }]);
  const { parts } = await readPackLocally({ bytes, limits, inflateRaw: nodeInflateRaw, analyze });
  const one = packProduction(parts, { [parts[0].id]: { selected: true, quantity: 1 }, [parts[1].id]: { selected: false, quantity: 1 } }, options);
  const both = packProduction(parts, { [parts[0].id]: { selected: true, quantity: 2 }, [parts[1].id]: { selected: true, quantity: 1 } }, options);
  assert.ok(both.gramsPerUnit > one.gramsPerUnit * 2);
  assert.equal(packProduction(parts, {}, options), null);
});

test("the controller turns a ZIP into a pack whose selection drives the planning estimate", async () => {
  const calls = [];
  const privateEstimates = { reset() {}, start: async (file, hooks) => { calls.push(["start", file.name, hooks.pack().parts.length]); }, estimatePack: async selections => { calls.push(["estimatePack", selections]); } };
  const controller = createModelEstimateController({ limits, render() {}, privateEstimates, inflateRaw: nodeInflateRaw });
  controller.sync([fakeFile("photo.png", new Uint8Array(4)), fakeFile("pack.zip", packZip())]);
  await settle();
  const state = controller.state();
  assert.equal(state.status, "analyzed");
  assert.deepEqual(state.pack.parts.map(part => [part.name, part.error]), [["a.stl", null], ["b.stl", null], ["bad.stl", "empty_file"]]);
  assert.deepEqual(state.pack.ignored, [{ name: "x.png", kind: "image" }]);
  assert.deepEqual(Object.values(state.pack.selection).map(choice => choice.selected), [true, true, false], "measured parts start selected, failed parts do not");
  assert.deepEqual(calls[0], ["start", "pack.zip", 3]);

  const both = controller.modelEstimate(options);
  assert.equal(both.source, "geometry");
  const [a, b, bad] = state.pack.parts.map(part => part.id);
  controller.setPartSelected(b, false);
  const onlyA = controller.modelEstimate(options);
  assert.ok(onlyA.grams < both.grams, "deselecting a part lowers the estimate");
  controller.setPartQuantity(a, "3");
  assert.ok(controller.modelEstimate(options).grams > onlyA.grams * 2, "quantity multiplies the part");
  assert.deepEqual(calls.at(-1), ["estimatePack", [{ localId: a, name: "a.stl", quantity: 3 }]]);

  controller.setPartSelected(bad, true);
  assert.equal(controller.state().pack.selection[bad].selected, false, "an unmeasured part cannot be selected");
  controller.setPartQuantity(a, "500");
  assert.equal(controller.state().pack.selection[a].quantity, 99);
  controller.setPartQuantity(a, "zero");
  assert.equal(controller.state().pack.selection[a].quantity, 1);
  controller.setPartSelected(a, false);
  assert.equal(controller.modelEstimate(options), null, "nothing selected falls back to the size fields");
});

test("a refused ZIP fails with generic copy and never starts a private upload", async () => {
  const starts = [];
  const controller = createModelEstimateController({ limits, render() {}, privateEstimates: { reset() {}, start: async () => starts.push(1) }, inflateRaw: nodeInflateRaw });
  await controller.select(fakeFile("evil.zip", buildZip([{ name: "../e.stl", data: "x" }])));
  assert.equal(controller.state().status, "failed");
  assert.equal(controller.state().pack, null);
  assert.equal(controller.state().message, "This file could not be measured automatically.");
  assert.equal(starts.length, 0);
});

test("a stale pack estimate response cannot land on a newer file", async () => {
  let hooks = null;
  const privateEstimates = { reset() {}, start: async () => {}, estimatePack: (selections, given) => { hooks = given; } };
  const controller = createModelEstimateController({ limits, render() {}, privateEstimates, inflateRaw: nodeInflateRaw });
  await controller.select(fakeFile("pack.zip", packZip()));
  controller.setPartSelected(controller.state().pack.parts[0].id, false);
  await controller.select(null);
  assert.equal(hooks.isCurrent(), false);
});

test("the browser client posts estimate-pack", async () => {
  const seen = [];
  const client = createPrintEstimateClient({ fetchImpl: async (url, init) => { seen.push([url, init]); return new Response("{}", { status: 200 }); } });
  await client.estimatePack({ sessionId: "est_1", token: "t", assetId: "asset_1", selections: [] });
  assert.equal(seen[0][1].method, "POST");
  assert.deepEqual(JSON.parse(seen[0][1].body), { action: "estimate-pack", sessionId: "est_1", token: "t", assetId: "asset_1", selections: [] });
});

function packFlow({ estimatePack, analyzeResult } = {}) {
  const calls = [];
  const client = {
    create: async () => ({ sessionId: "est_1", token: "tok" }),
    authorizeUpload: async () => ({ assetId: "zip_1", uploadUrl: "https://upload.invalid" }),
    upload: async () => {},
    analyze: async () => analyzeResult ?? { status: "pack", pack: { assetId: "zip_1", parts: [{ partId: "part_a", name: "a.stl", state: "ready" }, { partId: "part_b", name: "b.stl", state: "ready" }, { partId: "part_bad", name: "bad.stl", state: "failed" }], ignored: [] }, slice: { status: "unavailable" } },
    estimatePack: async body => { calls.push(["estimatePack", body]); return estimatePack ? estimatePack(body) : { status: "ready", slice: { status: "unavailable" } }; },
    finalize: async body => { calls.push(["finalize", body]); },
    status: async () => ({})
  };
  const flow = createPrivateEstimateFlow({ client, getOptions: () => ({ material: "pla" }), setTimer: () => 1, clearTimer() {} });
  return { flow, calls };
}

test("the private flow verifies a pack and prices the selection by server part id", async () => {
  const { flow, calls } = packFlow();
  const file = { name: "pack.zip", size: 10, type: "application/zip" };
  const pack = { parts: [{ id: "part-0", name: "a.stl" }, { id: "part-1", name: "b.stl" }, { id: "part-2", name: "bad.stl" }], selection: { "part-0": { selected: true, quantity: 2 }, "part-1": { selected: false, quantity: 1 }, "part-2": { selected: false, quantity: 1 } } };
  const seen = [];
  await flow.start(file, { isCurrent: () => true, update: patch => seen.push(patch), pack: () => pack });
  assert.deepEqual(seen.map(patch => patch.privateState).filter(Boolean), ["uploading", "verifying", "verified"]);
  assert.deepEqual(calls[0], ["estimatePack", { sessionId: "est_1", token: "tok", assetId: "zip_1", options: { material: "pla" }, selections: [{ partId: "part_a", quantity: 2 }] }]);
  assert.equal(flow.isPreUploaded(file), true);

  await flow.estimatePack([{ name: "a.stl", quantity: 1 }, { name: "b.stl", quantity: 4 }, { name: "bad.stl", quantity: 1 }], { isCurrent: () => true, update: patch => seen.push(patch) });
  assert.deepEqual(calls.at(-1)[1].selections, [{ partId: "part_a", quantity: 1 }, { partId: "part_b", quantity: 4 }], "only server-ready parts are sent");

  await flow.finalize();
  assert.equal(calls.some(([kind]) => kind === "finalize"), false, "a pack never uses the single-model finalize");
  assert.deepEqual(calls.at(-1), ["estimatePack", { sessionId: "est_1", token: "tok", assetId: "zip_1", options: { material: "pla" }, selections: [{ partId: "part_a", quantity: 1 }, { partId: "part_b", quantity: 4 }], purpose: "submission" }]);
});

test("the latest pack selection wins over a slower earlier response", async () => {
  const pending = [];
  const { flow } = packFlow({ estimatePack: body => new Promise(resolve => pending.push(() => resolve({ status: "ready", slice: { status: "ready", production: { estimatedGramsPerUnit: body.selections[0].quantity, estimatedHoursPerUnit: 1 } } }))) });
  const updates = [];
  const hooks = { isCurrent: () => true, update: patch => updates.push(patch) };
  const pack = { parts: [{ id: "part-0", name: "a.stl" }], selection: { "part-0": { selected: true, quantity: 1 } } };
  const started = flow.start({ name: "pack.zip", size: 1 }, { ...hooks, pack: () => pack });
  await settle();
  pending.shift()();
  await started;
  const first = flow.estimatePack([{ name: "a.stl", quantity: 2 }], hooks);
  const second = flow.estimatePack([{ name: "a.stl", quantity: 3 }], hooks);
  await settle();
  pending[1](); await second;
  pending[0](); await first;
  assert.equal(updates.at(-1).slice.production.estimatedGramsPerUnit, 3);
});

test("finalize skips a pack with nothing selected and a refused pack", async () => {
  const empty = packFlow();
  const pack = { parts: [{ id: "part-0", name: "a.stl" }], selection: { "part-0": { selected: true, quantity: 1 } } };
  await empty.flow.start({ name: "pack.zip", size: 1 }, { isCurrent: () => true, update() {}, pack: () => pack });
  await empty.flow.estimatePack([], { isCurrent: () => true, update() {} });
  const before = empty.calls.length;
  await empty.flow.finalize();
  assert.equal(empty.calls.length, before);

  const refused = packFlow({ analyzeResult: { status: "failed", reason: "x", slice: { status: "unavailable" } } });
  const updates = [];
  await refused.flow.start({ name: "pack.zip", size: 1 }, { isCurrent: () => true, update: patch => updates.push(patch), pack: () => pack });
  assert.equal(updates.at(-1).privateState, "failed");
  await refused.flow.finalize();
  assert.deepEqual(refused.calls, []);
});

test("a pack without models or with too many parts gets its own customer copy", async () => {
  const controller = createModelEstimateController({ limits: { ...limits, maxPackParts: 1 }, render() {}, inflateRaw: nodeInflateRaw });
  await controller.select(fakeFile("docs.zip", buildZip([{ name: "readme.md", data: "x" }])));
  assert.equal(controller.state().message, "This ZIP has no STL or 3MF files to measure; attach STL or 3MF files.");
  await controller.select(fakeFile("big.zip", packZip()));
  assert.equal(controller.state().message, "This pack has too many parts to measure automatically; attach fewer or contact us.");
});
