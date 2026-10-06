import assert from "node:assert/strict";
import test from "node:test";

import { createOperatorPrintView, selectLatestEstimate } from "../../lib/print-estimation/application/operator-view.js";

const asset = (id, extra = {}) => ({ id, originalName: `${id}.stl`, format: "stl", contentType: null, sizeBytes: 10, declaredSizeBytes: 10, sha256: null, state: "ready", analysisErrorCode: null, retentionHold: false, retentionExpiresAt: null, deletedAt: null, createdAt: "2026-10-05T00:00:00.000Z", geometryMetrics: { volumeMm3: 1000, surfaceAreaMm2: 600, dimensionsMm: [10, 10, 10], triangleCount: 12, unit: "mm", warnings: [] }, parentAssetId: null, archiveEntry: null, quantity: 1, selected: false, ...extra });

test("operator view presents the ZIP without geometry and parts with quantity", async () => {
  const zip = asset("zip", { format: "zip", originalName: "pack.zip", geometryMetrics: { format: "zip", pack: { ignored: [{ name: "views/1.png", kind: "image" }] } } });
  const part = asset("part1", { parentAssetId: "zip", archiveEntry: "stl/base.stl", quantity: 3, selected: true });
  const repository = { forRequest: async () => ({ assets: [zip, part], estimates: [], jobs: [], runs: [] }) };
  const result = await createOperatorPrintView({ repository }).forWork({ item: { id: "work_12345678", requestId: "3DP-1" } });
  const [presentedZip, presentedPart] = result.assets;
  assert.equal(presentedZip.geometry, null);
  assert.deepEqual(presentedZip.pack, { ignored: [{ name: "views/1.png", kind: "image" }] });
  assert.deepEqual([presentedPart.parentAssetId, presentedPart.archiveEntry, presentedPart.quantity, presentedPart.selected], ["zip", "stl/base.stl", 3, true]);
  assert.equal(presentedPart.geometry.dimensionsMm[0], 10);
});

test("a part's slicer estimate is never paired with the pack's submission snapshot", () => {
  const input = { options: { material: "pla", quality: "standard", supports: "none", colors: 1 } };
  const submission = { id: "pest_1", purpose: "submission", estimatorType: "geometry", assetId: "zip", input };
  const partSlice = { id: "pest_2", purpose: "slice", estimatorType: "slicer", assetId: "part1", input };
  assert.equal(selectLatestEstimate([partSlice, submission]).id, "pest_1");
  const sameAsset = { ...partSlice, id: "pest_3", assetId: "zip" };
  assert.equal(selectLatestEstimate([sameAsset, submission]).id, "pest_3");
});

test("a ZIP with no geometry metrics presents an empty ignored list", async () => {
  const zip = asset("zip", { format: "zip", originalName: "pack.zip", geometryMetrics: null });
  const repository = { forRequest: async () => ({ assets: [zip], estimates: [], jobs: [], runs: [] }) };
  const result = await createOperatorPrintView({ repository }).forWork({ item: { id: "work_12345678", requestId: "3DP-1" } });
  assert.deepEqual(result.assets[0].pack, { ignored: [] });
  assert.equal(result.assets[0].geometry, null);
});
