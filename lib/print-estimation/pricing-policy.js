// Private print economics and the dual-floor price policy.
//
// Internal cost = material (landed, waste-adjusted) + passive machine time + active
// touch labor + explicit finishing labor + other direct cost. Operator wages are
// never spread across unattended machine hours.
//
//   economicFloor = totalInternalCost / (1 - requiredMinimumMargin)
//   candidatePrice = max(marketPrice, economicFloor, minimumJobCharge)
//
// Everything here is server-only. Customers receive presentPublicEstimate() output.

export const PRICING_MODEL_VERSION = "2026-09-30.1";

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const DEFAULT_PRICING_MODEL = deepFreeze({
  version: PRICING_MODEL_VERSION,
  currency: "USD",
  machine: {
    costBasisUsd: 1000,
    serviceLifeYears: 3,
    annualMaintenanceRate: 0.1,
    scheduledRuntimeHoursPerWeek: 32,
    weeksPerYear: 52,
    productiveUtilization: 0.8,
    averagePowerKw: 0.2,
    electricityUsdPerKwh: 0.15,
    failureReworkRate: 0.1,
    monthlyFixedOverheadUsd: 0
  },
  labor: {
    baseWageUsdPerHour: 10,
    burdenRate: 0.25,
    laborReserveRate: 0,
    defaultActiveHoursPerPlate: 0.25,
    finishingActiveHoursPerUnit: { none: 0, cleanup: 0.1, sanded: 0.5, painted: 1.25 }
  },
  material: {
    wasteRate: 0.08,
    fallbackLandedUsdPerKg: { pla: 20, petg: 22, asa: 26, tpu: 28, other: 25 }
  },
  pricing: {
    requiredMinimumMargin: 0.5,
    minimumJobChargeUsd: 15,
    spreads: { catalog: 0.05, slicer: 0.12, manual: 0.14, geometry: 0.25, size: 0.28 }
  }
});

export const ESTIMATOR_CONFIDENCE = Object.freeze({ catalog: "high", slicer: "better", manual: "better", geometry: "rough", size: "rough" });

function finite(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) throw new RangeError(`${name} must be a finite number.`);
  if (number < min || number > max) throw new RangeError(`${name} must be between ${min} and ${max}.`);
  if (integer && !Number.isInteger(number)) throw new RangeError(`${name} must be a whole number.`);
  return number;
}

const cents = value => Math.round(value * 100);
const usd = value => Math.round(value * 100) / 100;

export function machineEconomics(model = DEFAULT_PRICING_MODEL) {
  const m = model.machine;
  const scheduledHoursPerYear = finite(m.scheduledRuntimeHoursPerWeek, "scheduled runtime", { min: 1, max: 168 }) * finite(m.weeksPerYear, "weeks/year", { min: 1, max: 53 });
  const productiveHoursPerYear = scheduledHoursPerYear * finite(m.productiveUtilization, "productive utilization", { min: 0.01, max: 1 });
  const depreciationPerHour = (finite(m.costBasisUsd, "machine basis") / finite(m.serviceLifeYears, "service life", { min: 0.1, max: 50 })) / productiveHoursPerYear;
  const maintenancePerHour = (m.costBasisUsd * finite(m.annualMaintenanceRate, "maintenance rate", { max: 5 })) / productiveHoursPerYear;
  const electricityPerHour = finite(m.averagePowerKw, "power", { max: 50 }) * finite(m.electricityUsdPerKwh, "electricity", { max: 10 });
  const overheadPerHour = (finite(m.monthlyFixedOverheadUsd ?? 0, "overhead") * 12) / productiveHoursPerYear;
  const basePerHour = depreciationPerHour + maintenancePerHour + electricityPerHour + overheadPerHour;
  const passivePerSuccessfulHour = basePerHour / (1 - finite(m.failureReworkRate, "failure/rework rate", { max: 0.95 }));
  return { scheduledHoursPerYear, productiveHoursPerYear, depreciationPerHour, maintenancePerHour, electricityPerHour, overheadPerHour, basePerHour, passivePerSuccessfulHour };
}

export function laborEconomics(model = DEFAULT_PRICING_MODEL) {
  const l = model.labor;
  const loadedPerActiveHour = finite(l.baseWageUsdPerHour, "wage", { max: 1000 }) * (1 + finite(l.burdenRate, "burden", { max: 5 })) * (1 + finite(l.laborReserveRate ?? 0, "labor reserve", { max: 5 }));
  const activeHoursPerPlate = finite(l.defaultActiveHoursPerPlate, "active hours per plate", { max: 24 });
  return { loadedPerActiveHour, activeHoursPerPlate, laborPerPlate: loadedPerActiveHour * activeHoursPerPlate };
}

export function fallbackMaterialCost(material, model = DEFAULT_PRICING_MODEL) {
  const table = model.material.fallbackLandedUsdPerKg;
  const key = Object.hasOwn(table, material) ? material : "other";
  return { material: key === material ? material : "other", landedUsdPerKg: table[key], source: "fallback", inventoryIds: [], onHandGrams: 0 };
}

/**
 * Internal cost for one print job. `plates` is the number of build plates; routine
 * touch labor is charged once per plate, so several units on one plate share it.
 */
