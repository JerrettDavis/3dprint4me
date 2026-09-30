// Asynchronous slice-job runner. It claims leased jobs, runs the configured slicer
// provider, and records a new immutable "slicer" estimate. Request submission never
// waits for this runner; failures retry with bounded backoff and then stay visible.
import { randomBytes } from "node:crypto";

import { composePrintEstimate, presentPublicEstimate } from "../compose-estimate.js";
import { estimateProductionFromGeometry } from "../geometry/analyze-model.js";
import { isPermanentSliceFailure, normalizeSliceResult, SliceError } from "../slicer-contract.js";
import { estimateRow, modelSummary } from "./estimate-session.js";

export function retryDelaySeconds(attempt) {
  return Math.min(3600, 60 * 2 ** Math.max(0, attempt - 1));
}

export function createSliceJobRunner({ repository, fileStore, slicer, materialCosts, limits, workerId = `slicer-${randomBytes(6).toString("hex")}`, now = () => new Date(), leaseSeconds = 300, timeoutMs = null, logFailure = () => {} }) {
  async function processJob(job) {
    const asset = await repository.findAsset(job.assetId);
    if (!asset || asset.state === "deleted" || asset.state === "pending_upload") throw new SliceError("asset_missing", "The model is no longer available.");
    const bytes = slicer.needsBytes === false ? null : await fileStore.read(asset.blobPath, limits.maxModelBytes);
    const result = normalizeSliceResult(await slicer.estimateSlice({ bytes, blobPath: asset.blobPath, filename: asset.originalName, options: job.options, ...(timeoutMs ? { timeoutMs } : {}) }));
    const options = job.options;
    const layout = asset.geometryMetrics ? estimateProductionFromGeometry(asset.geometryMetrics, options) : { plates: options.quantity, unitsPerPlate: 1 };
    const hoursPerUnit = result.elapsedSeconds / 3600;
    const production = {
      source: "slicer", gramsPerUnit: result.materialGrams, hoursPerUnit, plates: layout.plates, unitsPerPlate: layout.unitsPerPlate,
      totalGrams: result.materialGrams * options.quantity, totalHours: hoursPerUnit * options.quantity
    };
    const estimate = composePrintEstimate({ options, production, materialCost: await materialCosts.materialCost(options.material), now: now() });
    const publicView = presentPublicEstimate({ status: "ready", estimate, modelSummary: modelSummary(asset), slice: { status: "ready" } });
    const saved = await repository.insertEstimate(estimateRow({
      estimate, publicView, asset, purpose: "slice", engine: result.engine, engineVersion: result.engineVersion,
      profileId: result.profileId, geometry: asset.geometryMetrics ?? {}, slicer: result
    }));
    return saved;
  }

  return {
    workerId,
    /** Claims and processes up to batchSize due jobs. Returns a per-state summary. */
    async runOnce({ batchSize = 1 } = {}) {
      const summary = { claimed: 0, ready: 0, retrying: 0, failed: 0 };
      const jobs = await repository.claimJobs({ workerId, batchSize, leaseSeconds, jobType: "slice" });
      summary.claimed = jobs.length;
      for (const job of jobs) {
        try {
          const estimate = await processJob(job);
          await repository.completeJob(job.id, workerId, estimate.id);
          summary.ready += 1;
        } catch (error) {
          const category = error?.name === "SliceError" ? error.category : "slicer_failed";
          logFailure(category);
          const retry = !isPermanentSliceFailure(category) && job.attemptCount < job.maxAttempts;
          const retryAt = retry ? new Date(now().getTime() + retryDelaySeconds(job.attemptCount) * 1000).toISOString() : null;
          const updated = await repository.failJob(job.id, workerId, { category, detail: error?.name === "SliceError" ? error.message : "Unexpected slicer failure.", retryAt });
          if (updated?.state === "pending") summary.retrying += 1; else summary.failed += 1;
        }
      }
      return summary;
    }
  };
}
