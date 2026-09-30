import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createOperatorPrintHandler } from "../../api/operator-print.js";
import { createLocalPrintRepository } from "../../lib/print-estimation/adapters/local-print-repository.js";
import { createEstimateSessionUseCases } from "../../lib/print-estimation/application/estimate-session.js";
import { createFilamentUseCases } from "../../lib/print-estimation/application/filament.js";
import { createOperatorPrintView, normalizePrintRun } from "../../lib/print-estimation/application/operator-view.js";
import { hashCapability } from "../../lib/print-estimation/capability.js";
import { createLocalWorkRepository } from "../../lib/work-management/adapters/local-work-repository.js";
import { presentHomeAssistantSnapshot } from "../../lib/work-management/home-assistant-snapshot.js";
import { createWorkManagementService } from "../../lib/work-management/service.js";

const request = { projectTitle: "Bracket", service: "print", description: "Print it.", contact: { name: "Taylor", email: "taylor@example.com" }, consent: true };

async function attachedWork() {
  const directory = await mkdtemp(join(tmpdir(), "3dp-print-operator-"));
  const work = createLocalWorkRepository({ path: join(directory, "work.json") });
  const repository = createLocalPrintRepository({ path: join(directory, "print.json") });
  const objects = new Map();
  const fileStore = {
    async authorizeUpload() { return { uploadUrl: "https://upload.invalid" }; }, async inspect(path) { return objects.has(path) ? { size: objects.get(path).length } : null; },
    async read(path) { return objects.get(path); }, async delete(path) { objects.delete(path); },
    async signDownload(path, seconds) { return `https://download.invalid/${encodeURIComponent(path)}?ttl=${seconds}`; }
  };
  const estimates = createEstimateSessionUseCases({ repository, fileStore, materialCosts: createFilamentUseCases({ repository }) });
  const session = await estimates.create({});
  const upload = await estimates.authorizeUpload({ ...session, filename: "bracket.stl", size: 684 });
  objects.set((await repository.findAsset(upload.assetId)).blobPath, new Uint8Array(await readFile(new URL("../fixtures/print-estimation/cube-20mm-binary.stl", import.meta.url))));
  await estimates.analyze({ ...session, assetId: upload.assetId });
  await estimates.analyze({ ...session, assetId: upload.assetId, options: { quantity: 4 } }, { purpose: "submission" });
  const completed = await work.completeRequestWithWork("3DP-20260930-OPERATOR01", request, [{ name: "bracket.stl", mode: "estimate" }]);
  await repository.attachSession({ sessionId: session.sessionId, ownershipHash: hashCapability(session.token), requestId: "3DP-20260930-OPERATOR01" });
  const other = await work.completeRequestWithWork("3DP-20260930-OPERATOR02", { ...request, projectTitle: "Other" }, []);
  return { directory, work, repository, fileStore, objects, upload, workId: completed.workItem.id, otherWorkId: other.workItem.id, close: () => rm(directory, { recursive: true, force: true }) };
}

test("work detail gains private print estimation while the list and Home Assistant stay minimized", async () => {
  const context = await attachedWork();
  try {
    let forWorkCalls = 0;
    const view = createOperatorPrintView({ repository: context.repository, fileStore: context.fileStore });
    const service = createWorkManagementService({ repository: context.work, printEstimates: { forWork: detail => { forWorkCalls += 1; return view.forWork(detail); } } });
    const detail = await service.detail(context.workId, { id: "op" });
    const print = detail.printEstimation;
    assert.equal(print.available, true);
    assert.equal(print.assets[0].originalName, "bracket.stl");
    assert.deepEqual(print.assets[0].geometry.dimensionsMm, [20, 20, 20]);
    assert.equal(JSON.stringify(print).includes("print-estimates/"), false, "the Blob path stays server-side");
    assert.equal(print.latestEstimate.purpose, "submission");
    assert.equal(print.latestEstimate.assumptions.quantity, 4);
    assert.ok(print.latestEstimate.cost.total > 0 && print.latestEstimate.pricing.economicFloor > 0);
    assert.ok(print.latestEstimate.pricing.projected.margin.target > 0);
    assert.equal(print.estimates.length, 2, "estimate history keeps every snapshot");
    assert.equal(print.downloadTtlSeconds, 60);

    const list = await service.list({ view: "active", service: null, priority: null, cursor: null, limit: 20 });
    const snapshot = presentHomeAssistantSnapshot(await context.work.getHomeAssistantSnapshot());
    assert.equal(forWorkCalls, 1, "only detail reads print data");
    for (const payload of [list, snapshot]) {
      const text = JSON.stringify(payload).toLowerCase();
      for (const forbidden of ["printestimation", "margin", "cost", "bracket.stl", "estimate", "asset"]) assert.equal(text.includes(forbidden), false, `${forbidden} leaked`);
    }

    const failing = createWorkManagementService({ repository: context.work, printEstimates: { forWork: async () => { throw new Error("relation print_assets does not exist"); } } });
    assert.deepEqual((await failing.detail(context.workId, { id: "op" })).printEstimation, { available: false }, "an unmigrated database never breaks work detail");
  } finally { await context.close(); }
});

