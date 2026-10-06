// Private operator read model and actions for print estimates. It is composed into
// work *detail* only; the minimized list and the Home Assistant snapshot never see it.
import { HttpError } from "../../http.js";
import { validateAssetId } from "../capability.js";
import { sliceProfileKey } from "../domain.js";
import { entryLabel } from "./pack.js";

/** Latest authoritative snapshot: a slicer result for the submitted profile, else the submission, else the newest. */
export function selectLatestEstimate(estimates) {
  const base = estimates.find(row => row.purpose === "submission") ?? estimates[0] ?? null;
  if (!base) return null;
  const key = sliceProfileKey(base.input?.options ?? {});
  return estimates.find(row => row.estimatorType === "slicer" && row.assetId === base.assetId && sliceProfileKey(row.input?.options ?? {}) === key) ?? base;
}

export const OPERATOR_DOWNLOAD_TTL_SECONDS = 60;
const round = (value, places = 2) => value == null || !Number.isFinite(Number(value)) ? null : Math.round(Number(value) * 10 ** places) / 10 ** places;

function presentAsset(asset) {
  const metrics = asset.geometryMetrics ?? null;
  const isPack = asset.format === "zip";
  return {
    id: asset.id, originalName: asset.originalName, format: asset.format, contentType: asset.contentType, sizeBytes: asset.sizeBytes ?? asset.declaredSizeBytes,
    sha256: asset.sha256, state: asset.state, analysisError: asset.analysisErrorCode ? { code: asset.analysisErrorCode, detail: asset.analysisErrorDetail } : null,
    parentAssetId: asset.parentAssetId ?? null, archiveEntry: asset.archiveEntry ?? null, quantity: asset.quantity ?? 1, selected: Boolean(asset.selected),
    // Archive-supplied names: the same sanitization as the customer view.
    ...(isPack ? { pack: { ignored: (metrics?.pack?.ignored ?? []).map(item => ({ ...item, name: entryLabel(item.name) })) } } : {}),
    geometry: metrics && !isPack ? {
      dimensionsMm: metrics.dimensionsMm, volumeCm3: round(metrics.volumeMm3 / 1000), surfaceAreaCm2: round(metrics.surfaceAreaMm2 / 100),
      triangleCount: metrics.triangleCount, unit: metrics.unit, warnings: metrics.warnings ?? [], analyzer: metrics.analyzer ?? null
    } : null,
    retention: { hold: asset.retentionHold, expiresAt: asset.retentionExpiresAt, deletedAt: asset.deletedAt },
    downloadable: ["uploaded", "ready", "failed"].includes(asset.state), createdAt: asset.createdAt
  };
}

export function presentOperatorEstimate(estimate) {
  if (!estimate) return null;
  const { pricing, cost, input } = estimate;
  return {
    id: estimate.id, createdAt: estimate.createdAt, purpose: estimate.purpose, estimatorType: estimate.estimatorType, confidence: estimate.confidence,
    engine: estimate.engine, engineVersion: estimate.engineVersion, profileId: estimate.profileId,
    pricingModelVersion: estimate.pricingModelVersion, rateCardVersion: estimate.rateCardVersion, assetId: estimate.assetId,
    assumptions: input?.options ?? {},
    production: input?.production ?? {},
    slicer: estimate.estimatorType === "slicer" ? estimate.slicer : null,
    cost: {
      material: cost.material, passiveMachine: cost.passiveMachine, activeLabor: cost.activeLabor, finishingLabor: cost.finishingLabor, other: cost.other,
      total: cost.total, perUnit: cost.perUnit, plates: cost.plates, quantity: cost.quantity, rates: cost.rates, materialCost: cost.materialCost
    },
    pricing: {
      marketPrice: pricing.marketPrice, economicFloor: pricing.economicFloor, minimumCharge: pricing.minimumCharge, requiredMinimumMargin: pricing.requiredMinimumMargin,
      selectedPrice: pricing.selectedPrice, selectedBy: pricing.selectedBy, spread: pricing.spread, range: pricing.range, projected: pricing.projected
    }
  };
}

function summarizeEstimate(estimate) {
  return {
    id: estimate.id, createdAt: estimate.createdAt, purpose: estimate.purpose, estimatorType: estimate.estimatorType, confidence: estimate.confidence,
    engine: estimate.engine, profileId: estimate.profileId, low: estimate.priceLowCents / 100, high: estimate.priceHighCents / 100,
    target: estimate.targetPriceCents / 100, costTotal: estimate.cost?.total ?? null, targetMargin: estimate.pricing?.projected?.margin?.target ?? null
  };
}

