import assert from "node:assert/strict";
import test from "node:test";

import { createProjectRequestClient } from "../../public/assets/js/order/client.js";
import { createOrderController } from "../../public/assets/js/order/controller.js";
import { createPrintEstimateClient, createPrivateEstimateFlow } from "../../public/assets/js/print-estimation/client.js";
import { hashCapability, parseEstimateAttachment } from "../../lib/print-estimation/capability.js";
import { createPrintEstimateHandler } from "../../lib/print-estimation/handler.js";
import { completeProjectRequestUseCase } from "../../lib/project-request/complete-project-request.js";
import { normalizeUploadedFiles } from "../../lib/validation.js";

async function call(handler, { method = "POST", body, headers = {}, url = "/api/print-estimate" } = {}) {
  const res = { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(value) { this.body = value; } };
  const req = { method, url, headers: { "content-type": "application/json", ...headers }, body };
  await handler(req, res);
  return { status: res.statusCode, headers: res.headers, body: JSON.parse(res.body) };
}

test("the public estimate API fails closed and generically when private storage is not configured", async () => {
  const handler = createPrintEstimateHandler({ getRuntime: () => ({ repository: null, fileStore: null }) });
  const response = await call(handler, { body: { action: "create", options: {} } });
  assert.equal(response.status, 503);
  assert.equal(response.body.error, "The service could not complete this request.");
  assert.equal(response.headers["cache-control"], "no-store");
});

test("the public estimate API accepts only exact action shapes and hides honeypot submissions", async () => {
  const calls = [];
  const useCases = { create: async () => { calls.push("create"); return { sessionId: "est_x" }; }, authorizeUpload: async () => ({}), analyze: async () => ({}), status: async () => ({}) };
  const handler = createPrintEstimateHandler({ useCases });
  assert.equal((await call(handler, { body: { action: "create", options: {}, blobPath: "x" } })).status, 400);
  assert.equal((await call(handler, { body: { action: "delete-everything" } })).status, 400);
  assert.equal((await call(handler, { method: "DELETE" })).status, 405);
  assert.deepEqual((await call(handler, { body: { action: "create", website: "spam" } })).body, { ignored: true });
  assert.deepEqual(calls, []);
  assert.equal((await call(handler, { body: { action: "create", options: {} } })).status, 201);
  const statusRequest = await call(createPrintEstimateHandler({ useCases: { ...useCases, status: async query => query } }), { method: "GET", url: "/api/print-estimate?id=est_1", headers: { "x-print-estimate-token": "secret" } });
  assert.deepEqual(statusRequest.body, { sessionId: "est_1", token: "secret" }, "the capability travels in a header, not the URL");
});

test("request completion parses only a well-formed estimate capability and stores just its hash", () => {
  assert.equal(parseEstimateAttachment(undefined), null);
  const token = "a".repeat(43);
  assert.deepEqual(parseEstimateAttachment({ sessionId: `est_${"0".repeat(32)}`, token }), { sessionId: `est_${"0".repeat(32)}`, ownershipHash: hashCapability(token) });
  assert.throws(() => parseEstimateAttachment({ sessionId: "est_../../x", token }), error => error.status === 400);
  assert.throws(() => parseEstimateAttachment({ sessionId: `est_${"0".repeat(32)}`, token: "short" }), error => error.status === 401);
  assert.throws(() => normalizeUploadedFiles([{ name: "a.stl", mode: "estimate", path: "3DP-20260930-ABCDEFGH/a.stl" }], "3DP-20260930-ABCDEFGH"), error => error.status === 400);
  assert.equal(normalizeUploadedFiles([{ name: "a.stl", size: 10, mode: "estimate" }], "3DP-20260930-ABCDEFGH")[0].mode, "estimate");
});

test("completing a print request passes the estimate attachment to the one work publisher and survives a stale session", async () => {
  const published = [];
  const complete = completeProjectRequestUseCase({
    normalizeRequest: value => value, normalizeFiles: value => value ?? [], validateId: value => value, issueCheckoutProof: () => "proof",
    parseAttachment: parseEstimateAttachment,
    getRuntime: () => ({ mode: "neon", workPublisher: { async completeRequest(...args) { published.push(args); return { outboxId: "1", printEstimate: { attached: false } }; } } })
  });
  const token = "b".repeat(43);
  const result = await complete({ id: "3DP-1", request: { service: "print", contact: { email: "a@example.com" }, projectTitle: "x" }, printEstimate: { sessionId: `est_${"1".repeat(32)}`, token } });
  assert.equal(published.length, 1, "exactly one work item is created");
  assert.equal(published[0][3].ownershipHash, hashCapability(token));
  assert.equal(result.live, true, "a stale or expired estimate never fails submission");
  assert.deepEqual(result.printEstimate, { attached: false });
  await complete({ id: "3DP-2", request: { service: "design", contact: { email: "a@example.com" }, projectTitle: "x" }, printEstimate: { sessionId: `est_${"1".repeat(32)}`, token } });
  assert.equal(published[1][3], null, "non-print requests never attach estimates");
});