test("operator downloads are short-lived and scoped to the work item's own assets", async () => {
  const context = await attachedWork();
  try {
    const view = createOperatorPrintView({ repository: context.repository, fileStore: context.fileStore, now: () => new Date("2026-09-30T12:00:00Z") });
    const own = await context.work.getWork(context.workId);
    const signed = await view.signDownload({ work: own, assetId: context.upload.assetId });
    assert.match(signed.url, /\?ttl=60$/);
    assert.equal(signed.expiresAt, "2026-09-30T12:01:00.000Z");
    assert.equal(signed.filename, "bracket.stl");
    const other = await context.work.getWork(context.otherWorkId);
    await assert.rejects(view.signDownload({ work: other, assetId: context.upload.assetId }), error => error.status === 404);
    await assert.rejects(view.signDownload({ work: own, assetId: "../etc/passwd" }), error => error.status === 400);
    await context.repository.markAssetDeleted(context.upload.assetId);
    await assert.rejects(view.signDownload({ work: own, assetId: context.upload.assetId }), error => error.status === 410);
  } finally { await context.close(); }
});

test("the operator print API requires operator authorization before signing a download", async () => {
  const context = await attachedWork();
  try {
    const printRuntime = { repository: context.repository, fileStore: context.fileStore };
    const call = async (authorize, url, { origin = "https://work.example", method = "GET", body } = {}) => {
      const headers = {};
      const res = { statusCode: 200, headers, setHeader: (k, v) => { headers[k.toLowerCase()] = v; }, end(value) { this.body = value; this.writableEnded = true; }, writableEnded: false };
      await createOperatorPrintHandler({ store: context.work, printRuntime, allowedOrigins: ["https://work.example"], authorize })({ method, url, headers: { origin, "content-type": "application/json" }, body }, res);
      return { status: res.statusCode, body: JSON.parse(res.body) };
    };
    const url = `/api/operator-print?resource=asset-download&workId=${context.workId}&assetId=${context.upload.assetId}`;
    const { HttpError } = await import("../../lib/http.js");
    const anonymous = await call(async () => { throw new HttpError(401, "Sign in."); }, url);
    assert.equal(anonymous.status, 401);
    assert.equal("url" in anonymous.body, false);
    assert.equal((await call(async () => ({ id: "op_1", role: "operator" }), url, { origin: "https://evil.example" })).status, 403);
    const allowed = await call(async () => ({ id: "op_1", role: "operator" }), url);
    assert.equal(allowed.status, 200);
    assert.match(allowed.body.url, /ttl=60/);
    const run = await call(async () => ({ id: "op_1", role: "operator" }), "/api/operator-print", { method: "POST", body: { action: "record-run", workId: context.workId, run: { actualGrams: 30, actualMachineHours: 3, failedAttempts: 1 } } });
    assert.equal(run.status, 200);
    assert.equal(run.body.run.recordedBy, "op_1");
    assert.equal((await call(async () => ({ id: "op_1" }), "/api/operator-print", { method: "POST", body: { action: "record-run", workId: context.workId, run: { actualGrams: -1 } } })).status, 400);
  } finally { await context.close(); }
});

test("recorded production runs show estimated-versus-actual variance", async () => {
  const context = await attachedWork();
  try {
    const view = createOperatorPrintView({ repository: context.repository, fileStore: context.fileStore });
    const detail = await context.work.getWork(context.workId);
    const before = await view.forWork(detail);
    const estimate = before.latestEstimate;
    await view.recordRun({ work: detail, operator: { id: "op_1" }, run: normalizePrintRun({ estimateId: estimate.id, actualGrams: estimate.production.totalGrams * 1.1, actualMachineHours: estimate.production.totalHours * 0.8, activeLaborMinutes: 20 }) });
    const [run] = (await view.forWork(detail)).runs;
    assert.equal(run.variance.grams, 0.1);
    assert.equal(run.variance.machineHours, -0.2);
    const foreign = await context.work.getWork(context.otherWorkId);
    await assert.rejects(view.recordRun({ work: foreign, operator: { id: "op_1" }, run: normalizePrintRun({ estimateId: estimate.id }) }), error => error.status === 400);
    assert.throws(() => normalizePrintRun({ actualGrams: 1, blobPath: "x" }), error => error.status === 400);
  } finally { await context.close(); }
});
