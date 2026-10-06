import { analyzeModelBytes, estimateProductionFromGeometry, modelFormat } from "./geometry.js?v=2e863ac1ee29a6f9";
import { ModelAnalysisError } from "./mesh.js?v=2e863ac1ee29a6f9";
import { isArchiveName } from "./archive.js?v=2e863ac1ee29a6f9";
import { packProduction, readPackLocally } from "./pack.js?v=2e863ac1ee29a6f9";

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
  too_many_parts: "This pack has too many parts to measure automatically; attach fewer or contact us.",
  no_models: "This ZIP has no STL or 3MF files to measure; attach STL or 3MF files.",
  unsupported_format: "Only STL, 3MF and ZIP model packs can be measured automatically."
});

/**
 * Owns the selected print model: bounded local analysis, then (when available)
 * private upload and server verification. It never publishes the file.
 */
export function createModelEstimateController({ limits, render, onChange = () => {}, privateEstimates = null, analyze = analyzeModelBytes, inflateRaw = browserInflateRaw }) {
  const state = { file: null, status: "idle", metrics: null, message: null, privateState: "none", slice: null, asset: null, session: null, pack: null };
  let generation = 0;
  const changed = () => { render(publicState()); onChange(publicState()); };
  function publicState() {
    return { file: state.file ? { name: state.file.name, size: state.file.size } : null, status: state.status, metrics: state.metrics, message: state.message, privateState: state.privateState, slice: state.slice,
      pack: state.pack ? {
        parts: state.pack.parts.map(({ id, name, format, metrics, error }) => ({ id, name, format, error, dimensionsMm: metrics?.dimensionsMm ?? null, volumeMm3: metrics?.volumeMm3 ?? null })),
        ignored: state.pack.ignored,
        selection: state.pack.selection,
        hint: state.pack.hint
      } : null };
  }

  const privateHooks = current => ({ isCurrent: () => current === generation, update: patch => { if (current === generation) { Object.assign(state, patch); changed(); } } });
  const selectionPayload = () => state.pack.parts.filter(part => state.pack.selection[part.id]?.selected).map(part => ({ localId: part.id, name: part.name, quantity: state.pack.selection[part.id].quantity }));
  /** A changed selection drops any slicer result for the old one and re-prices privately. */
  function selectionChanged() {
    state.pack.hint = null;
    state.slice = null;
    changed();
    privateEstimates?.estimatePack?.(selectionPayload(), privateHooks(generation));
  }

  async function select(file) {
    if (file === state.file) return;
    const current = ++generation;
    Object.assign(state, { file, status: file ? "reading" : "idle", metrics: null, message: null, privateState: "none", slice: null, asset: null, pack: null });
    privateEstimates?.reset?.();
    changed();
    if (!file) return;
    try {
      if (!modelFormat(file.name) && !isArchiveName(file.name)) throw new ModelAnalysisError("unsupported_format");
      if (file.size > limits.maxModelBytes) throw new ModelAnalysisError("too_large");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (isArchiveName(file.name)) {
        const local = await readPackLocally({ bytes, limits, inflateRaw, analyze: ({ name, bytes: partBytes }) => analyze({ name, bytes: partBytes, limits, inflateRaw }) });
        if (current !== generation) return;
        const selection = Object.fromEntries(local.parts.map(part => [part.id, { selected: Boolean(part.metrics), quantity: 1 }]));
        Object.assign(state, { status: "analyzed", metrics: null, pack: { ...local, selection, hint: null } });
        changed();
        if (privateEstimates) await privateEstimates.start(file, { ...privateHooks(current), pack: () => state.pack });
        return;
      }
      const metrics = await analyze({ name: file.name, bytes, limits, inflateRaw });
      if (current !== generation) return;
      Object.assign(state, { status: "analyzed", metrics });
      changed();
      if (privateEstimates) await privateEstimates.start(file, privateHooks(current));
    } catch (error) {
      if (current !== generation) return;
      const code = error?.name === "ModelAnalysisError" ? error.code : "internal";
      Object.assign(state, { status: "failed", metrics: null, message: MODEL_PANEL_FAILURES[code] ?? "This file could not be measured automatically." });
      changed();
    }
  }

  return {
    select,
    /** Picks the first STL/3MF/ZIP from the request's file list as the print model. */
    sync(files) {
      const candidate = files.find(file => modelFormat(file.name) || isArchiveName(file.name)) ?? null;
      if (candidate !== state.file) select(candidate);
    },
    setPartSelected(id, selected) {
      const choice = state.pack?.selection[id];
      if (!choice || !state.pack.parts.find(part => part.id === id)?.metrics) return;
      // A pack order always has at least one part: refuse to clear the last one and say why.
      if (!selected && choice.selected && !state.pack.parts.some(part => part.id !== id && part.metrics && state.pack.selection[part.id]?.selected)) {
        state.pack.hint = "Keep at least one part selected.";
        changed();
        return;
      }
      choice.selected = Boolean(selected);
      selectionChanged();
    },
    setPartQuantity(id, quantity) {
      const choice = state.pack?.selection[id];
      if (!choice) return;
      choice.quantity = Math.min(99, Math.max(1, Math.round(Number(quantity)) || 1));
      selectionChanged();
      return choice.quantity;
    },
    modelEstimate(options) {
      if (state.pack) {
        if (state.slice?.status === "ready" && state.slice.production) return { grams: state.slice.production.estimatedGramsPerUnit, hours: state.slice.production.estimatedHoursPerUnit, source: "slicer" };
        const production = packProduction(state.pack.parts, state.pack.selection, options);
        return production ? { grams: production.gramsPerUnit, hours: production.hoursPerUnit, source: "geometry" } : null;
      }
      if (state.slice?.status === "ready" && state.slice.production) return { grams: state.slice.production.estimatedGramsPerUnit, hours: state.slice.production.estimatedHoursPerUnit, source: "slicer" };
      if (state.status !== "analyzed" || !state.metrics) return null;
      const production = estimateProductionFromGeometry(state.metrics, options);
      return { grams: production.gramsPerUnit, hours: production.hoursPerUnit, source: "geometry" };
    },
    state: publicState
  };
}
