import { ModelAnalysisError, resolveModelLimits } from "./mesh.js?v=0113086731b32eb7";
import { parseStl } from "./stl.js?v=0113086731b32eb7";
import { parseThreeMf } from "./three-mf.js?v=0113086731b32eb7";

export const GEOMETRY_ANALYZER = Object.freeze({ engine: "3dprint4me-geometry", version: "1.0.0" });

// Planning heuristics for turning geometry into rough grams and machine time.
// They are intentionally simple and are labelled as "not a slice" everywhere.
export const GEOMETRY_PRODUCTION_PROFILE = Object.freeze({
  densityGPerCm3: Object.freeze({ pla: 1.24, petg: 1.27, asa: 1.07, tpu: 1.21, other: 1.2 }),
  wallMm: 1.2,
  infill: 0.15,
  supportFactor: Object.freeze({ none: 0, some: 0.12, heavy: 0.3 }),
  gramsPerHour: Object.freeze({ draft: 22, standard: 15, fine: 9 }),
  extraColorGramsFactor: 0.2,
  extraColorTimeFactor: 0.35,
  plateSetupHours: 0.1,
  bedMm: Object.freeze([256, 256, 256]),
  bedFill: 0.7,
  partSpacingMm: 6
});

export const MODEL_WARNING_MESSAGES = Object.freeze({
  degenerate_triangles: "Some triangles have no area; the mesh may need repair.",
  near_zero_volume: "The model encloses almost no volume; it may be a surface or have open edges.",
  inverted_normals: "The model appears inside-out; the operator will check its orientation.",
  exceeds_build_volume: "The model is larger than a typical build plate and may need splitting or scaling.",
  tiny_model: "The model is very small; confirm its units (STL has no unit information).",
  units_assumed: "STL files have no units; millimetres are assumed.",
  embedded_settings_ignored: "Geometry analyzed; embedded slicer settings are not trusted or used.",
  no_build_items: "The 3MF has no build plate items; every model object was measured."
});

export function modelFormat(name) {
  const extension = String(name ?? "").split(".").pop()?.toLowerCase();
  return extension === "stl" || extension === "3mf" ? extension : null;
}

export function geometryWarnings(metrics, profile = GEOMETRY_PRODUCTION_PROFILE) {
  const warnings = [];
  if (metrics.degenerateTriangles > Math.max(3, metrics.triangleCount * 0.001)) warnings.push("degenerate_triangles");
  const boxVolume = metrics.dimensionsMm.reduce((product, value) => product * value, 1);
  if (metrics.volumeMm3 < 1 || (boxVolume > 0 && metrics.volumeMm3 / boxVolume < 0.001)) warnings.push("near_zero_volume");
  if (metrics.signedVolumeMm3 < 0 && Math.abs(metrics.signedVolumeMm3) > metrics.volumeMm3 * 0.5) warnings.push("inverted_normals");
  const sorted = [...metrics.dimensionsMm].sort((a, b) => b - a);
  const bed = [...profile.bedMm].sort((a, b) => b - a);
  if (sorted.some((value, index) => value > bed[index])) warnings.push("exceeds_build_volume");
  if (sorted[0] < 3) warnings.push("tiny_model");
  if (metrics.unitAssumed) warnings.push("units_assumed");
  if (metrics.embeddedSlicerSettings) warnings.push("embedded_settings_ignored");
  if (metrics.noBuildItems) warnings.push("no_build_items");
  return warnings;
}

/** Bounded analysis of untrusted STL/3MF bytes. `inflateRaw(bytes, maxOutput)` must enforce maxOutput. */
export async function analyzeModelBytes({ name, bytes, limits: overrides, inflateRaw }) {
  const limits = resolveModelLimits(overrides);
  const format = modelFormat(name);
  if (!format) throw new ModelAnalysisError("unsupported_format", "Only STL and 3MF files can be analyzed.");
  if (!(bytes instanceof Uint8Array)) throw new ModelAnalysisError("malformed", "Model input must be bytes.");
  if (bytes.length > limits.maxModelBytes) throw new ModelAnalysisError("too_large", "The model exceeds the size limit.");
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (format === "3mf" && !isZip) throw new ModelAnalysisError("malformed", "The 3MF file is not a ZIP container.");
  if (format === "stl" && isZip) throw new ModelAnalysisError("malformed", "The STL file is an archive, not a mesh.");
  const metrics = format === "stl" ? parseStl(bytes, limits) : await parseThreeMf(bytes, limits, inflateRaw);
  return { ...metrics, byteLength: bytes.length, analyzer: { ...GEOMETRY_ANALYZER }, warnings: geometryWarnings(metrics) };
}

/** Rough per-unit grams/time from geometry. This is a planning heuristic, not a slice. */
export function estimateProductionFromGeometry(metrics, options = {}, profile = GEOMETRY_PRODUCTION_PROFILE) {
  const quantity = Math.max(1, Math.round(Number(options.quantity) || 1));
  const colors = Math.min(4, Math.max(1, Math.round(Number(options.colors) || 1)));
  const volumeCm3 = Math.max(0, metrics.volumeMm3) / 1000;
  const shellCm3 = Math.min(volumeCm3, (Math.max(0, metrics.surfaceAreaMm2) * profile.wallMm) / 1000);
  const printedCm3 = shellCm3 + (volumeCm3 - shellCm3) * profile.infill;
  const density = profile.densityGPerCm3[options.material] ?? profile.densityGPerCm3.other;
  const support = profile.supportFactor[options.supports] ?? 0;
  const baseGrams = printedCm3 * density * (1 + support);
  const gramsPerUnit = Math.max(1, baseGrams * (1 + profile.extraColorGramsFactor * (colors - 1)));
  const rate = profile.gramsPerHour[options.quality] ?? profile.gramsPerHour.standard;
  const hoursPerUnit = Math.max(0.25, (baseGrams / rate) * (1 + profile.extraColorTimeFactor * (colors - 1)));
  const [x, y] = metrics.dimensionsMm;
  const footprint = (x + profile.partSpacingMm) * (y + profile.partSpacingMm);
  const fits = footprint > 0 ? Math.floor((profile.bedMm[0] * profile.bedMm[1] * profile.bedFill) / footprint) : 1;
  const unitsPerPlate = Math.max(1, Math.min(quantity, fits));
  const plates = Math.ceil(quantity / unitsPerPlate);
  const round = value => Math.round(value * 100) / 100;
  return {
    source: "geometry",
    gramsPerUnit: round(gramsPerUnit),
    hoursPerUnit: round(hoursPerUnit),
    unitsPerPlate,
    plates,
    totalGrams: round(gramsPerUnit * quantity),
    totalHours: round(hoursPerUnit * quantity + profile.plateSetupHours * plates)
  };
}
