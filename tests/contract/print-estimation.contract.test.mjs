import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLocalPrintRepository } from "../../lib/print-estimation/adapters/local-print-repository.js";
import { createNeonPrintRepository } from "../../lib/print-estimation/adapters/neon-print-repository.js";
import { createEstimateSessionUseCases } from "../../lib/print-estimation/application/estimate-session.js";
import { createFilamentUseCases } from "../../lib/print-estimation/application/filament.js";
import { createRetentionUseCases } from "../../lib/print-estimation/application/retention.js";
import { hashCapability } from "../../lib/print-estimation/capability.js";
import { createLocalWorkRepository } from "../../lib/work-management/adapters/local-work-repository.js";
import { createNeonWorkRepository } from "../../lib/work-management/adapters/neon-work-repository.js";
import { createMigratedDatabase } from "../support/pglite-neon.mjs";

const fixture = async name => new Uint8Array(await readFile(new URL(`../fixtures/print-estimation/${name}`, import.meta.url)));
const request = { projectTitle: "Bracket", service: "print", description: "Print it.", contact: { name: "Taylor", email: "taylor@example.com" }, consent: true, files: [{ name: "cube.stl", size: 684 }] };

function memoryFileStore() {
  const objects = new Map();
  const authorized = new Map();
  return {
    objects,
    async authorizeUpload(path, size) { authorized.set(path, size); return { uploadUrl: `https://upload.invalid/${encodeURIComponent(path)}`, method: "PUT", headers: {}, bodyType: "file" }; },
    put(path, bytes) { if (!authorized.has(path) || bytes.length > authorized.get(path)) throw new Error("unauthorized upload"); objects.set(path, bytes); },
    async inspect(path) { return objects.has(path) ? { size: objects.get(path).length } : null; },
    async read(path, max) { const bytes = objects.get(path); if (bytes.length > max) throw new Error("too large"); return bytes; },
    async signDownload(path, seconds) { return `https://download.invalid/${encodeURIComponent(path)}?ttl=${seconds}`; },
    async delete(path) { objects.delete(path); }
  };
}

// Each adapter gets the same scenario: local JSON, and the real Neon SQL executed on PGlite.
const adapters = [
  ["local", async () => {
    const directory = await mkdtemp(join(tmpdir(), "3dp-print-contract-"));
    const work = createLocalWorkRepository({ path: join(directory, "work.json") });
    const repository = createLocalPrintRepository({
      path: join(directory, "print.json"),
      workLookup: async requestId => { const item = (await work.snapshot()).workItems.find(entry => entry.requestId === requestId); return item && { status: item.status, completedAt: item.completedAt, updatedAt: item.updatedAt }; }
    });
    return {
      repository,
      createDraft: async () => {},
      complete: async (id, attachment) => {
        const completed = await work.completeRequestWithWork(id, request, []);
        const printEstimate = attachment ? await repository.attachSession({ ...attachment, requestId: id }) : null;
        return { ...completed, printEstimate };
      },
      finishWork: async (workId, when) => {
        const state = JSON.parse(await readFile(join(directory, "work.json"), "utf8"));
        const item = state.workItems.find(entry => entry.id === workId);
        Object.assign(item, { status: "completed", completedAt: when, updatedAt: when });
        const { writeFile } = await import("node:fs/promises");
        await writeFile(join(directory, "work.json"), JSON.stringify(state));
      },
      expireSession: async sessionId => {
        const { writeFile } = await import("node:fs/promises");
        const state = JSON.parse(await readFile(repository.path, "utf8"));
        state.sessions.find(entry => entry.id === sessionId).expiresAt = "2000-01-01T00:00:00.000Z";
        await writeFile(repository.path, JSON.stringify(state));
      },
      mutateEstimate: null,
      close: () => rm(directory, { recursive: true, force: true })
    };
  }],
  ["neon-sql-on-pglite", async () => {
    const database = await createMigratedDatabase();
    const repository = createNeonPrintRepository({ query: database.query });
    const work = createNeonWorkRepository({ query: database.query });
    return {
      repository,
      createDraft: id => database.query`INSERT INTO service_requests (id, status, service, project_title, contact_name, contact_email, payload)
        VALUES (${id}, 'draft', 'print', 'Bracket', 'Taylor', 'taylor@example.com', '{}'::jsonb)`,
      complete: (id, attachment) => work.completeRequestWithWork(id, request, [], attachment),
      finishWork: (workId, when) => database.query`UPDATE work_items SET status = 'completed', completed_at = ${when}::timestamptz, updated_at = ${when}::timestamptz WHERE id = ${workId}`,
      expireSession: sessionId => database.query`UPDATE print_estimate_sessions SET expires_at = '2000-01-01' WHERE id = ${sessionId}`,
      mutateEstimate: id => database.query`UPDATE print_estimates SET price_low_cents = 1 WHERE id = ${id}`,
      database,
      close: () => database.close()
    };
  }]
];

