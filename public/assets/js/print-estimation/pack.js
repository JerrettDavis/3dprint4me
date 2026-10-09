import { entryLabel, inspectArchive, uniqueEntryLabels } from "./archive.js?v=009c94a45ec792c5";
import { estimateProductionFromGeometry } from "./geometry.js?v=009c94a45ec792c5";

// The label rules (entryLabel, uniqueEntryLabels) live in archive.js, which the server imports too.

/**
 * Local (non-binding) read of a ZIP model pack for the picker and a planning range.
 * `analyze({ name, bytes })` measures one model; a part that cannot be measured stays listed
 * (not selectable) and never sinks the pack. A refused archive rejects with its ModelAnalysisError.
 * Names are labelled exactly as the server stores them, so they map to server part ids.
 */
export async function readPackLocally({ bytes, limits, inflateRaw, analyze }) {
  const { models, ignored } = await inspectArchive({ bytes, limits, inflateRaw });
  const parts = [];
  const labels = uniqueEntryLabels(models.map(model => model.name));
  for (const [position, model] of models.entries()) {
    const id = `part-${model.index}`;
    const name = labels[position];
    try {
      parts.push({ id, name, format: model.format, metrics: await analyze({ name: model.name, bytes: model.bytes }), error: null });
    } catch (error) {
      parts.push({ id, name, format: model.format, metrics: null, error: error?.name === "ModelAnalysisError" ? error.code : "internal" });
    }
  }
  return { parts, ignored: ignored.map(entry => ({ ...entry, name: entryLabel(entry.name) })) };
}

const REQUEST_TEXT_LIMIT = 500; // lib/validation.js keeps at most 500 characters per specification value
const MORE_RESERVE = "; (+99 more)".length;
const shortLabel = name => { const label = entryLabel(name); return label.length > 120 ? `${label.slice(0, 119)}…` : label; };

/** Joins items into at most REQUEST_TEXT_LIMIT characters; anything left over becomes "(+N more)". */
function boundedList(prefix, items) {
  let text = prefix;
  for (const [index, item] of items.entries()) {
    const separator = index ? "; " : "";
    const last = index === items.length - 1;
    if (text.length + separator.length + item.length + (last ? 0 : MORE_RESERVE) > REQUEST_TEXT_LIMIT) return `${text}${separator}(+${items.length - index} more)`;
    text += separator + item;
  }
  return text;
}

/**
 * Plain-text pack selection for the request specifications, so the operator sees what the
 * customer chose on every path (no integrations, refused or failed private estimate, exhausted
 * estimate cap). Values are bounded to what server validation keeps, never silently cut.
 */
export function packRequestSpecifications(pack) {
  if (!pack?.parts?.length) return {};
  const selected = pack.parts.filter(part => !part.error && pack.selection?.[part.id]?.selected);
  const specs = {
    packParts: selected.length
      ? boundedList(`${selected.length} of ${pack.parts.length} parts: `, selected.map(part => `${shortLabel(part.name)} ×${pack.selection[part.id].quantity}`))
      : `0 of ${pack.parts.length} parts selected; none could be measured, a person will review the ZIP.`
  };
  if (pack.ignored?.length) specs.packIgnored = boundedList("", pack.ignored.map(entry => shortLabel(entry.name)));
  return specs;
}

/**
 * Local planning rollup: sums selected, measured parts x part quantity x order quantity. It is not
 * the server's stored pack price: the server also counts one plate per selected part in labor (plate
 * packing is not modeled), so the confirmed price is usually higher than this range.
 */
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
