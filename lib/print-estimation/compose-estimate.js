// Composes one immutable estimate snapshot from assumptions, production figures,
// a private material-cost snapshot, the public rate card, and the pricing policy.
import {
  computeInternalCost, DEFAULT_PRICING_MODEL, presentCost, priceEstimate, pricingModelSnapshot
} from "./pricing-policy.js";
import { marketPrice } from "./rate-card.js";

function finitePositive(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${name} must be a finite, non-negative number.`);
  return number;
}

export function composePrintEstimate({ options, production, materialCost, model = DEFAULT_PRICING_MODEL, now = new Date() }) {
  if (!options || !production || !materialCost) throw new TypeError("Options, production, and material cost are required.");
  const quantity = options.quantity;
  const gramsPerUnit = finitePositive(production.gramsPerUnit, "grams per unit");
  const hoursPerUnit = finitePositive(production.hoursPerUnit, "hours per unit");
  const plates = Math.max(1, Math.round(production.plates ?? quantity));
  const totalGrams = production.totalGrams == null ? gramsPerUnit * quantity : finitePositive(production.totalGrams, "total grams");
  const totalHours = production.totalHours == null ? hoursPerUnit * quantity : finitePositive(production.totalHours, "total hours");
  const finishingHoursPerUnit = model.labor.finishingActiveHoursPerUnit[options.finish] ?? 0;
  const cost = computeInternalCost({
    quantity, plates, totalGrams, machineHours: totalHours,
    finishingActiveHours: finishingHoursPerUnit * quantity, materialCost
  }, model);
  const market = marketPrice(options, { ...production, gramsPerUnit, hoursPerUnit });
  const pricing = priceEstimate({ cost, marketPriceUsd: market.priceUsd, estimatorType: production.source, model });
  return {
    estimatorType: production.source,
    confidence: pricing.confidence,
    pricingModelVersion: model.version,
    rateCardVersion: market.version,
    createdAt: now.toISOString(),
    input: {
      options: { ...options },
      production: { source: production.source, gramsPerUnit, hoursPerUnit, plates, totalGrams, totalHours, unitsPerPlate: production.unitsPerPlate ?? null }
    },
    cost: presentCost(cost),
    pricing,
    model: pricingModelSnapshot(model)
  };
}

const QUALITY_LABELS = { draft: "Draft profile", standard: "Standard profile", fine: "Fine profile" };
const SUPPORT_LABELS = { none: "No supports assumed", some: "Some supports assumed", heavy: "Heavy supports assumed" };
const DELIVERY_LABELS = { pickup: "Pickup", local: "Local delivery", shipping: "Shipping allowance" };
const SOURCE_LABELS = {
  geometry: "Estimated from model geometry — not a slice",
  slicer: "Estimated by a slicer profile",
  manual: "Based on the weight and time you entered",
  size: "Based on the selected size class",
  catalog: "Known catalog item"
};

/** Customer-safe projection. Internal cost, floor, margin, and inventory never leave. */
export function presentPublicEstimate({ status = "ready", estimate, modelSummary = null, slice = null }) {
  if (!estimate) return { status, confidence: null, price: null, model: modelSummary, production: null, assumptions: [], slice };
  const { options, production } = estimate.input;
  return {
    status,
    confidence: estimate.confidence,
    estimator: estimate.estimatorType,
    price: { low: estimate.pricing.range.low, high: estimate.pricing.range.high, currency: estimate.pricing.currency },
    model: modelSummary,
    production: {
      material: options.material.toUpperCase(),
      quantity: options.quantity,
      estimatedGramsPerUnit: Math.round(production.gramsPerUnit * 10) / 10,
      estimatedHoursPerUnit: Math.round(production.hoursPerUnit * 10) / 10
    },
    assumptions: [
      SOURCE_LABELS[estimate.estimatorType] ?? "Planning assumption",
      QUALITY_LABELS[options.quality], SUPPORT_LABELS[options.supports], DELIVERY_LABELS[options.delivery],
      "Final price requires human review"
    ].filter(Boolean),
    slice,
    createdAt: estimate.createdAt
  };
}
