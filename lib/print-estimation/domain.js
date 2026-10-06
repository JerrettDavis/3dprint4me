// Print-estimation vocabulary and customer-option normalization. No provider imports.
import { HttpError } from "../http.js";

export const MODEL_FORMATS = Object.freeze(["stl", "3mf", "zip"]);
export const PRINT_MATERIALS = Object.freeze(["pla", "petg", "asa", "tpu", "other"]);
export const PRINT_QUALITIES = Object.freeze(["draft", "standard", "fine"]);
export const PRINT_FINISHES = Object.freeze(["none", "cleanup", "sanded", "painted"]);
export const PRINT_SUPPORTS = Object.freeze(["none", "some", "heavy"]);
export const PRINT_DELIVERIES = Object.freeze(["pickup", "local", "shipping"]);
export const PRINT_SIZE_CLASSES = Object.freeze(["tiny", "palm", "hand", "shoebox", "large"]);
export const ESTIMATOR_TYPES = Object.freeze(["manual", "size", "geometry", "slicer", "catalog"]);
export const JOB_STATES = Object.freeze(["pending", "processing", "ready", "failed"]);

const pick = (value, allowed, fallback) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
};
const wholeNumber = (value, { min, max, fallback }) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
};

/** Server-side revalidation of customer-adjustable print assumptions. */
export function normalizeEstimateOptions(input = {}) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "Print estimate options must be an object.");
  return {
    material: pick(input.material, PRINT_MATERIALS, "pla"),
    quality: pick(input.quality, PRINT_QUALITIES, "standard"),
    colors: wholeNumber(input.colors, { min: 1, max: 4, fallback: 1 }),
    finish: pick(input.finish, PRINT_FINISHES, "none"),
    supports: pick(input.supports, PRINT_SUPPORTS, "none"),
    delivery: pick(input.delivery, PRINT_DELIVERIES, "pickup"),
    quantity: wholeNumber(input.quantity, { min: 1, max: 500, fallback: 1 }),
    sizeClass: pick(input.sizeClass, PRINT_SIZE_CLASSES, "palm")
  };
}

/** Options that change the slicer profile (and therefore a slice result). */
export function sliceProfileKey(options) {
  return [options.material, options.quality, options.supports, options.colors].join(":");
}

export function modelFormatFromName(filename) {
  const extension = String(filename ?? "").split(".").pop()?.toLowerCase();
  return MODEL_FORMATS.includes(extension) ? extension : null;
}
