import { HttpError } from "../../http.js";
import { composePrintEstimate, presentPublicEstimate } from "../compose-estimate.js";
import { sliceProfileKey } from "../domain.js";
import { estimateProductionFromGeometry, GEOMETRY_ANALYZER } from "../geometry/analyze-model.js";
import { validateAssetId } from "../capability.js";
import { estimateRow, sliceStatus } from "./estimate-session.js";
import { presentPack } from "./pack.js";

const round2 = value => Math.round(value * 100) / 100;

/**
 * One job: parts are summed, then the pricing policy runs once on the totals. A part with a
 * slicer result contributes per-unit figures x its total quantity; otherwise geometry is used.
 * The pack is "slicer" only when every selected part was sliced.
 */
export function rollUpPackProduction({ parts, options }) {
  let totalGrams = 0; let totalHours = 0; let plates = 0;
  for (const { asset, quantity, slicerProduction } of parts) {
    const total = quantity * options.quantity;
    const layout = estimateProductionFromGeometry(asset.geometryMetrics, { ...options, quantity: total });
    if (slicerProduction) {
      totalGrams += slicerProduction.gramsPerUnit * total;
      totalHours += slicerProduction.hoursPerUnit * total;
    } else {
      totalGrams += layout.totalGrams;
      totalHours += layout.totalHours;
    }
    plates += layout.plates;
  }
  return {
    source: parts.every(part => part.slicerProduction) ? "slicer" : "geometry",
    gramsPerUnit: round2(totalGrams / options.quantity),
    hoursPerUnit: round2(totalHours / options.quantity),
    plates: Math.max(1, plates),
    totalGrams: round2(totalGrams),
    totalHours: round2(totalHours)
  };
}

export function validateSelections(selections, children) {
  if (!Array.isArray(selections) || selections.length < 1 || selections.length > children.length) throw new HttpError(400, "Choose at least one part to print.");
  const byId = new Map(children.map(child => [child.id, child]));
  const seen = new Set();
  return selections.map(item => {
    if (!item || typeof item !== "object") throw new HttpError(400, "A part selection is invalid.");
    const partId = validateAssetId(item.partId);
    const child = byId.get(partId);
    if (!child || child.state !== "ready") throw new HttpError(400, "That part is not part of this pack or could not be measured.");
    if (seen.has(partId)) throw new HttpError(400, "A part can only be selected once.");
    seen.add(partId);
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) throw new HttpError(400, "Part quantity must be a whole number from 1 to 99.");
    return { partId, quantity: item.quantity };
  });
}

async function sliceProductionFor({ repository, asset, options }) {
  const job = (await repository.listAssetJobs(asset.id)).find(candidate => candidate.jobType === "slice" && candidate.profileKey === sliceProfileKey(options) && candidate.state === "ready" && candidate.resultEstimateId);
  const production = job ? (await repository.findEstimate(job.resultEstimateId))?.input?.production : null;
  return production ? { gramsPerUnit: production.gramsPerUnit, hoursPerUnit: production.hoursPerUnit } : null;
}

export async function estimatePack({ repository, materialCosts, slicerEnabled, now, session, zip, selections, options, purpose = "preview", persist = true }) {
  const chosen = validateSelections(selections, await repository.listChildren(zip.id));
  const children = persist ? await repository.selectParts(zip.id, chosen) : (await repository.listChildren(zip.id)).map(child => ({ ...child, selected: chosen.some(item => item.partId === child.id), quantity: chosen.find(item => item.partId === child.id)?.quantity ?? 1 }));
  const jobOptions = { ...options, quantity: 1 };
  const parts = [];
  const states = [];
  for (const child of children.filter(row => row.selected)) {
    let slice = await sliceStatus({ repository, asset: child, options: jobOptions, slicerEnabled });
    if (persist && slicerEnabled && ["not_requested", "failed", "cancelled"].includes(slice.status)) {
      await repository.enqueueJob({ assetId: child.id, jobType: "slice", profileKey: sliceProfileKey(options), options: jobOptions });
      slice = { status: "pending" };
    }
    states.push(slice.status);
    parts.push({ asset: child, quantity: child.quantity, slicerProduction: slice.status === "ready" ? await sliceProductionFor({ repository, asset: child, options: jobOptions }) : null });
  }
  const production = rollUpPackProduction({ parts, options });
  const estimate = composePrintEstimate({ options, production, materialCost: await materialCosts.materialCost(options.material), now: now() });
  const packSlice = !slicerEnabled ? { status: "unavailable" }
    : states.every(state => state === "ready") ? { status: "ready", production: { estimatedGramsPerUnit: Math.round(production.gramsPerUnit * 10) / 10, estimatedHoursPerUnit: Math.round(production.hoursPerUnit * 10) / 10 } }
    : states.some(state => ["pending", "processing", "not_requested"].includes(state)) ? { status: "pending" } : { status: "failed" };
  const summary = { format: "zip", filename: zip.originalName, parts: children.length, selectedParts: parts.length };
  const view = { ...presentPublicEstimate({ status: "ready", estimate, modelSummary: summary, slice: packSlice }), pack: presentPack(zip, children).pack };
  if (persist) {
    await repository.insertEstimate(estimateRow({
      estimate, publicView: view, session, asset: zip, purpose, engine: GEOMETRY_ANALYZER.engine, engineVersion: GEOMETRY_ANALYZER.version,
      profileId: `pack:${sliceProfileKey(options)}`, geometry: { pack: { parts: chosen } }
    }));
  }
  return view;
}