test("the order client references a privately estimated model instead of uploading it again", async () => {
  const fetched = [];
  const client = createProjectRequestClient({ fetchImpl: async (url, options) => {
    fetched.push([url, options?.method]);
    if (url === "/api/upload-url") return new Response(JSON.stringify({ uploadUrl: "https://upload.invalid/x", path: "3DP-20260930-ABCDEFGH/x-photo.png", bodyType: "file", method: "PUT" }), { status: 200 });
    return new Response("{}", { status: 200 });
  } });
  const model = { name: "bracket.stl", size: 684, type: "model/stl" };
  const photo = { name: "photo.png", size: 10, type: "image/png" };
  const prepared = await client.prepareFiles("3DP-20260930-ABCDEFGH", "neon", [model, photo], () => {}, file => file === model);
  assert.deepEqual(prepared[0], { name: "bracket.stl", size: 684, type: "model/stl", path: null, mode: "estimate" });
  assert.equal(prepared[1].mode, "signed");
  assert.equal(fetched.filter(([url]) => url === "/api/upload-url").length, 1, "only the photo is authorized");
});

test("the order controller finalizes the estimate and sends only the capability reference on completion", async () => {
  const completions = [];
  const events = [];
  const controller = createOrderController({
    getData: () => ({ website: "" }), buildRequest: () => ({ service: "print", projectTitle: "x", contact: { email: "a@example.com" } }), validateFinalStep: () => true,
    client: { async create() { return { id: "3DP-20260930-ABCDEFGH", mode: "neon", live: true }; }, async complete(body) { completions.push(body); return { live: true }; } },
    files: { async prepare(_id, _mode, _progress, options) { events.push(["prepare", options.isPreUploaded("model")]); return []; } },
    draftStore: { saveSubmitted: () => true, clearDraft() {} },
    view: { submitting() {}, showSubmission() {}, submissionError() {}, uploadProgress() {} },
    newLocalId: () => "LOCAL-1", warn() {},
    printEstimate: { isPreUploaded: file => file === "model", attachment: () => ({ sessionId: "est_1", token: "t" }), finalize: async () => events.push(["finalize"]) }
  });
  await controller.submit();
  assert.deepEqual(events, [["prepare", true], ["finalize"]]);
  assert.deepEqual(completions[0].printEstimate, { sessionId: "est_1", token: "t" });
});

test("the private estimate flow degrades to the normal upload path on any failure", async () => {
  const updates = [];
  const failing = createPrivateEstimateFlow({ client: { create: async () => { const error = new Error("down"); error.status = 503; throw error; } }, getOptions: () => ({}) });
  await failing.start({ name: "a.stl", size: 1 }, { isCurrent: () => true, update: patch => updates.push(patch) });
  assert.deepEqual(updates.at(-1), { privateState: "unavailable" });
  assert.equal(failing.attachment(), null);
  assert.equal(failing.isPreUploaded({}), false);

  const timers = [];
  const file = { name: "a.stl", size: 1, type: "" };
  const ok = createPrivateEstimateFlow({
    getOptions: () => ({ material: "pla" }), setTimer: fn => { timers.push(fn); return timers.length; }, clearTimer() {},
    client: {
      create: async () => ({ sessionId: "est_1", token: "tok" }),
      authorizeUpload: async () => ({ assetId: "asset_1", uploadUrl: "https://upload.invalid" }),
      upload: async () => {}, analyze: async () => ({ status: "ready", slice: { status: "pending" } }),
      status: async () => ({ slice: { status: "ready", production: { estimatedGramsPerUnit: 5, estimatedHoursPerUnit: 1 } } })
    }
  });
  const seen = [];
  await ok.start(file, { isCurrent: () => true, update: patch => seen.push(patch) });
  assert.deepEqual(seen.map(patch => patch.privateState).filter(Boolean), ["uploading", "verifying", "verified"]);
  assert.equal(ok.isPreUploaded(file), true);
  assert.deepEqual(ok.attachment(), { sessionId: "est_1", token: "tok" });
  await timers[0]();
  assert.equal(seen.at(-1).slice.status, "ready", "polling picks up the slicer result");
});

test("the browser estimate client sends the capability in a header", async () => {
  const seen = [];
  const client = createPrintEstimateClient({ fetchImpl: async (url, options) => { seen.push([url, options]); return new Response("{}", { status: 200 }); } });
  await client.status({ sessionId: "est_1", token: "tok" });
  assert.equal(seen[0][0], "/api/print-estimate?id=est_1");
  assert.equal(seen[0][1].headers["X-Print-Estimate-Token"], "tok");
});
