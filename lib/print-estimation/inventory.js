// Private filament inventory rules: validation and effective material-cost selection.
import { HttpError } from "../http.js";
import { DEFAULT_PRICING_MODEL, fallbackMaterialCost } from "./pricing-policy.js";

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
  const allowed = ["id", "material", "brandLine", "color", "spoolNominalGrams", "purchaseCostCents", "freightFeeCents", "onHandGrams", "active", "estimateDefault", "notes"];
  const extra = Object.keys(input).find(key => !allowed.includes(key));
  if (extra) throw new HttpError(400, `Unexpected field: ${extra}.`);
  const material = String(input.material ?? "").trim().toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(material)) throw new HttpError(400, "Material must be 2-40 lowercase letters, numbers, or dashes.");
  const id = input.id == null ? null : String(input.id);
  if (id !== null && !/^fil_[A-Za-z0-9_-]{8,64}$/.test(id)) throw new HttpError(400, "A valid filament ID is required.");
  return {
    id,
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
  return ((row.purchaseCostCents + row.freightFeeCents) / 100) / (row.spoolNominalGrams / 1000);
}

/**
 * Effective private material cost for a material family:
 * 1. weighted-average landed cost of active rows with on-hand grams;
 * 2. otherwise the estimate-default, then most recently updated, active row;
 * 3. otherwise the pricing model's explicit fallback. Inventory is never invented.
 */
export function selectEffectiveMaterialCost(rows, material, { model = DEFAULT_PRICING_MODEL, now = new Date() } = {}) {
  const active = (rows ?? []).filter(row => row.active && row.material === material && row.spoolNominalGrams > 0);
  const capturedAt = now.toISOString();
  const onHand = active.filter(row => row.onHandGrams > 0);
  if (onHand.length) {
    const grams = onHand.reduce((sum, row) => sum + row.onHandGrams, 0);
    const weighted = onHand.reduce((sum, row) => sum + landedUsdPerKg(row) * row.onHandGrams, 0) / grams;
    return { material, landedUsdPerKg: Math.round(weighted * 10000) / 10000, source: "inventory_weighted", inventoryIds: onHand.map(row => row.id), onHandGrams: grams, capturedAt };
  }
  if (active.length) {
    const [chosen] = [...active].sort((a, b) => Number(b.estimateDefault) - Number(a.estimateDefault) || String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
    return { material, landedUsdPerKg: Math.round(landedUsdPerKg(chosen) * 10000) / 10000, source: "inventory_latest", inventoryIds: [chosen.id], onHandGrams: 0, capturedAt };
  }
  return { ...fallbackMaterialCost(material, model), requestedMaterial: material, capturedAt };
}

export function presentFilament(row) {
  return { ...row, landedUsdPerKg: Math.round(landedUsdPerKg(row) * 100) / 100 };
}
