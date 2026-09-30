import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Pins the workbook calibration fixtures with an independent transcription of its
// spreadsheet formulas. The server pricing policy is tested against the same file.
const fixtures = JSON.parse(await readFile(new URL("../fixtures/print-estimation/pricing-calibration.json", import.meta.url), "utf8"));
const a = fixtures.assumptions;
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);

function workbookPassiveCostPerHour() {
  const productiveHours = a.scheduledRuntimeHoursPerWeek * a.weeksPerYear * a.productiveUtilization; // Unit Economics!B7
  const depreciation = (a.machineCostBasisUsd / a.serviceLifeYears) / productiveHours; // D16
  const maintenance = (a.machineCostBasisUsd * a.annualMaintenanceRate) / productiveHours; // D17
  const electricity = a.averagePowerKw * a.electricityUsdPerKwh; // D18
  return (depreciation + maintenance + electricity) / (1 - a.failureReworkRate); // D20
}

test("workbook passive machine cost excludes operator wages and applies the rework reserve", () => {
  close(workbookPassiveCostPerHour(), fixtures.expected.passiveMachineUsdPerSuccessfulHour, "passive $/h");
  close(a.operatorBaseWageUsdPerHour * (1 + a.laborBurdenRate) * (1 + a.laborReserveRate), fixtures.expected.loadedLaborUsdPerActiveHour, "loaded labor");
  close(fixtures.expected.loadedLaborUsdPerActiveHour * a.defaultActiveHoursPerPlate, fixtures.expected.defaultLaborUsdPerPlate, "labor per plate");
});

test("workbook product fixtures divide one plate of labor across every unit on the plate", () => {
  for (const product of fixtures.products) {
    const material = (product.plateGrams / 1000) * a.plaLandedUsdPerKg * (1 + a.materialWasteRate);
    const machine = product.plateHours * fixtures.expected.passiveMachineUsdPerSuccessfulHour;
    const labor = fixtures.expected.defaultLaborUsdPerPlate;
    const perUnit = (material + machine + labor) / product.unitsPerPlate;
    close(perUnit, product.modeledCostUsdPerUnit, `${product.name} cost`);
    close((product.targetUsdPerUnit - perUnit) / product.targetUsdPerUnit, product.modeledMargin, `${product.name} margin`);
  }
});

test("the goal-prompt approximations remain true for the pinned fixtures", () => {
  const byName = Object.fromEntries(fixtures.products.map(product => [product.name, product]));
  assert.equal(byName["Multicolor Sign"].modeledCostUsdPerUnit.toFixed(2), "6.99");
  assert.equal(byName["Multicolor Sign Base and Business Card Holder"].modeledCostUsdPerUnit.toFixed(2), "10.31");
  assert.equal(byName["Single-Color Axolotl"].modeledCostUsdPerUnit.toFixed(2), "4.09");
  assert.equal(byName["Multicolor Axolotl"].modeledCostUsdPerUnit.toFixed(2), "2.07");
  assert.equal((byName["Multicolor Sign"].modeledMargin * 100).toFixed(1), "76.7");
  assert.equal((byName["Single-Color Axolotl"].modeledMargin * 100).toFixed(1), "18.1");
  assert.equal((byName["Multicolor Axolotl"].modeledMargin * 100).toFixed(1), "79.3");
});
