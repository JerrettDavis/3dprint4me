import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SITE_CONFIG } from "../../public/assets/js/config.js";
import { calculateEstimate } from "../../public/assets/js/quote-engine.js";
import { composePrintEstimate, presentPublicEstimate } from "../../lib/print-estimation/compose-estimate.js";
import { normalizeEstimateOptions } from "../../lib/print-estimation/domain.js";
import {
  computeInternalCost, DEFAULT_PRICING_MODEL, economicFloor, laborEconomics, machineEconomics, priceEstimate, PRICING_MODEL_VERSION
} from "../../lib/print-estimation/pricing-policy.js";

const fixtures = JSON.parse(await readFile(new URL("../fixtures/print-estimation/pricing-calibration.json", import.meta.url), "utf8"));
const pla = { landedUsdPerKg: 20, source: "fallback", material: "pla" };
const close = (actual, expected, message = "") => assert.ok(Math.abs(actual - expected) < 1e-9, `${message} ${actual} != ${expected}`);
const withModel = patch => structuredClone({ ...DEFAULT_PRICING_MODEL, ...patch });

test("passive machine cost matches the workbook and never includes operator wages", () => {
  close(machineEconomics().passivePerSuccessfulHour, fixtures.expected.passiveMachineUsdPerSuccessfulHour);
  const richer = withModel({ labor: { ...DEFAULT_PRICING_MODEL.labor, baseWageUsdPerHour: 100 } });
  close(machineEconomics(richer).passivePerSuccessfulHour, fixtures.expected.passiveMachineUsdPerSuccessfulHour, "wage changed passive cost");
  const oneHour = computeInternalCost({ totalGrams: 0, machineHours: 1, plates: 1, materialCost: pla });
  const tenHours = computeInternalCost({ totalGrams: 0, machineHours: 10, plates: 1, materialCost: pla });
  assert.equal(tenHours.activeLabor, oneHour.activeLabor, "active labor must not scale with unattended machine hours");
});

test("default active labor is 0.25 h per plate at a $12.50 loaded rate", () => {
  const labor = laborEconomics();
  assert.equal(labor.activeHoursPerPlate, 0.25);
  assert.equal(labor.loadedPerActiveHour, 12.5);
  assert.equal(labor.laborPerPlate, 3.125);
});

test("calibration fixtures reproduce workbook cost and target margin", () => {
  for (const product of fixtures.products) {
    const cost = computeInternalCost({ quantity: product.unitsPerPlate, plates: 1, totalGrams: product.plateGrams, machineHours: product.plateHours, materialCost: pla });
    close(cost.perUnit, product.modeledCostUsdPerUnit, product.name);
    close((product.targetUsdPerUnit - cost.perUnit) / product.targetUsdPerUnit, product.modeledMargin, product.name);
  }
});

test("batch labor divides across the units that share one plate", () => {
  const sevenUp = computeInternalCost({ quantity: 7, plates: 1, totalGrams: 290, machineHours: 13, materialCost: pla });
  const sevenPlates = computeInternalCost({ quantity: 7, plates: 7, totalGrams: 290, machineHours: 13, materialCost: pla });
  close(sevenUp.activeLabor, 3.125);
  close(sevenUp.activeLabor / 7, 3.125 / 7);
  close(sevenPlates.activeLabor, 21.875);
  close(sevenUp.perUnit, 2.0749001322751326, "7-up axolotl");
});

test("material cost applies the waste allowance to the landed cost snapshot", () => {
  const cost = computeInternalCost({ totalGrams: 1000, machineHours: 0, plates: 1, materialCost: { landedUsdPerKg: 20 } });
  close(cost.material, 21.6);
  assert.equal(cost.rates.wasteRate, 0.08);
});

test("market price wins when it is above the economic floor", () => {
  const cost = computeInternalCost({ totalGrams: 115, machineHours: 3.5, plates: 1, materialCost: pla });
  const pricing = priceEstimate({ cost, marketPriceUsd: 30, estimatorType: "catalog" });
  close(pricing.economicFloor, 13.98);
  assert.equal(pricing.selectedBy, "market");
  assert.equal(pricing.selectedPrice, 30);
  assert.ok(pricing.projected.margin.target > 0.76 && pricing.projected.margin.target < 0.77);
});

test("economic floor wins when the market rule is too low", () => {
  const cost = computeInternalCost({ totalGrams: 800, machineHours: 40, plates: 2, materialCost: pla });
  const pricing = priceEstimate({ cost, marketPriceUsd: 20, estimatorType: "slicer" });
  close(pricing.economicFloor, Math.round((cost.total / 0.5) * 100) / 100);
  assert.equal(pricing.selectedBy, "economic_floor");
  assert.ok(pricing.range.low >= Math.ceil(pricing.economicFloor), "band must not quote below the floor");
  assert.ok(pricing.projected.margin.low >= 0.5 - 1e-9);
});

