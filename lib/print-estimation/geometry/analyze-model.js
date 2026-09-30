// Server-side geometry analysis. The browser runs the same module for instant
// feedback, but only this server result is persisted as authoritative.
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

import { analyzeModelBytes, estimateProductionFromGeometry, GEOMETRY_ANALYZER, modelFormat } from "../../../public/assets/js/print-estimation/geometry.js";
import { MODEL_ANALYSIS_LIMITS, ModelAnalysisError, resolveModelLimits } from "../../../public/assets/js/print-estimation/mesh.js";

export { estimateProductionFromGeometry, GEOMETRY_ANALYZER, MODEL_ANALYSIS_LIMITS, ModelAnalysisError, modelFormat };

/** Node inflate that refuses to allocate beyond the declared entry size. */
export async function nodeInflateRaw(data, maxOutput) {
  try {
    return new Uint8Array(inflateRawSync(data, { maxOutputLength: Math.max(1, maxOutput) }));
  } catch {
    throw new ModelAnalysisError("zip_limit", "An archive entry exceeded its bounded expansion size.");
  }
}

const ENV_LIMITS = {
  maxModelBytes: "PRINT_ESTIMATE_MAX_BYTES",
  maxTriangles: "PRINT_ESTIMATE_MAX_TRIANGLES",
  maxZipEntries: "PRINT_ESTIMATE_MAX_3MF_ENTRIES",
  maxZipUncompressedBytes: "PRINT_ESTIMATE_MAX_3MF_UNCOMPRESSED_BYTES"
};

/** Server limits: defaults, optionally lowered or raised by explicit environment configuration. */
export function serverModelLimits(env = process.env) {
  const overrides = {};
  for (const [key, name] of Object.entries(ENV_LIMITS)) if (env[name]) overrides[key] = Number(env[name]);
  return resolveModelLimits(overrides);
}

export async function analyzeModelOnServer({ name, bytes, limits = serverModelLimits() }) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const metrics = await analyzeModelBytes({ name, bytes: input, limits, inflateRaw: nodeInflateRaw });
  return { metrics, sha256: createHash("sha256").update(input).digest("hex") };
}

/** Public-safe error category; diagnostic detail stays in private storage and logs. */
export function publicAnalysisFailure(error) {
  const code = error?.name === "ModelAnalysisError" && typeof error.code === "string" ? error.code : "internal";
  return { code, reason: code === "too_large" ? "file_too_large" : code === "unsupported_format" ? "unsupported_format" : "analysis_unavailable" };
}
