import { analyzeModelBytes, estimateProductionFromGeometry, modelFormat } from "./geometry.js?v=08470e76b28db57a";
import { ModelAnalysisError } from "./mesh.js?v=08470e76b28db57a";

/** Browser inflate through DecompressionStream, cancelled as soon as output exceeds maxOutput. */
export async function browserInflateRaw(data, maxOutput) {
  if (typeof DecompressionStream !== "function") throw new ModelAnalysisError("zip_unsupported", "This browser cannot expand 3MF archives.");
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxOutput) { await reader.cancel().catch(() => {}); throw new ModelAnalysisError("zip_limit", "An archive entry expands beyond its declared size."); }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

const MODEL_PANEL_FAILURES = Object.freeze({
  too_large: "This file is larger than the automatic analysis limit.",
  too_many_triangles: "This model is too detailed to measure in the browser.",
  unsupported_format: "Only STL and 3MF files can be measured automatically."
});

/**
 * Owns the selected print model: bounded local analysis, then (when available)
 * private upload and server verification. It never publishes the file.
 */
export function createModelEstimateController({ limits, render, onChange = () => {}, privateEstimates = null, analyze = analyzeModelBytes, inflateRaw = browserInflateRaw }) {
  const state = { file: null, status: "idle", metrics: null, message: null, privateState: "none", slice: null, asset: null, session: null };
  let generation = 0;
  const changed = () => { render(publicState()); onChange(publicState()); };
  function publicState() {
    return { file: state.file ? { name: state.file.name, size: state.file.size } : null, status: state.status, metrics: state.metrics, message: state.message, privateState: state.privateState, slice: state.slice };
  }

  async function select(file) {
    if (file === state.file) return;
    const current = ++generation;
    Object.assign(state, { file, status: file ? "reading" : "idle", metrics: null, message: null, privateState: "none", slice: null, asset: null });
    privateEstimates?.reset?.();
    changed();
    if (!file) return;
    try {
      if (!modelFormat(file.name)) throw new ModelAnalysisError("unsupported_format");
      if (file.size > limits.maxModelBytes) throw new ModelAnalysisError("too_large");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const metrics = await analyze({ name: file.name, bytes, limits, inflateRaw });
      if (current !== generation) return;
      Object.assign(state, { status: "analyzed", metrics });
      changed();
      if (privateEstimates) await privateEstimates.start(file, { isCurrent: () => current === generation, update: patch => { if (current === generation) { Object.assign(state, patch); changed(); } } });
    } catch (error) {
      if (current !== generation) return;
      const code = error?.name === "ModelAnalysisError" ? error.code : "internal";
      Object.assign(state, { status: "failed", metrics: null, message: MODEL_PANEL_FAILURES[code] ?? "This file could not be measured automatically." });
      changed();
    }
  }

  return {
    select,
    /** Picks the first STL/3MF from the request's file list as the print model. */
    sync(files) {
      const candidate = files.find(file => modelFormat(file.name)) ?? null;
      if (candidate !== state.file) select(candidate);
    },
    modelEstimate(options) {
      if (state.slice?.status === "ready" && state.slice.production) return { grams: state.slice.production.estimatedGramsPerUnit, hours: state.slice.production.estimatedHoursPerUnit, source: "slicer" };
      if (state.status !== "analyzed" || !state.metrics) return null;
      const production = estimateProductionFromGeometry(state.metrics, options);
      return { grams: production.gramsPerUnit, hours: production.hoursPerUnit, source: "geometry" };
    },
    state: publicState
  };
}
