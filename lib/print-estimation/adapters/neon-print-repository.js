import { HttpError } from "../../http.js";
import { queryNeon } from "../../neon.js";

const iso = value => value instanceof Date ? value.toISOString() : value ?? null;

function filamentFromRow(row) {
  return {
    id: row.id, material: row.material, brandLine: row.brand_line ?? null, color: row.color ?? null,
    spoolNominalGrams: Number(row.spool_nominal_grams), purchaseCostCents: Number(row.purchase_cost_cents),
    freightFeeCents: Number(row.freight_fee_cents), onHandGrams: Number(row.on_hand_grams),
    active: Boolean(row.active), estimateDefault: Boolean(row.estimate_default), notes: row.notes ?? null,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  };
}

export function createNeonPrintRepository({ query = queryNeon } = {}) {
  return {
    async listFilament() {
      const rows = await query`SELECT id, material, brand_line, color, spool_nominal_grams, purchase_cost_cents, freight_fee_cents,
          on_hand_grams, active, estimate_default, notes, created_at, updated_at
        FROM filament_inventory ORDER BY material, active DESC, updated_at DESC, id LIMIT 500`;
      return rows.map(filamentFromRow);
    },
    async filamentForMaterial(material) {
      const rows = await query`SELECT id, material, brand_line, color, spool_nominal_grams, purchase_cost_cents, freight_fee_cents,
          on_hand_grams, active, estimate_default, notes, created_at, updated_at
        FROM filament_inventory WHERE material = ${material} AND active = true ORDER BY updated_at DESC, id LIMIT 200`;
      return rows.map(filamentFromRow);
    },
    async saveFilament(input) {
      const rows = input.id
        ? await query`UPDATE filament_inventory SET material = ${input.material}, brand_line = ${input.brandLine}, color = ${input.color},
              spool_nominal_grams = ${input.spoolNominalGrams}, purchase_cost_cents = ${input.purchaseCostCents},
              freight_fee_cents = ${input.freightFeeCents}, on_hand_grams = ${input.onHandGrams}, active = ${input.active},
              estimate_default = ${input.estimateDefault}, notes = ${input.notes}, updated_at = now()
            WHERE id = ${input.id} RETURNING *`
        : await query`INSERT INTO filament_inventory (material, brand_line, color, spool_nominal_grams, purchase_cost_cents,
              freight_fee_cents, on_hand_grams, active, estimate_default, notes)
            VALUES (${input.material}, ${input.brandLine}, ${input.color}, ${input.spoolNominalGrams}, ${input.purchaseCostCents},
              ${input.freightFeeCents}, ${input.onHandGrams}, ${input.active}, ${input.estimateDefault}, ${input.notes}) RETURNING *`;
      if (!rows.length) throw new HttpError(404, "Filament was not found.");
      return filamentFromRow(rows[0]);
    }
  };
}
