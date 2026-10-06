import { basename } from "node:path";

import { sanitizeFilename } from "../../validation.js";
import { modelSummary } from "./estimate-session.js";

/** Display-only name for an extracted part; never used for storage. */
export const partDisplayName = entryName => sanitizeFilename(basename(String(entryName).replaceAll("\\", "/")));

function presentPart(child) {
  const base = { partId: child.id, name: child.archiveEntry ?? child.originalName, format: child.format, state: child.state, quantity: child.quantity, selected: child.selected };
  if (child.state !== "ready") return { ...base, reason: "not_measurable" };
  const { dimensionsMm, volumeCm3, triangleCount, warnings } = modelSummary(child);
  return { ...base, dimensionsMm, volumeCm3, triangleCount, warnings };
}

/** Public-safe pack view: never includes Blob paths or hashes. */
export function presentPack(zip, children) {
  return {
    status: "pack",
    pack: { assetId: zip.id, filename: zip.originalName, parts: children.map(presentPart), ignored: zip.geometryMetrics?.pack?.ignored ?? [] },
    slice: { status: "unavailable" }
  };
}
