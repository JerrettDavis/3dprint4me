import { inspectArchive } from "./archive.js?v=f612341d745785cd";
import { estimateProductionFromGeometry } from "./geometry.js?v=f612341d745785cd";

/** Same rule as the server's entryLabel: strip control, DEL, C1 and bidi characters, cap at 255. */
export const entryLabel = name => String(name).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "").slice(0, 255);

/**
 * Local (non-binding) read of a ZIP model pack for the picker and a planning range.
 * `analyze({ name, bytes })` measures one model; a part that cannot be measured stays listed
 * (not selectable) and never sinks the pack. A refused archive rejects with its ModelAnalysisError.
 * Names are labelled exactly as the server stores them, so they map to server part ids.
 */
export async function readPackLocally({ bytes, limits, inflateRaw, analyze }) {
  const { models, ignored } = await inspectArchive({ bytes, limits, inflateRaw });
  const parts = [];
  for (const model of models) {
    const id = `part-${model.index}`;
    const name = entryLabel(model.name);
    try {
      parts.push({ id, name, format: model.format, metrics: await analyze({ name: model.name, bytes: model.bytes }), error: null });
    } catch (error) {
      parts.push({ id, name, format: model.format, metrics: null, error: error?.name === "ModelAnalysisError" ? error.code : "internal" });
    }
  }
  return { parts, ignored: ignored.map(entry => ({ ...entry, name: entryLabel(entry.name) })) };
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
