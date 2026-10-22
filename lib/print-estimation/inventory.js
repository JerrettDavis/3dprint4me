// Private filament inventory rules: validation and effective material-cost selection.
import { HttpError } from "../http.js";
import { DEFAULT_PRICING_MODEL, fallbackMaterialCost } from "./pricing-policy.js";
import { parseColor } from '../filament-matching/color.js';

const text = (value, max) => {
  if (value == null || String(value).trim() === "") return null;
  const cleaned = String(value).replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (cleaned.length > max) throw new HttpError(400, `Filament text fields must be ${max} characters or fewer.`);
  return cleaned;
};
const integer = (value, name, { min = 0, max }) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new HttpError(400, `${name} must be a whole number between ${min} and ${max}.`);
  return number;
};

/** Validates an operator-submitted inventory row. Money is integer cents. */
export function normalizeFilamentInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "A filament object is required.");
  const allowed = ["id", "revision", "colorHex", "material", "brandLine", "color", "spoolNominalGrams", "purchaseCostCents", "freightFeeCents", "onHandGrams", "active", "estimateDefault", "notes"];
  const extra = Object.keys(input).find(key => !allowed.includes(key));
  if (extra) throw new HttpError(400, `Unexpected field: ${extra}.`);
  const material = String(input.material ?? "").trim().toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(material)) throw new HttpError(400, "Material must be 2-40 lowercase letters, numbers, or dashes.");
  const id = input.id == null ? null : String(input.id);
  if (id !== null && !/^fil_[A-Za-z0-9_-]{8,64}$/.test(id)) throw new HttpError(400, "A valid filament ID is required.");
  if (input.colorHex && !/^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i.test(input.colorHex)) throw new HttpError(400, 'Color hex must use #RRGGBB.');
  return {
    id,
    revision: id ? integer(input.revision, 'Inventory revision', { min: 1, max: 2147483647 }) : 1,
    colorHex: parseColor(input.colorHex)?.hex ?? null,
    material,
    brandLine: text(input.brandLine, 120),
    color: text(input.color, 80),
    spoolNominalGrams: integer(input.spoolNominalGrams, "Spool grams", { min: 1, max: 100000 }),
    purchaseCostCents: integer(input.purchaseCostCents, "Purchase cost", { max: 10000000 }),
    freightFeeCents: integer(input.freightFeeCents ?? 0, "Freight and fees", { max: 10000000 }),
    onHandGrams: integer(input.onHandGrams ?? 0, "On-hand grams", { max: 10000000 }),
    active: input.active === undefined ? true : input.active === true,
    estimateDefault: input.estimateDefault === true,
    notes: text(input.notes, 1000)
  };
}

export function landedUsdPerKg(row) {
  const cents = row.source && row.costOverrideCents != null ? row.costOverrideCents : row.purchaseCostCents;
  const grams = row.source ? row.source.priceBasisGrams ?? row.source.initialGrams ?? row.source.nominalGrams : row.spoolNominalGrams;
  if (cents == null || !(grams > 0)) return null;
  return ((cents + (row.freightFeeCents ?? 0)) / 100) / (grams / 1000);
}

/**
 * Effective private material cost for a material family:
 * 1. weighted-average landed cost of active rows with on-hand grams;
 * 2. otherwise the estimate-default, then most recently updated, active row;
 * 3. otherwise the pricing model's explicit fallback. Inventory is never invented.
 */
export function selectEffectiveMaterialCost(rows, material, { model = DEFAULT_PRICING_MODEL, now = new Date() } = {}) {
  const all = (rows ?? []).filter(row => row.active && row.material === material);
  const active = all.filter(row => landedUsdPerKg(row) != null);
  const imports = all.filter(row => row.source);
  const metadata = imports.length ? {
    uncoveredGrams: all.filter(row => landedUsdPerKg(row) == null).reduce((sum,row) => sum + (row.onHandGrams ?? 0), 0),
    unknownWeightCount: all.filter(row => row.onHandGrams == null).length,
    costCoverage: active.length === all.length ? 'complete' : active.length ? 'partial' : 'none',
    inventoryStale: imports.some(row => { const age = now.getTime() - Date.parse(row.source.lastSuccessAt); return !Number.isFinite(age) || age < 0 || age >= 300000; }),
    costProvenance: imports.map(row => ({ id: row.id, source: row.costOverrideCents != null ? 'local_override' : row.purchaseCostCents != null ? row.source.priceSource : 'fallback', currency: row.source.currency, lastSuccessAt: row.source.lastSuccessAt ?? null }))
  } : {};
  const capturedAt = now.toISOString();
  const onHand = active.filter(row => row.onHandGrams > 0);
  if (onHand.length) {
    const grams = onHand.reduce((sum, row) => sum + row.onHandGrams, 0);
    const weighted = onHand.reduce((sum, row) => sum + landedUsdPerKg(row) * row.onHandGrams, 0) / grams;
    return { material, landedUsdPerKg: Math.round(weighted * 10000) / 10000, source: "inventory_weighted", inventoryIds: onHand.map(row => row.id), onHandGrams: grams, capturedAt, ...metadata };
  }
  if (active.length) {
    const [chosen] = [...active].sort((a, b) => Number(b.estimateDefault) - Number(a.estimateDefault) || String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
    return { material, landedUsdPerKg: Math.round(landedUsdPerKg(chosen) * 10000) / 10000, source: "inventory_latest", inventoryIds: [chosen.id], onHandGrams: 0, capturedAt, ...metadata };
  }
  return { ...fallbackMaterialCost(material, model), requestedMaterial: material, capturedAt, ...metadata };
}

export function presentFilament(row) {
  const cost = landedUsdPerKg(row);
  return { ...row, landedUsdPerKg: cost == null ? null : Math.round(cost * 100) / 100 };
}
