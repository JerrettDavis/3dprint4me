// Anonymous, capability-owned print estimate sessions: private direct upload,
// server-side verification and geometry analysis, and immutable estimate snapshots.
import { randomBytes } from "node:crypto";

import { HttpError } from "../../http.js";
import { sanitizeFilename } from "../../validation.js";
import {
  capabilityMatches, hashCapability, newAssetId, newCapabilityToken, newSessionId,
  validateAssetId, validateCapabilityToken, validateSessionId
} from "../capability.js";
import { composePrintEstimate, presentPublicEstimate } from "../compose-estimate.js";
import { modelFormatFromName, normalizeEstimateOptions, sliceProfileKey } from "../domain.js";
import { analyzeModelOnServer, estimateProductionFromGeometry, GEOMETRY_ANALYZER, publicAnalysisFailure, serverModelLimits } from "../geometry/analyze-model.js";

export const DEFAULT_SESSION_POLICY = Object.freeze({ sessionTtlHours: 24, maxAssetsPerSession: 3, maxEstimatesPerSession: 20 });

export function sessionPolicyFromEnv(env = process.env) {
  const bounded = (name, fallback, max) => {
    const value = Number(env[name]);
    return Number.isInteger(value) && value > 0 && value <= max ? value : fallback;
  };
  return {
    sessionTtlHours: bounded("PRINT_ESTIMATE_SESSION_TTL_HOURS", DEFAULT_SESSION_POLICY.sessionTtlHours, 168),
    maxAssetsPerSession: bounded("PRINT_ESTIMATE_MAX_ASSETS", DEFAULT_SESSION_POLICY.maxAssetsPerSession, 10),
    maxEstimatesPerSession: bounded("PRINT_ESTIMATE_MAX_ESTIMATES", DEFAULT_SESSION_POLICY.maxEstimatesPerSession, 100)
  };
}

/** Public-safe model facts. Never includes the private Blob path or hash. */
export function modelSummary(asset) {
  const metrics = asset?.geometryMetrics;
  if (!metrics) return asset ? { format: asset.format, filename: asset.originalName } : null;
  return { format: metrics.format, filename: asset.originalName, dimensionsMm: metrics.dimensionsMm, volumeCm3: Math.round(metrics.volumeMm3 / 100) / 10, triangleCount: metrics.triangleCount, warnings: metrics.warnings ?? [] };
}

/** Converts a composed estimate into a persistable immutable snapshot row. */
export function estimateRow({ estimate, publicView, session, asset, purpose, engine, engineVersion, profileId, geometry = {}, slicer = {} }) {
  return {
    sessionId: session?.id ?? asset?.sessionId ?? null, assetId: asset?.id ?? null, requestId: asset?.requestId ?? session?.requestId ?? null, purpose,
    estimatorType: estimate.estimatorType, confidence: estimate.confidence, engine, engineVersion, profileId,
    pricingModelVersion: estimate.pricingModelVersion, rateCardVersion: estimate.rateCardVersion,
    input: estimate.input, geometry, slicer, cost: estimate.cost,
    pricing: { ...estimate.pricing, model: estimate.model }, public: publicView,
    priceLowCents: estimate.pricing.cents.low, priceHighCents: estimate.pricing.cents.high, targetPriceCents: estimate.pricing.cents.target
  };
}

/** Public projection of the asset's slice job and, when ready, its narrower estimate. */
export async function sliceStatus({ repository, asset, options, slicerEnabled }) {
  if (!asset) return { status: "unavailable" };
  const jobs = await repository.listAssetJobs(asset.id);
  const job = jobs.find(candidate => candidate.jobType === "slice" && candidate.profileKey === sliceProfileKey(options)) ?? null;
  if (!job) return { status: slicerEnabled ? "not_requested" : "unavailable" };
  if (job.state === "ready" && job.resultEstimateId) {
    const estimate = await repository.findEstimate(job.resultEstimateId);
    return { status: "ready", production: estimate?.public?.production ?? null, price: estimate?.public?.price ?? null, confidence: estimate?.confidence ?? null };
  }
  return { status: job.state === "processing" ? "pending" : job.state };
}