function presentJob(job) {
  return { id: job.id, jobType: job.jobType, state: job.state, profileKey: job.profileKey, attemptCount: job.attemptCount, maxAttempts: job.maxAttempts, lastErrorCategory: job.lastErrorCategory, nextAttemptAt: job.nextAttemptAt, completedAt: job.completedAt, createdAt: job.createdAt };
}

/** Estimated-versus-actual variance for one recorded production run. */
function presentRun(run, estimates) {
  const estimate = estimates.find(row => row.id === run.estimateId) ?? null;
  const planned = estimate ? { grams: estimate.input?.production?.totalGrams ?? null, machineHours: estimate.input?.production?.totalHours ?? null } : null;
  const variance = (actual, plan) => actual == null || !plan ? null : round((actual - plan) / plan, 4);
  return { ...run, planned, variance: planned ? { grams: variance(run.actualGrams, planned.grams), machineHours: variance(run.actualMachineHours, planned.machineHours) } : null };
}

export function createOperatorPrintView({ repository, fileStore = null, now = () => new Date() }) {
  return {
    /** Private print-estimation section for one work detail. */
    async forWork(detail) {
      const requestId = detail?.item?.requestId;
      if (!requestId || !repository) return { available: false };
      const { assets, estimates, jobs, runs } = await repository.forRequest(requestId, { workItemId: detail.item.id });
      if (!assets.length && !estimates.length) return { available: true, assets: [], latestEstimate: null, estimates: [], jobs: [], runs: [] };
      const latest = selectLatestEstimate(estimates);
      return {
        available: true,
        assets: assets.map(presentAsset),
        latestEstimate: presentOperatorEstimate(latest),
        estimates: estimates.map(summarizeEstimate),
        jobs: jobs.map(presentJob),
        runs: runs.map(run => presentRun(run, estimates)),
        downloadTtlSeconds: OPERATOR_DOWNLOAD_TTL_SECONDS
      };
    },
    /** Very short-lived signed GET for one attached asset, after verifying it belongs to the work item. */
    async signDownload({ work, assetId }) {
      if (!fileStore) throw new HttpError(503, "Private model storage is not configured.");
      const asset = await repository.findAsset(validateAssetId(assetId));
      if (!asset || !work?.item?.requestId || asset.requestId !== work.item.requestId) throw new HttpError(404, "That model is not attached to this work item.");
      if (asset.state === "deleted") throw new HttpError(410, "This model was deleted under the retention policy.");
      if (!["uploaded", "ready", "failed"].includes(asset.state)) throw new HttpError(409, "This model upload never completed.");
      const url = await fileStore.signDownload(asset.blobPath, OPERATOR_DOWNLOAD_TTL_SECONDS);
      return { url, filename: asset.originalName, expiresAt: new Date(now().getTime() + OPERATOR_DOWNLOAD_TTL_SECONDS * 1000).toISOString() };
    },
    async recordRun({ work, run, operator }) {
      const requestId = work?.item?.requestId;
      if (!requestId) throw new HttpError(404, "Work item was not found.");
      if (run.estimateId) {
        const estimate = await repository.findEstimate(run.estimateId);
        if (!estimate || estimate.requestId !== requestId) throw new HttpError(400, "The estimate does not belong to this work item.");
      }
      return repository.recordRun({ ...run, workItemId: work.item.id, recordedBy: operator.id });
    }
  };
}

const optionalNumber = (value, name, max, integer = false) => {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > max || (integer && !Number.isInteger(number))) throw new HttpError(400, `${name} must be a ${integer ? "whole " : ""}number between 0 and ${max}.`);
  return number;
};

export function normalizePrintRun(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "A print run object is required.");
  const allowed = ["estimateId", "printer", "actualGrams", "actualMachineHours", "activeLaborMinutes", "failedAttempts", "completedQuantity", "notes"];
  const extra = Object.keys(input).find(key => !allowed.includes(key));
  if (extra) throw new HttpError(400, `Unexpected field: ${extra}.`);
  const text = (value, max) => value == null || String(value).trim() === "" ? null : String(value).replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max);
  if (input.estimateId != null && !/^pest_[A-Za-z0-9_-]{8,64}$/.test(String(input.estimateId))) throw new HttpError(400, "A valid estimate ID is required.");
  return {
    estimateId: input.estimateId ?? null, printer: text(input.printer, 120),
    actualGrams: optionalNumber(input.actualGrams, "Actual grams", 1_000_000), actualMachineHours: optionalNumber(input.actualMachineHours, "Actual machine hours", 100_000),
    activeLaborMinutes: optionalNumber(input.activeLaborMinutes, "Active labor minutes", 100_000, true), failedAttempts: optionalNumber(input.failedAttempts, "Failed attempts", 1000, true) ?? 0,
    completedQuantity: optionalNumber(input.completedQuantity, "Completed quantity", 100_000, true), notes: text(input.notes, 1000)
  };
}