test("minimum job charge wins when market and floor are both low", () => {
  const cost = computeInternalCost({ totalGrams: 5, machineHours: 0.25, plates: 1, materialCost: pla });
  const pricing = priceEstimate({ cost, marketPriceUsd: 4, estimatorType: "geometry" });
  assert.equal(pricing.selectedBy, "minimum");
  assert.equal(pricing.selectedPrice, 15);
  assert.equal(pricing.range.low, 15);
  assert.equal(pricing.minimumCharge, SITE_CONFIG.pricing.print.minimum, "server minimum must match the public rate card");
});

test("single-color axolotl evidence: one small part is floored by the minimum, not its $5 target", () => {
  const cost = computeInternalCost({ totalGrams: 22, machineHours: 1.25, plates: 1, materialCost: pla });
  const pricing = priceEstimate({ cost, marketPriceUsd: 5, estimatorType: "catalog" });
  assert.equal(pricing.selectedBy, "minimum");
  close(pricing.economicFloor, Math.round(cost.total / 0.5 * 100) / 100);
});

test("confidence bands widen from catalog to size assumptions", () => {
  const cost = computeInternalCost({ totalGrams: 100, machineHours: 4, plates: 1, materialCost: pla });
  const width = type => { const { range } = priceEstimate({ cost, marketPriceUsd: 100, estimatorType: type }); return range.high - range.low; };
  assert.ok(width("catalog") < width("slicer"));
  assert.ok(width("slicer") < width("geometry"));
  assert.ok(width("geometry") < width("size"));
});

test("invalid and non-finite inputs are rejected", () => {
  for (const bad of [NaN, Infinity, -1, "abc", null, undefined]) {
    assert.throws(() => computeInternalCost({ totalGrams: bad, machineHours: 1, plates: 1, materialCost: pla }), RangeError, String(bad));
    assert.throws(() => computeInternalCost({ totalGrams: 1, machineHours: bad, plates: 1, materialCost: pla }), RangeError, String(bad));
  }
  assert.throws(() => computeInternalCost({ totalGrams: 1, machineHours: 1, plates: 1.5, materialCost: pla }), RangeError);
  assert.throws(() => computeInternalCost({ totalGrams: 1, machineHours: 1, plates: 1, materialCost: { landedUsdPerKg: NaN } }), RangeError);
  assert.throws(() => economicFloor(10, 1), RangeError);
  const cost = computeInternalCost({ totalGrams: 1, machineHours: 1, plates: 1, materialCost: pla });
  assert.throws(() => priceEstimate({ cost, marketPriceUsd: NaN, estimatorType: "manual" }), RangeError);
  assert.throws(() => priceEstimate({ cost, marketPriceUsd: 10, estimatorType: "guess" }), RangeError);
});

test("an estimate snapshot is versioned and the public projection hides internal economics", () => {
  const options = normalizeEstimateOptions({ material: "petg", quantity: 3, quality: "fine", colors: 2, finish: "cleanup", supports: "some", delivery: "local" });
  const estimate = composePrintEstimate({ options, production: { source: "geometry", gramsPerUnit: 40, hoursPerUnit: 2.5, plates: 1 }, materialCost: { material: "petg", landedUsdPerKg: 22, source: "inventory_weighted", inventoryIds: ["fil_1"] }, now: new Date("2026-09-30T12:00:00Z") });
  assert.equal(estimate.pricingModelVersion, PRICING_MODEL_VERSION);
  assert.equal(estimate.createdAt, "2026-09-30T12:00:00.000Z");
  assert.equal(estimate.cost.materialCost.source, "inventory_weighted");
  assert.equal(estimate.model.derived.labor.laborPerPlate, 3.125);
  assert.ok(estimate.cost.finishingLabor > 0, "finishing is explicit labor, not hidden in machine time");
  assert.ok(estimate.pricing.marketPrice > 0);
  const publicView = presentPublicEstimate({ estimate, modelSummary: { format: "stl", dimensionsMm: [10, 20, 30] } });
  const serialized = JSON.stringify(publicView).toLowerCase();
  for (const forbidden of ["cost", "margin", "floor", "wage", "landed", "inventory", "labor", "profit", "fil_1", "market"]) {
    assert.equal(serialized.includes(forbidden), false, `public estimate leaked ${forbidden}`);
  }
  assert.equal(publicView.confidence, "rough");
  assert.match(publicView.assumptions[0], /not a slice/);
});

test("the browser planning range labels a geometry estimate as rough and not a slice", () => {
  const base = { service: "print", material: "pla", quality: "standard", quantity: "1", colors: "1", finish: "none", delivery: "pickup", grams: "", machineHours: "" };
  const geometry = calculateEstimate({ ...base, modelEstimate: { grams: 40, hours: 2.2, source: "geometry" } });
  const slicer = calculateEstimate({ ...base, modelEstimate: { grams: 40, hours: 2.2, source: "slicer" } });
  assert.equal(geometry.confidence, "rough");
  assert.match(geometry.breakdown.assumption, /not a slice/);
  assert.equal(slicer.confidence, "better");
  assert.ok(slicer.high - slicer.low < geometry.high - geometry.low);
  const manual = calculateEstimate({ ...base, grams: "40", machineHours: "2", modelEstimate: { grams: 400, hours: 20, source: "geometry" } });
  assert.equal(manual.breakdown.assumption, "40 g · 2 machine hr", "entered slicer values take precedence");
});
