import { inspectArchive } from "./archive.js?v=4eed843a69c17184";
import { estimateProductionFromGeometry } from "./geometry.js?v=4eed843a69c17184";

/**
 * Local (non-binding) read of a ZIP model pack for the picker and a planning range.
 * `analyze({ name, bytes })` measures one model; a part that cannot be measured stays listed
 * (not selectable) and never sinks the pack. A refused archive rejects with its ModelAnalysisError.
 */
export async function readPackLocally({ bytes, limits, inflateRaw, analyze }) {
  const { models, ignored } = await inspectArchive({ bytes, limits, inflateRaw });
  const parts = [];
  for (const model of models) {
    const id = `part-${model.index}`;
    try {
      parts.push({ id, name: model.name, format: model.format, metrics: await analyze({ name: model.name, bytes: model.bytes }), error: null });
    } catch (error) {
      parts.push({ id, name: model.name, format: model.format, metrics: null, error: error?.name === "ModelAnalysisError" ? error.code : "internal" });
    }
  }
  return { parts, ignored };
}

/** Same rollup as the server: sum selected, measured parts x part quantity x order quantity. */
export function packProduction(parts, selection, options) {
  const units = Math.max(1, Math.round(Number(options.quantity) || 1));
  let totalGrams = 0; let totalHours = 0; let count = 0;
  for (const part of parts) {
    const choice = selection[part.id];
    if (!choice?.selected || !part.metrics) continue;
    const production = estimateProductionFromGeometry(part.metrics, { ...options, quantity: choice.quantity * units });
    totalGrams += production.totalGrams; totalHours += production.totalHours; count += 1;
  }
  if (!count) return null;
  return { gramsPerUnit: Math.round((totalGrams / units) * 100) / 100, hoursPerUnit: Math.round((totalHours / units) * 100) / 100 };
}
