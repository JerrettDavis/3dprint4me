import assert from "node:assert/strict";
import test from "node:test";
import { parseBambuResult } from "../../lib/print-estimation/adapters/bambu-cli-slicer.js";

// Shape captured from a real three-color Bambu Studio 02.08.04.57 slice (see
// docs/superpowers/notes/2026-10-02-multicolor-slicing.md): filament usage is per slot and
// filament_change_times counts tool changes.
test("parseBambuResult sums per-slot filament grams and reports tool changes for multi-color plates", () => {
  const result = parseBambuResult(JSON.stringify({
    return_code: 0, layer_height: 0.16,
    sliced_plates: [{ total_predication: 20917.4, filament_change_times: 224, filaments: [{ total_used_g: 20.5 }, { total_used_g: 24.5 }, { total_used_g: 24.2 }] }]
  }));
  assert.equal(result.returnCode, 0);
  assert.equal(result.toolChanges, 224);
  assert.ok(Math.abs(result.materialGrams - 69.2) < 1e-9);
  assert.equal(result.elapsedSeconds, 20917.4);
});

test("parseBambuResult reports zero tool changes for a single-color plate", () => {
  const result = parseBambuResult(JSON.stringify({ return_code: 0, sliced_plates: [{ total_predication: 100, filaments: [{ total_used_g: 5 }] }] }));
  assert.equal(result.toolChanges, 0);
});
