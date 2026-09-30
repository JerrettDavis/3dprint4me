import { HttpError } from "../../http.js";
import { PRINT_MATERIALS } from "../domain.js";
import { normalizeFilamentInput, presentFilament, selectEffectiveMaterialCost } from "../inventory.js";

export function createFilamentUseCases({ repository, now = () => new Date() }) {
  return {
    /** Operator-only view of the private cost basis and the cost each material would use now. */
    async list() {
      const rows = await repository.listFilament();
      const materials = [...new Set([...PRINT_MATERIALS, ...rows.map(row => row.material)])];
      return {
        items: rows.map(presentFilament),
        effective: Object.fromEntries(materials.map(material => [material, selectEffectiveMaterialCost(rows, material, { now: now() })]))
      };
    },
    async save(input, operator) {
      if (operator?.role !== "owner") throw new HttpError(403, "Only the owner can change filament cost basis.", { code: "owner_required" });
      return presentFilament(await repository.saveFilament(normalizeFilamentInput(input)));
    },
    /** Private material-cost snapshot for one estimate. */
    async materialCost(material) {
      return selectEffectiveMaterialCost(await repository.filamentForMaterial(material), material, { now: now() });
    }
  };
}