export function createEstimateSessionUseCases({
  repository, fileStore, materialCosts, slicerEnabled = false, policy = DEFAULT_SESSION_POLICY, limits = serverModelLimits(),
  now = () => new Date(), random = randomBytes, analyze = analyzeModelOnServer, logFailure = () => {}
}) {
  const requireStorage = () => {
    if (!repository || !fileStore) throw new HttpError(503, "Private model estimates are not configured.");
  };
  async function ownedSession(sessionId, token) {
    requireStorage();
    const id = validateSessionId(sessionId);
    const capability = validateCapabilityToken(token);
    const session = await repository.findSession(id);
    if (!session || !capabilityMatches(capability, session.ownershipHash)) throw new HttpError(404, "This estimate session is not available.");
    if (session.state !== "open" || new Date(session.expiresAt) <= now()) throw new HttpError(410, "This estimate session has expired. Choose the file again to restart.");
    return session;
  }
  async function ownedAsset(session, assetId) {
    const asset = await repository.findAsset(validateAssetId(assetId));
    if (!asset || asset.sessionId !== session.id) throw new HttpError(404, "That model upload is not part of this estimate.");
    return asset;
  }

  async function verifyUpload(asset) {
    if (asset.state !== "pending_upload") return asset;
    const object = await fileStore.inspect(asset.blobPath).catch(() => null);
    if (!object) throw new HttpError(409, "The model upload has not finished yet.");
    if (!(object.size > 0) || object.size > asset.declaredSizeBytes || object.size > limits.maxModelBytes) {
      await fileStore.delete(asset.blobPath).catch(() => {});
      throw new HttpError(400, "The uploaded model does not match its authorized size.");
    }
    return repository.markAssetUploaded(asset.id, object.size);
  }

  async function analyzeAsset(asset) {
    if (asset.state === "ready" && asset.geometryMetrics) return asset;
    if (asset.state === "failed") return asset;
    try {
      const bytes = await fileStore.read(asset.blobPath, limits.maxModelBytes);
      const { metrics, sha256 } = await analyze({ name: asset.originalName, bytes, limits });
      return repository.markAssetAnalyzed(asset.id, { sha256, metrics });
    } catch (error) {
      const failure = publicAnalysisFailure(error);
      logFailure(failure.code);
      return repository.markAssetFailed(asset.id, { code: failure.code, detail: error?.name === "ModelAnalysisError" ? error.message : "Unexpected analysis failure." });
    }
  }

  async function estimateFor({ session, asset, options, purpose }) {
    const usage = await repository.sessionUsage(session.id);
    if (usage.estimates >= policy.maxEstimatesPerSession) throw new HttpError(429, "This estimate session has reached its limit. Submit the request or start again.");
    const production = estimateProductionFromGeometry(asset.geometryMetrics, options);
    const estimate = composePrintEstimate({ options, production, materialCost: await materialCosts.materialCost(options.material), now: now() });
    let slice = await sliceStatus({ repository, asset, options, slicerEnabled });
    if (slicerEnabled && ["not_requested", "failed", "cancelled"].includes(slice.status)) {
      await repository.enqueueJob({ assetId: asset.id, jobType: "slice", profileKey: sliceProfileKey(options), options });
      slice = { status: "pending" };
    }
    const summary = modelSummary(asset);
    const publicView = presentPublicEstimate({ status: "ready", estimate, modelSummary: summary, slice });
    await repository.insertEstimate(estimateRow({ estimate, publicView, session, asset, purpose, engine: GEOMETRY_ANALYZER.engine, engineVersion: GEOMETRY_ANALYZER.version, profileId: `geometry:${sliceProfileKey(options)}`, geometry: asset.geometryMetrics }));
    return publicView;
  }

  return {
    async create(body = {}) {
      requireStorage();
      const options = normalizeEstimateOptions(body.options ?? {});
      const token = newCapabilityToken(random);
      const expiresAt = new Date(now().getTime() + policy.sessionTtlHours * 3_600_000).toISOString();
      const session = await repository.createSession({ id: newSessionId(random), ownershipHash: hashCapability(token), assumptions: options, expiresAt });
      return { sessionId: session.id, token, expiresAt };
    },

    async authorizeUpload(body = {}) {
      const session = await ownedSession(body.sessionId, body.token);
      const filename = sanitizeFilename(body.filename);
      const format = modelFormatFromName(filename);
      if (!format) throw new HttpError(400, "Only STL and 3MF files can be estimated.");
      const size = Number(body.size);
      if (!Number.isInteger(size) || size <= 0 || size > limits.maxModelBytes) throw new HttpError(400, `Model files must be between 1 byte and ${Math.floor(limits.maxModelBytes / 1024 / 1024)} MB.`);
      const usage = await repository.sessionUsage(session.id);
      if (usage.assets >= policy.maxAssetsPerSession) throw new HttpError(429, "This estimate session already has the maximum number of models.");
      const contentType = typeof body.contentType === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(body.contentType) && body.contentType.length <= 160 ? body.contentType : null;
      const asset = await repository.createAsset({
        id: newAssetId(random), sessionId: session.id, blobPath: `print-estimates/${session.id}/${random(5).toString("hex")}-${filename}`,
        originalName: filename, format, contentType, declaredSizeBytes: size, retentionExpiresAt: session.expiresAt
      });
      const signed = await fileStore.authorizeUpload(asset.blobPath, size, contentType ?? undefined);
      return { assetId: asset.id, method: signed.method ?? "PUT", uploadUrl: signed.uploadUrl, headers: signed.headers ?? {}, bodyType: signed.bodyType ?? "file", expiresAt: session.expiresAt };
    },

    async analyze(body = {}, { purpose = "preview" } = {}) {
      const session = await ownedSession(body.sessionId, body.token);
      const options = normalizeEstimateOptions(body.options ?? session.assumptions ?? {});
      let asset = await verifyUpload(await ownedAsset(session, body.assetId));
      asset = await analyzeAsset(asset);
      if (asset.state !== "ready") {
        const failure = publicAnalysisFailure({ name: "ModelAnalysisError", code: asset.analysisErrorCode });
        return { status: "failed", reason: failure.reason, model: modelSummary(asset), slice: { status: "unavailable" } };
      }
      return estimateFor({ session, asset, options, purpose });
    },

    async status(query = {}) {
      const session = await ownedSession(query.sessionId, query.token);
      const [latest] = await repository.listSessionEstimates(session.id, 1);
      if (!latest) return { status: "pending", slice: { status: "unavailable" } };
      const asset = latest.assetId ? await repository.findAsset(latest.assetId) : null;
      return { ...latest.public, slice: await sliceStatus({ repository, asset, options: latest.input.options, slicerEnabled }) };
    }
  };
}
