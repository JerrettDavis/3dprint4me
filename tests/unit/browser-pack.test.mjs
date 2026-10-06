import assert from "node:assert/strict";
import test from "node:test";

import { analyzeModelBytes } from "../../public/assets/js/print-estimation/geometry.js";
import { resolveModelLimits } from "../../public/assets/js/print-estimation/mesh.js";
import { packProduction, readPackLocally } from "../../public/assets/js/print-estimation/pack.js";
import { createModelEstimateController } from "../../public/assets/js/print-estimation/controller.js";
import { createPrintEstimateClient, createPrivateEstimateFlow } from "../../public/assets/js/print-estimation/client.js";
import { syncPicker } from "../../public/assets/js/print-estimation/view.js";
import { createOrderView } from "../../public/assets/js/order/view.js";
import { nodeInflateRaw } from "../../lib/print-estimation/geometry/analyze-model.js";
import { entryLabel } from "../../lib/print-estimation/application/pack.js";
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

function packFlow({ estimatePack, analyzeResult, status, debounceMs = 0, setTimer = () => 1, clearTimer = () => {} } = {}) {
  const calls = [];
  const client = {
    create: async () => ({ sessionId: "est_1", token: "tok" }),
    authorizeUpload: async () => ({ assetId: "zip_1", uploadUrl: "https://upload.invalid" }),
    upload: async () => {},
    analyze: async () => analyzeResult ?? { status: "pack", pack: { assetId: "zip_1", parts: [{ partId: "part_a", name: "a.stl", state: "ready" }, { partId: "part_b", name: "b.stl", state: "ready" }, { partId: "part_bad", name: "bad.stl", state: "failed" }], ignored: [] }, slice: { status: "unavailable" } },
    estimatePack: async body => { calls.push(["estimatePack", body]); return estimatePack ? estimatePack(body) : { status: "ready", slice: { status: "unavailable" } }; },
    finalize: async body => { calls.push(["finalize", body]); },
    status: status ?? (async () => ({}))
  };
  const flow = createPrivateEstimateFlow({ client, getOptions: () => ({ material: "pla" }), debounceMs, setTimer, clearTimer });
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

const onePack = { parts: [{ id: "part-0", name: "a.stl" }, { id: "part-1", name: "b.stl" }], selection: { "part-0": { selected: true, quantity: 1 }, "part-1": { selected: false, quantity: 1 } } };
const quietHooks = updates => ({ isCurrent: () => true, update: patch => updates?.push(patch) });
const fakeTimers = () => {
  const timers = new Map();
  let next = 0;
  return { timers, setTimer: (fn, ms) => { timers.set(++next, { fn, ms }); return next; }, clearTimer: id => timers.delete(id), fire: async id => { const timer = timers.get(id); timers.delete(id); await timer.fn(); } };
};

test("preview pack estimates are debounced so rapid changes send one request", async () => {
  const clock = fakeTimers();
  const { flow, calls } = packFlow({ debounceMs: 700, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  await flow.start({ name: "pack.zip", size: 1 }, { ...quietHooks(), pack: () => onePack });
  assert.equal(calls.length, 1, "the first estimate after upload is sent immediately");
  for (const quantity of [2, 3, 4, 5]) flow.estimatePack([{ name: "a.stl", quantity }], quietHooks());
  assert.equal(calls.length, 1, "nothing is sent while the customer is still changing the selection");
  const pending = [...clock.timers.entries()].filter(([, timer]) => timer.ms === 700);
  assert.equal(pending.length, 1, "each change replaces the pending preview");
  await clock.fire(pending[0][0]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1][1].selections, [{ partId: "part_a", quantity: 5 }]);
});

test("a preview identical to the last one sent is skipped", async () => {
  const { flow, calls } = packFlow();
  await flow.start({ name: "pack.zip", size: 1 }, { ...quietHooks(), pack: () => onePack });
  await flow.estimatePack([{ name: "a.stl", quantity: 1 }], quietHooks());
  assert.equal(calls.length, 1);
  await flow.estimatePack([{ name: "a.stl", quantity: 1 }, { name: "b.stl", quantity: 1 }], quietHooks());
  await flow.estimatePack([{ name: "a.stl", quantity: 1 }], quietHooks());
  assert.equal(calls.length, 3, "a real change is sent again");
});

test("after a 429 previews stop but the submission is still recorded", async () => {
  const { flow, calls } = packFlow({ estimatePack: body => { if (!body.purpose && body.selections[0].quantity === 2) { const error = new Error("limit"); error.status = 429; throw error; } return { status: "ready", slice: { status: "unavailable" } }; } });
  await flow.start({ name: "pack.zip", size: 1 }, { ...quietHooks(), pack: () => onePack });
  await flow.estimatePack([{ name: "a.stl", quantity: 2 }], quietHooks());
  const afterLimit = calls.length;
  await flow.estimatePack([{ name: "a.stl", quantity: 3 }], quietHooks());
  assert.equal(calls.length, afterLimit, "no more previews once the session limit is reached");
  await flow.finalize();
  assert.deepEqual(calls.at(-1)[1].selections, [{ partId: "part_a", quantity: 3 }]);
  assert.equal(calls.at(-1)[1].purpose, "submission");
});

test("a poll result for an older selection is dropped and not re-armed", async () => {
  const clock = fakeTimers();
  let releaseStatus;
  const { flow } = packFlow({
    setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    estimatePack: body => ({ status: "ready", slice: body.selections[0].quantity === 1 ? { status: "pending" } : { status: "unavailable" } }),
    status: () => new Promise(resolve => { releaseStatus = () => resolve({ slice: { status: "pending" } }); })
  });
  const updates = [];
  await flow.start({ name: "pack.zip", size: 1 }, { ...quietHooks(updates), pack: () => onePack });
  const [pollId] = [...clock.timers.keys()];
  const tick = clock.fire(pollId);
  await flow.estimatePack([{ name: "a.stl", quantity: 2 }], quietHooks(updates));
  const before = updates.length;
  releaseStatus();
  await tick;
  assert.equal(updates.length, before, "the stale slice never reaches the controller");
  assert.equal(clock.timers.size, 0, "the stale poll does not schedule another tick");
});

test("finalize cancels a pending preview and waits for one in flight before submitting", async () => {
  const clock = fakeTimers();
  const order = [];
  let releasePreview;
  const { flow, calls } = packFlow({
    debounceMs: 700, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    estimatePack: body => {
      order.push(body.purpose ?? `preview:${body.selections[0].quantity}`);
      if (body.purpose || body.selections[0].quantity === 1) return { status: "ready", slice: { status: "unavailable" } };
      return new Promise(resolve => { releasePreview = () => { order.push("preview-done"); resolve({ status: "ready", slice: { status: "unavailable" } }); }; });
    }
  });
  await flow.start({ name: "pack.zip", size: 1 }, { ...quietHooks(), pack: () => onePack });
  flow.estimatePack([{ name: "a.stl", quantity: 2 }], quietHooks());
  const [[sendId]] = [...clock.timers.entries()].filter(([, timer]) => timer.ms === 700);
  const inFlight = clock.fire(sendId);
  flow.estimatePack([{ name: "a.stl", quantity: 3 }], quietHooks());
  const finalized = flow.finalize();
  await settle();
  assert.deepEqual(order, ["preview:1", "preview:2"], "the submission waits for the preview in flight");
  releasePreview();
  await finalized; await inFlight;
  assert.deepEqual(order, ["preview:1", "preview:2", "preview-done", "submission"]);
  assert.deepEqual(calls.at(-1)[1].selections, [{ partId: "part_a", quantity: 3 }], "the submission carries the latest selection");
  assert.equal([...clock.timers.values()].filter(timer => timer.ms === 700).length, 0, "the pending preview was cancelled");
});

test("the last selected part cannot be unchecked and the customer is told why", async () => {
  const controller = createModelEstimateController({ limits, render() {}, inflateRaw: nodeInflateRaw });
  await controller.select(fakeFile("pack.zip", packZip()));
  const [a, b] = controller.state().pack.parts.map(part => part.id);
  controller.setPartSelected(b, false);
  assert.equal(controller.state().pack.hint, null);
  controller.setPartSelected(a, false);
  assert.equal(controller.state().pack.selection[a].selected, true, "the only selected part stays selected");
  assert.equal(controller.state().pack.hint, "Keep at least one part selected.");
  assert.ok(controller.modelEstimate(options), "the range never falls back to an empty selection");
  controller.setPartSelected(b, true);
  assert.equal(controller.state().pack.hint, null, "the hint clears on the next real change");
});

test("a committed quantity is returned clamped so the input can show it", async () => {
  const controller = createModelEstimateController({ limits, render() {}, inflateRaw: nodeInflateRaw });
  await controller.select(fakeFile("pack.zip", packZip()));
  const [a] = controller.state().pack.parts.map(part => part.id);
  assert.equal(controller.setPartQuantity(a, "500"), 99);
  assert.equal(controller.setPartQuantity(a, "-3"), 1);
  assert.equal(controller.setPartQuantity(a, "7"), 7);
});

test("local part names use the server's entry label so they map to server part ids", async () => {
  const name = "parts/\u202Eevil.stl";
  const bytes = buildZip([{ name, data: cube("a", 10), method: "deflate" }, { name: "notes\u202E.md", data: "x" }]);
  const pack = await readPackLocally({ bytes, limits, inflateRaw: nodeInflateRaw, analyze });
  assert.equal(pack.parts[0].name, entryLabel(name));
  assert.equal(pack.parts[0].name, "parts/evil.stl");
  assert.equal(pack.ignored[0].name, entryLabel("notes\u202E.md"));
});

// Minimal DOM stubs: just the properties these two functions read and write.
const control = (attrs, inCard) => ({ ...attrs, disabled: false, ownerDocument: { activeElement: null }, closest: selector => (selector === "#model-card" && inCard ? {} : null) });

test("the picker owns its controls: an unmeasurable part stays disabled after any re-sync", () => {
  const controls = {
    'select:part-0': control({ checked: false }), 'quantity:part-0': control({ value: "1" }),
    'select:part-1': control({ checked: false }), 'quantity:part-1': control({ value: "1" })
  };
  for (const node of Object.values(controls)) node.disabled = false; // as if something else re-enabled them
  const picker = { querySelector: selector => controls[`${selector.match(/data-pack-action="(\w+)"/)[1]}:${selector.match(/data-part-id="([\w-]+)"/)[1]}`] };
  syncPicker(picker, { parts: [{ id: "part-0", error: null }, { id: "part-1", error: "empty_file" }], selection: { "part-0": { selected: true, quantity: 3 }, "part-1": { selected: false, quantity: 1 } } });
  assert.equal(controls["select:part-0"].disabled, false);
  assert.equal(controls["select:part-0"].checked, true);
  assert.equal(controls["quantity:part-0"].value, "3");
  assert.equal(controls["select:part-1"].disabled, true, "an unmeasurable part can never be ticked");
  assert.equal(controls["quantity:part-1"].disabled, true);
});

test("showing or hiding service fields never touches the pack picker controls", () => {
  const plain = control({}, false);
  const pickerCheck = control({}, true);
  pickerCheck.disabled = true;
  const panel = { dataset: { servicePanel: "print" }, classList: { toggle() {} }, setAttribute() {}, querySelectorAll: () => [plain, pickerCheck] };
  const document = { querySelector: () => null, querySelectorAll: selector => (selector === "[data-service-panel]" ? [panel] : []) };
  const view = createOrderView({ document, window: {}, form: {}, formatEstimate: () => "" });
  view.updateConditionalFields({ service: "print" });
  assert.equal(plain.disabled, false);
  assert.equal(pickerCheck.disabled, true, "the picker keeps its own disabled state");
  view.updateConditionalFields({ service: "design" });
  assert.equal(plain.disabled, true);
  assert.equal(pickerCheck.disabled, true);
});

test("names that collapse to one label get unique labels, the same in the browser and on the server", async () => {
  const { uniqueEntryLabels } = await import("../../lib/print-estimation/application/pack.js");
  const long = "d/".repeat(130);
  const names = [`${long}one.stl`, `${long}two.stl`, "a‮.stl", "a.stl", "a.stl (4)"];
  const labels = uniqueEntryLabels(names);
  assert.equal(new Set(labels).size, names.length, "every label is unique");
  assert.ok(labels.every(label => label.length <= 255));
  assert.deepEqual(labels.slice(2), ["a.stl", "a.stl (4)", "a.stl (4) (5)"]);
  assert.equal(labels[1], `${long.slice(0, 251)} (2)`);
  const bytes = buildZip([{ name: "a‮.stl", data: cube("a", 10), method: "deflate" }, { name: "a.stl", data: cube("b", 20), method: "deflate" }]);
  const pack = await readPackLocally({ bytes, limits, inflateRaw: nodeInflateRaw, analyze });
  assert.deepEqual(pack.parts.map(part => part.name), ["a.stl", "a.stl (2)"]);
});

test("two colliding entry names map to two server parts", async () => {
  const { flow, calls } = packFlow({ analyzeResult: { status: "pack", pack: { assetId: "zip_1", parts: [{ partId: "part_a", name: "a.stl", state: "ready" }, { partId: "part_b", name: "a.stl (2)", state: "ready" }], ignored: [] }, slice: { status: "unavailable" } } });
  const pack = { parts: [{ id: "part-0", name: "a.stl" }, { id: "part-1", name: "a.stl (2)" }], selection: { "part-0": { selected: true, quantity: 1 }, "part-1": { selected: true, quantity: 2 } } };
  await flow.start({ name: "pack.zip", size: 1 }, { isCurrent: () => true, update() {}, pack: () => pack });
  assert.deepEqual(calls[0][1].selections, [{ partId: "part_a", quantity: 1 }, { partId: "part_b", quantity: 2 }]);
});
