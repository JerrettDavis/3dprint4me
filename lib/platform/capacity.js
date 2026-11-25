import { queryDatabase } from '../database.js';
import { ratePolicyFromEnv, GLOBAL_SUBJECT, RATE_SCOPES } from '../print-estimation/application/rate-limit.js';
const number = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
/** Runtime-role aggregates only. Optional reads never change health evidence. */
export async function collectLocalCapacity({query=queryDatabase,env=process.env,now=Date.now()}={}) {
  const observedAt=Number(now),policy=ratePolicyFromEnv(env),windowMs=policy.windowSeconds*1000;
  const periodStart=Math.floor(observedAt/windowMs)*windowMs,periodEnd=periodStart+windowMs;
  const record=(id,used,limit,application=false)=>({id,used:number(used),limit:number(limit),observedAt,periodStart:application?periodStart:null,periodEnd:application?periodEnd:null,source:application?'application':'local',scope:application?'application':'host'});
  const records=[record('db-size',null,null),record('db-connections',null,null)];
  try { const [row]=await query`SELECT pg_database_size(current_database()) AS used`;records[0].used=number(row?.used); } catch { /* unavailable aggregate */ }
  try { const [row]=await query`SELECT count(*) AS used, current_setting('max_connections')::bigint AS limit FROM pg_stat_activity`;records[1].used=number(row?.used);records[1].limit=number(row?.limit); } catch { /* unavailable aggregate */ }
  let counts;
  try { counts=await query`SELECT scope, SUM(hits) AS used FROM print_estimate_rate_buckets WHERE subject = ${GLOBAL_SUBJECT} AND window_start = ${new Date(periodStart).toISOString()}::timestamptz AND scope IN (${RATE_SCOPES[0]}, ${RATE_SCOPES[1]}) GROUP BY scope`; } catch { /* configured caps still reported */ }
  for(const [scope,name] of [['session-create','sessions'],['upload-token','uploads']]) {
    const row=counts?.find(row=>row.scope===scope);
    records.push(record(`rate-${name}-global`,counts?(row?.used??0):null,policy[scope].global,true),record(`rate-${name}-client`,null,policy[scope].perClient,true));
  }
  return records;
}
