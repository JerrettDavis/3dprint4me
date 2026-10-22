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
        spoolmanUiOrigin: humanOrigin(process.env.SPOOLMAN_UI_ORIGIN),
        sync: repository.getSpoolmanStatus ? await repository.getSpoolmanStatus() : { configured: false },
        items: rows.map(presentFilament),
        effective: Object.fromEntries(materials.map(material => [material, selectEffectiveMaterialCost(rows, material, { now: now() })]))
      };
    },
    async save(input, operator) {
      if (operator?.role !== "owner") throw new HttpError(403, "Only the owner can change filament cost basis.", { code: "owner_required" });
      return presentFilament(await repository.saveFilament(normalizeFilamentInput(input)));
    },
    async refresh(operator) {
      if (operator?.role !== 'owner') throw new HttpError(403,'Only the owner can refresh Spoolman inventory.');
      return repository.requestSpoolmanSync({operatorId:operator.id});
    },
    async saveImported(input, operator) {
      if (operator?.role !== 'owner') throw new HttpError(403,'Only the owner can change filament costs.');
      const fail=()=>{throw new HttpError(400,'Supply only local filament fields with valid values.');};
      if (!input || Object.keys(input).some(k=>!['id','revision','local'].includes(k)) || !/^fil_[A-Za-z0-9_-]{8,64}$/.test(input.id ?? '') || !Number.isSafeInteger(input.revision) || input.revision<1) fail();
      const value=input.local;
      if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(k=>!['notes','freightFeeCents','estimateDefault','costOverrideCents'].includes(k))) fail();
      if (typeof value.estimateDefault!=='boolean' || !Number.isInteger(value.freightFeeCents) || value.freightFeeCents<0 || value.freightFeeCents>10000000 || value.costOverrideCents!==null && (!Number.isInteger(value.costOverrideCents) || value.costOverrideCents<0 || value.costOverrideCents>10000000) || value.notes!==null && (typeof value.notes!=='string' || value.notes.length>1000)) fail();
      const saved=await repository.saveImportedFilament({...input,local:{...value,notes:value.notes?.replace(/[\u0000-\u001f\u007f]/g,' ').trim() || null}});
      const status=await repository.getSpoolmanStatus();
      return presentFilament({...saved,source:{...saved.source,lastSuccessAt:status.lastSuccessAt,enabled:status.configured}});
    },
    /** Private material-cost snapshot for one estimate. */
    async materialCost(material) {
      return selectEffectiveMaterialCost(await repository.filamentForMaterial(material), material, { now: now() });
    }
  };
}

function humanOrigin(value) {
  if (!value) return null;
  try { const url=new URL(value); return url.protocol==='https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname==='/' ? url.origin : null; } catch { return null; }
}
