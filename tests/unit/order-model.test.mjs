import assert from "node:assert/strict";
import test from "node:test";

import { activeProjectData, customizationFromHandoff, handoffPrefill, projectRequestFromData } from "../../public/assets/js/order/model.js";
import { createDraftStore } from "../../public/assets/js/order/draft-store.js";

const serviceFields = {
  print: { material: "pla", quantity: "2", complexity: "mechanism", printerModel: "X1C", consultType: "hour" },
  design: { complexity: "mechanism", deliverable: "step", material: "pla", printerModel: "X1C", consultType: "hour" },
  repair: { printerModel: "X1C", repairType: "repair", material: "pla", complexity: "mechanism", consultType: "hour" },
  consult: { consultType: "hour", meetingFormat: "video", material: "pla", complexity: "mechanism", printerModel: "X1C" }
};

test("Given each service path, when project data is projected, then unrelated service fields are excluded", () => {
  assert.deepEqual(activeProjectData({ service: "print", delivery: "pickup", ...serviceFields.print }), { service: "print", delivery: "pickup", material: "pla", quantity: "2" });
  assert.deepEqual(activeProjectData({ service: "design", delivery: "pickup", ...serviceFields.design }), { service: "design", delivery: "pickup", complexity: "mechanism", deliverable: "step" });
  assert.deepEqual(activeProjectData({ service: "repair", delivery: "pickup", ...serviceFields.repair }), { service: "repair", delivery: "pickup", printerModel: "X1C", repairType: "repair" });
  assert.deepEqual(activeProjectData({ service: "consult", delivery: "pickup", ...serviceFields.consult }), { service: "consult", delivery: "pickup", consultType: "hour", meetingFormat: "video" });
});

test("Given active form data, when a request is built, then the model delegates only the active projection", () => {
  let received;
  const summary = projectRequestFromData({
    data: { service: "repair", projectTitle: "Tune", description: "Tune it", printerModel: "MK4", material: "pla", terms: true },
    estimate: { low: 60, high: 90 },
    files: [{ name: "photo.jpg", size: 5 }],
    buildSummary(data, estimate, files) { received = { data, estimate, files }; return { ok: true }; }
  });
  assert.deepEqual(summary, { ok: true });
  assert.equal(received.data.printerModel, "MK4");
  assert.equal(received.data.material, undefined);
  assert.equal(received.data.projectTitle, "Tune");
});

test("Given denied browser storage, when drafts are saved, then the store reports recoverable failure without throwing", () => {
  const storage = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("denied"); },
    removeItem() { throw new Error("denied"); }
  };
  const store = createDraftStore({ storage, draftKey: "draft", submittedKey: "submitted" });
  assert.deepEqual(store.loadDraft(), {});
  assert.equal(store.saveDraft({ projectTitle: "Bracket", terms: true, website: "trap" }), false);
  assert.equal(store.saveSubmitted({ id: "LOCAL-12345678" }), false);
  assert.doesNotThrow(() => store.clearDraft());
});

test("Given working storage, when a draft is saved, then consent and honeypot values are never retained", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const store = createDraftStore({ storage, draftKey: "draft", submittedKey: "submitted" });
  assert.equal(store.saveDraft({ projectTitle: "Bracket", terms: true, website: "trap" }), true);
  assert.deepEqual(JSON.parse(values.get("draft")), { projectTitle: "Bracket" });
});

test("Given browser storage is resolved lazily, when the store is constructed, then page startup does not require storage access", () => {
  const values = new Map();
  let resolutions = 0;
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const store = createDraftStore({ storage: () => { resolutions++; return storage; }, draftKey: "draft", submittedKey: "submitted" });
  assert.equal(resolutions, 0);
  assert.equal(store.saveDraft({ projectTitle: "Lazy" }), true);
  assert.equal(resolutions, 1);
});

const handoffRecord = () => ({ file: new Blob(["x"]), filename: "route-shield.3mf", generatorId: "route-shield", generatorVersion: 1, generatorTitle: "Route shield", params: { top_text: "ROUTE", password: "[redacted]" }, createdAt: 1 });
const summarize = (data, estimate, files) => ({ service: data.service, files });

test("Given a customizer hand-off, when the print request is built, then it carries the provenance only", () => {
  const customization = customizationFromHandoff(handoffRecord());
  assert.deepEqual(customization, { generatorId: "route-shield", generatorVersion: 1, params: { top_text: "ROUTE", password: "[redacted]" } });
  const request = projectRequestFromData({ data: { service: "print" }, estimate: {}, files: [], buildSummary: summarize, customization });
  assert.deepEqual(request.customization, customization);
  assert.notEqual(request.customization.params, customization.params, "the request holds its own copy");
});

test("Given a customizer hand-off, when another service is chosen, then the request carries no customization", () => {
  const customization = customizationFromHandoff(handoffRecord());
  for (const service of ["design", "repair", "consult"]) {
    const request = projectRequestFromData({ data: { service }, estimate: {}, files: [], buildSummary: summarize, customization });
    assert.equal("customization" in request, false, service);
  }
  assert.equal("customization" in projectRequestFromData({ data: { service: "print" }, estimate: {}, files: [], buildSummary: summarize }), false);
});

test("Given a malformed hand-off, when it is converted, then params are reduced to a plain object", () => {
  assert.deepEqual(customizationFromHandoff({ ...handoffRecord(), params: ["x"] }).params, {});
  assert.deepEqual(customizationFromHandoff({ ...handoffRecord(), params: null }).params, {});
  assert.equal(customizationFromHandoff(null), null);
});

test("Given a hand-off, when the project text is prefilled, then a generated line names the model", () => {
  assert.deepEqual(handoffPrefill(handoffRecord()), { projectTitle: "Custom Route shield", description: "Custom Route shield — see attached model." });
  assert.deepEqual(handoffPrefill({ ...handoffRecord(), generatorTitle: undefined }), { projectTitle: "Custom route-shield", description: "Custom route-shield — see attached model." });
});

test("Given a request with customization, when drafts and submitted copies are stored, then parameters never reach storage", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const store = createDraftStore({ storage, draftKey: "draft", submittedKey: "submitted" });
  const customization = { generatorId: "route-shield", generatorVersion: 1, params: { top_text: "SECRET-ISH", password: "[redacted]" } };
  assert.equal(store.saveDraft({ projectTitle: "Tag", customization }), true);
  assert.deepEqual(JSON.parse(values.get("draft")), { projectTitle: "Tag", customization: { generatorId: "route-shield", generatorVersion: 1 } });
  assert.equal(store.saveSubmitted({ id: "LOCAL-12345678", customization }), true);
  assert.deepEqual(JSON.parse(values.get("submitted"))[0].customization, { generatorId: "route-shield", generatorVersion: 1 });
  assert.equal([...values.values()].join("").includes("SECRET-ISH"), false);
  assert.equal(customization.params.top_text, "SECRET-ISH", "the in-memory request is not mutated");
  assert.equal(store.saveSubmitted({ id: "LOCAL-87654321" }), true);
  assert.equal("customization" in JSON.parse(values.get("submitted"))[0], false);
});