export function computeInternalCost(input, model = DEFAULT_PRICING_MODEL) {
  if (!input || typeof input !== "object") throw new TypeError("Cost input is required.");
  const quantity = finite(input.quantity ?? 1, "quantity", { min: 1, max: 10000, integer: true });
  const plates = finite(input.plates ?? 1, "plates", { min: 1, max: 10000, integer: true });
  const totalGrams = finite(input.totalGrams, "grams", { max: 1_000_000 });
  const machineHours = finite(input.machineHours, "machine hours", { max: 100_000 });
  const finishingHours = finite(input.finishingActiveHours ?? 0, "finishing hours", { max: 10_000 });
  const otherDirectUsd = finite(input.otherDirectUsd ?? 0, "other direct cost", { max: 1_000_000 });
  const landedUsdPerKg = finite(input.materialCost?.landedUsdPerKg, "landed material cost", { max: 10_000 });
  const wasteRate = finite(model.material.wasteRate, "waste rate", { max: 5 });
  const machine = machineEconomics(model);
  const labor = laborEconomics(model);

  const material = (totalGrams / 1000) * landedUsdPerKg * (1 + wasteRate);
  const passiveMachine = machineHours * machine.passivePerSuccessfulHour;
  const activeLabor = plates * labor.laborPerPlate;
  const finishingLabor = finishingHours * labor.loadedPerActiveHour;
  const total = material + passiveMachine + activeLabor + finishingLabor + otherDirectUsd;
  return {
    quantity, plates, totalGrams, machineHours, finishingActiveHours: finishingHours,
    material, passiveMachine, activeLabor, finishingLabor, other: otherDirectUsd, total, perUnit: total / quantity,
    rates: {
      landedUsdPerKg, wasteRate,
      passiveMachineUsdPerHour: machine.passivePerSuccessfulHour,
      loadedLaborUsdPerActiveHour: labor.loadedPerActiveHour,
      activeHoursPerPlate: labor.activeHoursPerPlate
    },
    materialCost: { ...input.materialCost }
  };
}

export function economicFloor(totalInternalCost, requiredMinimumMargin) {
  const cost = finite(totalInternalCost, "internal cost", { max: 10_000_000 });
  const margin = finite(requiredMinimumMargin, "required minimum margin", { max: 0.95 });
  return cost / (1 - margin);
}

const marginAt = (price, cost) => price > 0 ? (price - cost) / price : null;

/**
 * Dual-floor pricing with a confidence band. The low end never drops below the
 * minimum job charge or the economic floor, so a band cannot quote below policy.
 */
export function priceEstimate({ cost, marketPriceUsd, estimatorType, model = DEFAULT_PRICING_MODEL }) {
  if (!cost || !Number.isFinite(cost.total)) throw new TypeError("An internal cost breakdown is required.");
  const market = finite(marketPriceUsd, "market price", { max: 10_000_000 });
  const spreads = model.pricing.spreads;
  if (!Object.hasOwn(spreads, estimatorType)) throw new RangeError(`Unknown estimator type: ${estimatorType}`);
  const spread = spreads[estimatorType];
  const minimum = finite(model.pricing.minimumJobChargeUsd, "minimum job charge", { max: 100_000 });
  const requiredMargin = model.pricing.requiredMinimumMargin;
  const floor = economicFloor(cost.total, requiredMargin);
  const candidate = Math.max(market, floor, minimum);
  const selectedBy = candidate === market ? "market" : candidate === floor ? "economic_floor" : "minimum";
  const lowFloor = Math.max(minimum, floor);
  const low = Math.max(Math.ceil(lowFloor), Math.round(candidate * (1 - spread)));
  const high = Math.max(low, Math.round(candidate * (1 + spread)));
  const target = usd(candidate);
  return {
    currency: model.currency,
    estimatorType,
    confidence: ESTIMATOR_CONFIDENCE[estimatorType],
    spread,
    marketPrice: usd(market),
    economicFloor: usd(floor),
    minimumCharge: minimum,
    requiredMinimumMargin: requiredMargin,
    selectedPrice: target,
    selectedBy,
    range: { low, high, target },
    cents: { low: cents(low), high: cents(high), target: cents(target) },
    projected: {
      grossProfit: { low: usd(low - cost.total), target: usd(target - cost.total), high: usd(high - cost.total) },
      margin: { low: marginAt(low, cost.total), target: marginAt(target, cost.total), high: marginAt(high, cost.total) }
    }
  };
}

export function presentCost(cost) {
  return {
    material: usd(cost.material), passiveMachine: usd(cost.passiveMachine), activeLabor: usd(cost.activeLabor),
    finishingLabor: usd(cost.finishingLabor), other: usd(cost.other), total: usd(cost.total), perUnit: usd(cost.perUnit),
    quantity: cost.quantity, plates: cost.plates, totalGrams: cost.totalGrams, machineHours: cost.machineHours,
    finishingActiveHours: cost.finishingActiveHours, rates: { ...cost.rates }, materialCost: { ...cost.materialCost }
  };
}

/** Snapshot of the exact assumptions used, so later config changes never rewrite a quote. */
export function pricingModelSnapshot(model = DEFAULT_PRICING_MODEL) {
  return JSON.parse(JSON.stringify({ version: model.version, machine: model.machine, labor: model.labor, material: { wasteRate: model.material.wasteRate }, pricing: model.pricing, derived: { machine: machineEconomics(model), labor: laborEconomics(model) } }));
}
