import { HttpError } from '../../http.js';
const conflict = () => new HttpError(409, 'Filament data changed. Refresh before saving.');
const iso = v => v instanceof Date ? v.toISOString() : v ?? null;
export function createPostgresSpoolmanRepository({query,withTransaction,mapFilament}) {
  return {
    async getSpoolmanStatus() {
      const [row] = await query`SELECT instance_id,last_attempt_at,last_success_at,failure_code,spool_count,currency,requested_at,lease_until FROM spoolman_sync_state WHERE id=1`;
      return row ? {configured:true,instanceId:row.instance_id,lastAttemptAt:iso(row.last_attempt_at),lastSuccessAt:iso(row.last_success_at),failureCode:row.failure_code,count:Number(row.spool_count ?? 0),currency:row.currency,requestedAt:iso(row.requested_at),leaseUntil:iso(row.lease_until)} : {configured:false,lastSuccessAt:null};
    },
    async claimSpoolmanSync({instanceId,token,attemptedAt,leaseUntil}) {
      const rows=await query`INSERT INTO spoolman_sync_state(id,instance_id,token,last_attempt_at,lease_until) VALUES(1,${instanceId},${token},${attemptedAt},${leaseUntil})
        ON CONFLICT(id) DO UPDATE SET token=EXCLUDED.token,last_attempt_at=EXCLUDED.last_attempt_at,lease_until=EXCLUDED.lease_until,requested_at=NULL
        WHERE spoolman_sync_state.instance_id=EXCLUDED.instance_id AND (spoolman_sync_state.token IS NULL OR spoolman_sync_state.lease_until<=EXCLUDED.last_attempt_at) RETURNING id`;
      return rows.length===1;
    },
    async applySpoolmanSnapshot({instanceId,token,snapshot,completedAt}) {
      await withTransaction(async({query:sql})=>{
        const rows=await sql`SELECT id FROM spoolman_sync_state WHERE id=1 AND instance_id=${instanceId} AND token=${token} AND lease_until>${completedAt}::timestamptz FOR UPDATE`;
        if(!rows.length)throw conflict();
        for(const row of snapshot.items) {
          await sql`INSERT INTO filament_inventory(material,brand_line,color,color_hex,spool_nominal_grams,purchase_cost_cents,on_hand_grams,active,source)
            VALUES(${row.material},${row.brandLine},${row.color},${row.colorHex},${row.spoolNominalGrams},${row.purchaseCostCents},${row.onHandGrams},${row.active},${JSON.stringify(row.source)}::jsonb)
            ON CONFLICT((source->>'instanceId'),(source->>'spoolId')) WHERE source IS NOT NULL DO UPDATE SET material=EXCLUDED.material,brand_line=EXCLUDED.brand_line,color=EXCLUDED.color,color_hex=EXCLUDED.color_hex,
              spool_nominal_grams=EXCLUDED.spool_nominal_grams,purchase_cost_cents=EXCLUDED.purchase_cost_cents,on_hand_grams=EXCLUDED.on_hand_grams,active=EXCLUDED.active,source=EXCLUDED.source,revision=filament_inventory.revision+1,updated_at=${completedAt}::timestamptz
            WHERE filament_inventory.source IS DISTINCT FROM EXCLUDED.source OR filament_inventory.active IS DISTINCT FROM EXCLUDED.active`;
        }
        const ids=snapshot.items.map(row=>String(row.source.spoolId));
        await sql`UPDATE filament_inventory SET active=false,revision=revision+1,updated_at=${completedAt}::timestamptz WHERE source->>'instanceId'=${instanceId} AND active AND NOT(source->>'spoolId'=ANY(${ids}::text[]))`;
        await sql`UPDATE spoolman_sync_state SET token=NULL,lease_until=NULL,last_success_at=${completedAt}::timestamptz,failure_code=NULL,spool_count=${snapshot.items.length},currency=${snapshot.currency} WHERE id=1 AND token=${token}`;
      });
      return this.getSpoolmanStatus();
    },
    async failSpoolmanSync({token,code}) { await query`UPDATE spoolman_sync_state SET token=NULL,lease_until=NULL,failure_code=${code} WHERE id=1 AND token=${token}`; },
    async requestSpoolmanSync({operatorId}) {
      const rows=await query`UPDATE spoolman_sync_state SET requested_at=now(),requested_by=${operatorId} WHERE id=1 RETURNING id`;
      if(!rows.length)throw new HttpError(503,'Spoolman is not configured.');
      return {queued:true};
    },
    async saveImportedFilament({id,revision,local}) {
      const rows=await query`UPDATE filament_inventory SET notes=${local.notes},freight_fee_cents=${local.freightFeeCents},estimate_default=${local.estimateDefault},cost_override_cents=${local.costOverrideCents},revision=revision+1,updated_at=now() WHERE id=${id} AND revision=${revision} AND source IS NOT NULL RETURNING *`;
      if(!rows.length)throw conflict();
      return mapFilament(rows[0]);
    }
  };
}
