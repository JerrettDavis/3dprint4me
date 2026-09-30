// Transport-independent slicer port. Every provider (local CLI, HTTP worker, or a
// future hosted runner) implements:
//
//   estimateSlice({ bytes, filename, options, timeoutMs }) -> SliceResult
//
// SliceResult = { engine, engineVersion, profileId, elapsedSeconds, materialGrams,
//                 materialMm, purgeGrams, supportGrams, toolChanges, layerCount, warnings }
//
// Providers throw SliceError with a bounded category; raw output stays private.

export const SLICE_ERROR_CATEGORIES = Object.freeze(["unavailable", "timeout", "slicer_failed", "invalid_output", "asset_missing", "unsupported"]);
const PERMANENT = new Set(["asset_missing", "unsupported"]);

export class SliceError extends Error {
  constructor(category, detail = category) {
    super(String(detail).slice(0, 500));
    this.name = "SliceError";
    this.category = SLICE_ERROR_CATEGORIES.includes(category) ? category : "slicer_failed";
  }
}

export const isPermanentSliceFailure = category => PERMANENT.has(category);

const optionalNumber = (value, max) => {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= max ? number : null;
};
const text = (value, fallback, max = 80) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback);

/** Validates provider output before it can price anything. */
export function normalizeSliceResult(result) {
  const elapsedSeconds = optionalNumber(result?.elapsedSeconds, 60 * 60 * 24 * 30);
  const materialGrams = optionalNumber(result?.materialGrams, 1_000_000);
  if (!(elapsedSeconds > 0) || !(materialGrams > 0)) throw new SliceError("invalid_output", "Slicer output is missing time or material.");
  return {
    engine: text(result.engine, "unknown-slicer"),
    engineVersion: text(result.engineVersion, "unknown"),
    profileId: text(result.profileId, "unspecified", 160),
    elapsedSeconds,
    materialGrams,
    materialMm: optionalNumber(result.materialMm, 1e9),
    purgeGrams: optionalNumber(result.purgeGrams, 1_000_000),
    supportGrams: optionalNumber(result.supportGrams, 1_000_000),
    toolChanges: optionalNumber(result.toolChanges, 1_000_000),
    layerCount: optionalNumber(result.layerCount, 10_000_000),
    warnings: Array.isArray(result.warnings) ? result.warnings.slice(0, 20).map(value => String(value).slice(0, 200)) : []
  };
}
