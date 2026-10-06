// Loopback development adapter for the print-estimation repository port. It stores
// JSON beside the local operator queue and is never used by deployed functions.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { HttpError } from "../../http.js";

const emptyState = () => ({ version: 1, filament: [], sessions: [], assets: [], estimates: [], jobs: [], runs: [], nextJobId: 1, rateBuckets: [] });
const clone = value => structuredClone(value);
const makeId = prefix => `${prefix}_${randomBytes(16).toString("hex")}`;
const TERMINAL = new Set(["completed", "declined", "cancelled"]);

async function readState(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (parsed?.version !== 1) throw new Error("Unsupported local print-estimation state.");
    return { ...emptyState(), ...parsed };
  } catch (error) {
    if (error?.code === "ENOENT") return emptyState();
    throw error;
  }
}

async function writeState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

export function createLocalPrintRepository({ path, now = () => new Date(), workLookup = async () => null }) {
  if (!path) throw new TypeError("A local print-estimation store path is required.");
  let pending = Promise.resolve();
  const exclusive = operation => {
    const result = pending.then(operation, operation);
    pending = result.catch(() => {});
    return result;
  };
  const read = async () => { await pending; return readState(path); };
  const mutate = operation => exclusive(async () => {
    const state = await readState(path);
    const result = await operation(state, now().toISOString());
    await writeState(path, state);
    return result === undefined ? undefined : clone(result);
  });
  const byNewest = (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

  return {
    path,
    // Filament cost basis
    async listFilament() {
      const state = await read();
      return clone(state.filament).sort((a, b) => a.material.localeCompare(b.material) || Number(b.active) - Number(a.active) || b.updatedAt.localeCompare(a.updatedAt));
    },
    async filamentForMaterial(material) {
      return clone((await read()).filament.filter(row => row.material === material && row.active));
    },
    saveFilament(input) {
      return mutate((state, stamp) => {
        if (input.id) {
          const existing = state.filament.find(row => row.id === input.id);
          if (!existing) throw new HttpError(404, "Filament was not found.");
          return Object.assign(existing, { ...input, updatedAt: stamp });
        }
        const row = { ...input, id: makeId("fil"), createdAt: stamp, updatedAt: stamp };
        state.filament.push(row);
        return row;
      });
    },

    // Sessions and assets
    createSession({ id, ownershipHash, assumptions, expiresAt }) {
      return mutate((state, stamp) => {
        const session = { id, ownershipHash, requestId: null, state: "open", assumptions: clone(assumptions ?? {}), expiresAt, attachedAt: null, createdAt: stamp };
        state.sessions.push(session);
        return session;
      });
    },
    async findSession(id) { return clone((await read()).sessions.find(session => session.id === id) ?? null); },
    async sessionUsage(sessionId) {
      const state = await read();
      const owned = state.assets.filter(asset => asset.sessionId === sessionId);
      return { assets: owned.filter(asset => !asset.parentAssetId).length, parts: owned.filter(asset => asset.parentAssetId).length, estimates: state.estimates.filter(estimate => estimate.sessionId === sessionId).length };
    },
    consumeRateLimit({ scope, subject, windowStart }) {
      return mutate(state => {
        let bucket = state.rateBuckets.find(row => row.scope === scope && row.subject === subject && row.windowStart === windowStart);
        if (!bucket) state.rateBuckets.push(bucket = { scope, subject, windowStart, hits: 0 });
        bucket.hits = Math.min(bucket.hits + 1, 1_000_000);
        return bucket.hits;
      });
    },
    pruneRateBuckets(before) {
      return mutate(state => {
        const kept = state.rateBuckets.filter(row => row.windowStart >= before);
        const removed = state.rateBuckets.length - kept.length;
        state.rateBuckets = kept;
        return removed;
      });
    },
    createAsset(asset) {
      return mutate((state, stamp) => {
        if (state.assets.some(existing => existing.blobPath === asset.blobPath)) throw new HttpError(409, "That upload already exists.");
        const row = { requestId: null, sizeBytes: null, sha256: null, state: "pending_upload", geometryMetrics: null, analysisErrorCode: null, analysisErrorDetail: null, retentionHold: false, deletedAt: null, ...clone(asset), createdAt: stamp, updatedAt: stamp };
        Object.assign(row, { parentAssetId: asset.parentAssetId ?? null, archiveEntry: asset.archiveEntry ?? null, quantity: asset.quantity ?? 1, selected: asset.selected ?? false });
        state.assets.push(row);
        return row;
      });
    },
    async findAsset(id) { return clone((await read()).assets.find(asset => asset.id === id) ?? null); },
    markAssetUploaded(id, sizeBytes) {
      return mutate((state, stamp) => {
        const asset = state.assets.find(row => row.id === id);
        if (asset?.state === "pending_upload") Object.assign(asset, { state: "uploaded", sizeBytes, updatedAt: stamp });
        return asset ?? null;
      });
    },
    markAssetAnalyzed(id, { sha256, metrics }) {
      return mutate((state, stamp) => {
        const asset = state.assets.find(row => row.id === id);
        if (asset && ["uploaded", "analyzing", "failed"].includes(asset.state)) Object.assign(asset, { state: "ready", sha256, geometryMetrics: clone(metrics), analysisErrorCode: null, analysisErrorDetail: null, updatedAt: stamp });
        return asset ?? null;
      });
    },
    claimPackAnalysis(id, { staleSeconds = 300 } = {}) {
      return mutate((state, stamp) => {
        const asset = state.assets.find(row => row.id === id);
        const stale = asset?.state === "analyzing" && new Date(asset.updatedAt).getTime() < new Date(stamp).getTime() - staleSeconds * 1000;
        if (!asset || asset.format !== "zip" || !(asset.state === "uploaded" || stale)) return null;
        Object.assign(asset, { state: "analyzing", updatedAt: stamp });
        return asset;
      });
    },
    async listChildren(parentId) {
      return clone((await read()).assets.filter(row => row.parentAssetId === parentId).sort((a, b) => String(a.archiveEntry).localeCompare(String(b.archiveEntry)) || a.id.localeCompare(b.id)));
    },
    selectParts(parentId, selections) {
      return mutate((state, stamp) => {
        const wanted = new Map(selections.map(item => [item.partId, item.quantity]));
        const children = state.assets.filter(row => row.parentAssetId === parentId);
        for (const row of children) Object.assign(row, { selected: wanted.has(row.id), quantity: wanted.get(row.id) ?? 1, updatedAt: stamp });
        return children.sort((a, b) => String(a.archiveEntry).localeCompare(String(b.archiveEntry)) || a.id.localeCompare(b.id));
      });
    },
    async orphanedParts({ limit = 50 } = {}) {
      const state = await read();
      const attached = new Set(state.sessions.filter(row => row.state === "attached").map(row => row.id));
      return clone(state.assets.filter(row => row.parentAssetId && !row.selected && row.state !== "deleted" && attached.has(row.sessionId)).slice(0, limit));
    },
    markAssetFailed(id, { code, detail }) {
      return mutate((state, stamp) => {
        const asset = state.assets.find(row => row.id === id);
        if (asset && ["uploaded", "analyzing", "failed"].includes(asset.state)) Object.assign(asset, { state: "failed", analysisErrorCode: code, analysisErrorDetail: String(detail ?? "").slice(0, 500), updatedAt: stamp });
        return asset ?? null;
      });
    },

    // Immutable estimate snapshots
    insertEstimate(row) {
      return mutate((state, stamp) => {
        const estimate = { ...clone(row), id: makeId("pest"), requestId: row.requestId ?? null, createdAt: stamp };
        state.estimates.push(estimate);
        return estimate;
      });
    },
    async listSessionEstimates(sessionId, limit = 20) {
      return clone((await read()).estimates.filter(row => row.sessionId === sessionId).sort(byNewest).slice(0, limit));
    },
    async findEstimate(id) { return clone((await read()).estimates.find(row => row.id === id) ?? null); },

    // Asynchronous analysis jobs
    enqueueJob({ assetId, jobType, profileKey, options, maxAttempts = 4 }) {
      return mutate((state, stamp) => {
        const active = state.jobs.find(job => job.assetId === assetId && job.jobType === jobType && job.profileKey === profileKey && ["pending", "processing"].includes(job.state));
        if (active) return active;
        const job = { id: String(state.nextJobId++), assetId, jobType, state: "pending", profileKey, options: clone(options), attemptCount: 0, maxAttempts, nextAttemptAt: stamp, leaseOwner: null, leaseExpiresAt: null, lastErrorCategory: null, lastErrorDetail: null, resultEstimateId: null, createdAt: stamp, updatedAt: stamp, completedAt: null };
        state.jobs.push(job);
        return job;
      });
    },
    async listAssetJobs(assetId) {
      return clone((await read()).jobs.filter(job => job.assetId === assetId).sort((a, b) => Number(b.id) - Number(a.id)));
    },
    claimJobs({ workerId, batchSize = 1, leaseSeconds = 300, jobType = "slice" }) {
      return mutate((state, stamp) => {
        const current = new Date(stamp);
        const claimed = state.jobs
          .filter(job => job.jobType === jobType && ["pending", "processing"].includes(job.state) && new Date(job.nextAttemptAt) <= current && job.attemptCount < job.maxAttempts && (!job.leaseExpiresAt || new Date(job.leaseExpiresAt) <= current))
          .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt) || Number(a.id) - Number(b.id))
          .slice(0, batchSize);
        for (const job of claimed) Object.assign(job, { state: "processing", leaseOwner: workerId, attemptCount: job.attemptCount + 1, leaseExpiresAt: new Date(current.getTime() + leaseSeconds * 1000).toISOString(), updatedAt: stamp });
        return claimed;
      });
    },
    completeJob(jobId, workerId, estimateId) {
      return mutate((state, stamp) => {
        const job = state.jobs.find(row => row.id === String(jobId) && row.leaseOwner === workerId && row.state === "processing");
        if (!job) return null;
        return Object.assign(job, { state: "ready", resultEstimateId: estimateId, leaseOwner: null, leaseExpiresAt: null, lastErrorCategory: null, lastErrorDetail: null, completedAt: stamp, updatedAt: stamp });
      });
    },
    failJob(jobId, workerId, { category, detail, retryAt }) {
      return mutate((state, stamp) => {
        const job = state.jobs.find(row => row.id === String(jobId) && row.leaseOwner === workerId && row.state === "processing");
        if (!job) return null;
        const final = !retryAt || job.attemptCount >= job.maxAttempts;
        return Object.assign(job, { state: final ? "failed" : "pending", nextAttemptAt: retryAt ?? job.nextAttemptAt, leaseOwner: null, leaseExpiresAt: null, lastErrorCategory: category, lastErrorDetail: String(detail ?? "").slice(0, 500), completedAt: final ? stamp : null, updatedAt: stamp });
      });
    },

    attachSession({ sessionId, ownershipHash, requestId }) {
      return mutate((state, stamp) => {
        const session = state.sessions.find(row => row.id === sessionId && row.ownershipHash === ownershipHash && row.state === "open" && !row.requestId && new Date(row.expiresAt) > new Date(stamp));
        if (!session || state.sessions.some(row => row.requestId === requestId)) return { attached: false, assets: 0 };
        Object.assign(session, { requestId, state: "attached", attachedAt: stamp });
        let assets = 0;
        for (const asset of state.assets.filter(row => row.sessionId === sessionId && ["uploaded", "ready", "failed"].includes(row.state))) {
          Object.assign(asset, { requestId, retentionExpiresAt: null, updatedAt: stamp }); assets += 1;
        }
        for (const estimate of state.estimates.filter(row => row.sessionId === sessionId && !row.requestId)) estimate.requestId = requestId;
        return { attached: true, assets };
      });
    },

    // Private operator read model
    async forRequest(requestId, { workItemId = null } = {}) {
      const state = await read();
      const assets = state.assets.filter(row => row.requestId === requestId);
      const assetIds = new Set(assets.map(row => row.id));
      return clone({
        assets: assets.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        estimates: state.estimates.filter(row => row.requestId === requestId).sort(byNewest).slice(0, 50),
        jobs: state.jobs.filter(row => assetIds.has(row.assetId)).sort((a, b) => Number(b.id) - Number(a.id)),
        runs: workItemId ? state.runs.filter(row => row.workItemId === workItemId).sort(byNewest) : []
      });
    },
    recordRun(run) {
      return mutate((state, stamp) => {
        const row = { ...clone(run), id: makeId("run"), createdAt: stamp };
        state.runs.push(row);
        return row;
      });
    },

    // Retention and privacy
    async expiredSessions({ limit = 50 } = {}) {
      const state = await read();
      const current = now();
      return clone(state.sessions.filter(row => row.state === "open" && new Date(row.expiresAt) <= current).slice(0, limit)
        .map(session => ({ session, assets: state.assets.filter(asset => asset.sessionId === session.id) })));
    },
    deleteUnattachedSession(sessionId) {
      return mutate(state => {
        const session = state.sessions.find(row => row.id === sessionId && !row.requestId);
        if (!session) return false;
        const assetIds = new Set(state.assets.filter(row => row.sessionId === sessionId).map(row => row.id));
        state.jobs = state.jobs.filter(row => !assetIds.has(row.assetId));
        state.estimates = state.estimates.filter(row => row.sessionId !== sessionId);
        state.assets = state.assets.filter(row => row.sessionId !== sessionId);
        state.sessions = state.sessions.filter(row => row.id !== sessionId);
        return true;
      });
    },
    async staleUnattachedUploads({ olderThan, limit = 50 }) {
      return clone((await read()).assets.filter(row => !row.requestId && row.state === "pending_upload" && row.createdAt <= new Date(olderThan).toISOString()).slice(0, limit));
    },
    deleteAssetRecord(assetId) {
      return mutate(state => {
        const asset = state.assets.find(row => row.id === assetId && !row.requestId);
        if (!asset) return false;
        state.jobs = state.jobs.filter(row => row.assetId !== assetId);
        state.estimates = state.estimates.filter(row => row.assetId !== assetId || row.requestId);
        state.assets = state.assets.filter(row => row.id !== assetId);
        return true;
      });
    },
    async retentionCandidates({ completedBefore, limit = 50 }) {
      const state = await read();
      const cutoff = new Date(completedBefore);
      const result = [];
      for (const asset of state.assets.filter(row => row.requestId && row.state !== "deleted" && !row.retentionHold)) {
        const work = await workLookup(asset.requestId);
        if (work && TERMINAL.has(work.status) && new Date(work.completedAt ?? work.updatedAt) <= cutoff) result.push(asset);
        if (result.length >= limit) break;
      }
      return clone(result);
    },
    markAssetDeleted(assetId) {
      return mutate((state, stamp) => {
        const asset = state.assets.find(row => row.id === assetId && row.state !== "deleted");
        if (!asset) return null;
        return Object.assign(asset, { state: "deleted", deletedAt: stamp, updatedAt: stamp });
      });
    },
    purgeRequest(requestId) {
      return mutate(state => {
        const sessionIds = new Set(state.sessions.filter(row => row.requestId === requestId).map(row => row.id));
        const assets = state.assets.filter(row => row.requestId === requestId || sessionIds.has(row.sessionId));
        const assetIds = new Set(assets.map(row => row.id));
        state.jobs = state.jobs.filter(row => !assetIds.has(row.assetId));
        state.estimates = state.estimates.filter(row => row.requestId !== requestId && !assetIds.has(row.assetId) && !sessionIds.has(row.sessionId));
        state.assets = state.assets.filter(row => !assetIds.has(row.id));
        state.sessions = state.sessions.filter(row => !sessionIds.has(row.id));
        for (const run of state.runs) if (run.estimateId && !state.estimates.some(estimate => estimate.id === run.estimateId)) run.estimateId = null;
        return { assets };
      });
    },
    async snapshot() { return clone(await read()); }
  };
}