for (const [name, setup] of adapters) {
  test(`print estimation contract (${name}): private upload, verification, snapshot, attachment, and retention`, { timeout: 60_000 }, async () => {
    const context = await setup();
    try {
      const { repository } = context;
      const files = memoryFileStore();
      const estimates = createEstimateSessionUseCases({ repository, fileStore: files, materialCosts: createFilamentUseCases({ repository }), policy: { sessionTtlHours: 24, maxAssetsPerSession: 2, maxEstimatesPerSession: 5 } });

      const session = await estimates.create({ options: { material: "petg", quantity: 2 } });
      assert.match(session.sessionId, /^est_[a-f0-9]{32}$/);
      assert.equal(session.token.length, 43);
      assert.equal((await repository.findSession(session.sessionId)).ownershipHash, hashCapability(session.token), "only the token hash is stored");

      await assert.rejects(estimates.authorizeUpload({ ...session, token: "A".repeat(43), filename: "cube.stl", size: 684 }), error => error.status === 404, "wrong capability");
      await assert.rejects(estimates.authorizeUpload({ ...session, filename: "cube.obj", size: 684 }), error => error.status === 400, "non-model extension");
      await assert.rejects(estimates.authorizeUpload({ ...session, filename: "cube.stl", size: 26 * 1024 * 1024 }), error => error.status === 400, "server-side size limit");

      const upload = await estimates.authorizeUpload({ ...session, filename: "../cube.stl", size: 684, contentType: "model/stl" });
      assert.match(upload.assetId, /^asset_[a-f0-9]{32}$/);
      assert.equal("path" in upload, false, "the private Blob path is not returned to the browser");
      const asset = await repository.findAsset(upload.assetId);
      assert.match(asset.blobPath, new RegExp(`^print-estimates/${session.sessionId}/[a-f0-9]{10}-cube\\.stl$`));
      await assert.rejects(estimates.analyze({ ...session, assetId: upload.assetId }), error => error.status === 409, "upload must exist before analysis");
      files.put(asset.blobPath, await fixture("cube-20mm-binary.stl"));

      const other = await estimates.create({});
      await assert.rejects(estimates.analyze({ ...other, assetId: upload.assetId }), error => error.status === 404, "another session cannot analyze this asset");

      const ready = await estimates.analyze({ ...session, assetId: upload.assetId, options: { material: "petg", quantity: 2, quality: "fine" } });
      assert.equal(ready.status, "ready");
      assert.equal(ready.confidence, "rough");
      assert.deepEqual(ready.model.dimensionsMm, [20, 20, 20]);
      assert.equal(ready.production.material, "PETG");
      assert.ok(ready.price.low >= 15 && ready.price.high > ready.price.low);
      const serialized = JSON.stringify(ready).toLowerCase();
      for (const forbidden of ["cost", "margin", "floor", "landed", "wage", "blob", "print-estimates/", "sha256"]) assert.equal(serialized.includes(forbidden), false, `public estimate leaked ${forbidden}`);
      assert.equal((await repository.findAsset(upload.assetId)).state, "ready");
      assert.match((await repository.findAsset(upload.assetId)).sha256, /^[a-f0-9]{64}$/);

      const status = await estimates.status(session);
      assert.equal(status.price.low, ready.price.low);
      const [snapshot] = await repository.listSessionEstimates(session.sessionId, 1);
      assert.equal(snapshot.estimatorType, "geometry");
      assert.equal(snapshot.engine, "3dprint4me-geometry");
      assert.ok(snapshot.cost.total > 0, "internal cost is persisted privately");
      assert.equal(snapshot.cost.materialCost.source, "fallback");
      assert.ok(snapshot.pricing.economicFloor > 0);
      assert.equal(snapshot.pricing.model.version, snapshot.pricingModelVersion);

      const bomb = await estimates.authorizeUpload({ ...session, filename: "bomb.3mf", size: 40_000 });
      files.put((await repository.findAsset(bomb.assetId)).blobPath, await fixture("zip-bomb.3mf"));
      const failed = await estimates.analyze({ ...session, assetId: bomb.assetId });
      assert.deepEqual({ status: failed.status, reason: failed.reason }, { status: "failed", reason: "analysis_unavailable" });
      const failedAsset = await repository.findAsset(bomb.assetId);
      assert.equal(failedAsset.analysisErrorCode, "zip_limit", "diagnostic code stays private");
      await assert.rejects(estimates.authorizeUpload({ ...session, filename: "third.stl", size: 10 }), error => error.status === 429, "per-session asset limit");

      if (context.mutateEstimate) await assert.rejects(context.mutateEstimate(snapshot.id), /immutable/, "snapshots cannot be rewritten");

      const requestId = "3DP-20260930-CONTRACT0001";
      await context.createDraft(requestId);
      const completed = await context.complete(requestId, { sessionId: session.sessionId, ownershipHash: hashCapability(session.token) });
      assert.equal(completed.printEstimate.attached, true);
      await assert.rejects(estimates.analyze({ ...session, assetId: upload.assetId }), error => error.status === 410, "attaching ends the anonymous capability");
      const attached = await repository.forRequest(requestId);
      assert.deepEqual(attached.assets.map(entry => entry.id).sort(), [upload.assetId, bomb.assetId].sort());
      assert.ok(attached.estimates.length >= 1);
      assert.ok(attached.assets.every(entry => entry.retentionExpiresAt === null), "submitted assets adopt the work retention policy");

      const replayId = "3DP-20260930-CONTRACT0002";
      await context.createDraft(replayId);
      const replay = await context.complete(replayId, { sessionId: session.sessionId, ownershipHash: hashCapability(session.token) });
      assert.equal(replay.printEstimate.attached, false, "a session attaches to exactly one request");

      const abandoned = await estimates.create({});
      const abandonedUpload = await estimates.authorizeUpload({ ...abandoned, filename: "left.stl", size: 684 });
      const abandonedPath = (await repository.findAsset(abandonedUpload.assetId)).blobPath;
      files.put(abandonedPath, await fixture("cube-20mm-binary.stl"));
      await context.expireSession(abandoned.sessionId);
      const retention = createRetentionUseCases({ repository, fileStore: files });
      const sweep = await retention.sweep();
      assert.equal(sweep.expiredSessions >= 1, true);
      assert.equal(files.objects.has(abandonedPath), false, "abandoned model object deleted");
      assert.equal(await repository.findSession(abandoned.sessionId), null);
      assert.equal(files.objects.has(asset.blobPath), true, "active work keeps its model");

      await context.finishWork(completed.workItem.id, "2020-01-01T00:00:00.000Z");
      const aged = await retention.sweep();
      assert.equal(aged.retentionDeleted, 2);
      assert.equal(files.objects.has(asset.blobPath), false);
      assert.equal((await repository.findAsset(upload.assetId)).state, "deleted");

      const purge = await retention.purgeRequest(requestId);
      assert.equal(purge.assets, 2);
      assert.deepEqual(await repository.forRequest(requestId), { assets: [], estimates: [], jobs: [], runs: [] });
      assert.equal(await repository.findSession(session.sessionId), null);
    } finally { await context.close(); }
  });

  test(`print job queue contract (${name}): one active job per profile, bounded retries, and exclusive leases`, { timeout: 60_000 }, async () => {
    const context = await setup();
    try {
      const { repository } = context;
      const files = memoryFileStore();
      const estimates = createEstimateSessionUseCases({ repository, fileStore: files, materialCosts: createFilamentUseCases({ repository }), slicerEnabled: true });
      const session = await estimates.create({});
      const upload = await estimates.authorizeUpload({ ...session, filename: "cube.stl", size: 684 });
      files.put((await repository.findAsset(upload.assetId)).blobPath, await fixture("cube-20mm-binary.stl"));
      const first = await estimates.analyze({ ...session, assetId: upload.assetId });
      assert.equal(first.slice.status, "pending", "a configured slicer is queued, never awaited");
      await estimates.analyze({ ...session, assetId: upload.assetId });
      const jobs = await repository.listAssetJobs(upload.assetId);
      assert.equal(jobs.length, 1, "re-estimating the same profile does not duplicate work");

      const [claimed] = await repository.claimJobs({ workerId: "worker-a", batchSize: 5, leaseSeconds: 300 });
      assert.equal(claimed.state, "processing");
      assert.equal(claimed.attemptCount, 1);
      assert.deepEqual(await repository.claimJobs({ workerId: "worker-b", batchSize: 5 }), [], "leased jobs are exclusive");
      assert.equal(await repository.completeJob(claimed.id, "worker-b", null), null, "a non-owner cannot complete the job");
      const retried = await repository.failJob(claimed.id, "worker-a", { category: "timeout", detail: "slicer timed out", retryAt: new Date(Date.now() - 1000).toISOString() });
      assert.equal(retried.state, "pending");
      const [again] = await repository.claimJobs({ workerId: "worker-a", batchSize: 1 });
      assert.equal(again.attemptCount, 2);
      const final = await repository.failJob(again.id, "worker-a", { category: "slicer_failed", detail: "exit 1", retryAt: null });
      assert.equal(final.state, "failed");
      assert.deepEqual(await repository.claimJobs({ workerId: "worker-a", batchSize: 1 }), []);
      const status = await estimates.status(session);
      assert.equal(status.slice.status, "failed");
      const requeued = await estimates.analyze({ ...session, assetId: upload.assetId });
      assert.equal(requeued.slice.status, "pending", "a failed slice can be re-requested");
    } finally { await context.close(); }
  });
}
