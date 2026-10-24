import { randomUUID } from 'node:crypto';
import { readPayables } from './ledger.js';
import { createPostgresPartnerRepository,digest } from './postgres-repository.js';
import { uuid,integer,iso } from './validation.js';
import { HttpError } from '../http.js';
import { authorizationWeek } from './policy.js';
import { csvCell } from './accounting.js';

export function nextStatementWeek(instant) {
 const date=new Date(authorizationWeek(instant)+'T00:00:00Z');
 date.setUTCDate(date.getUTCDate()+7);
 return date.toISOString().slice(0,10);
}
export function statementWeek(schedule,instant) {
 if(!schedule||schedule.enabled!==true)return null;
 const first=schedule.firstDueWeek;
 if(typeof first!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(first)||!Number.isFinite(Date.parse(first+'T00:00Z'))||new Date(first+'T00:00Z').toISOString().slice(0,10)!==first||new Date(first+'T00:00Z').getUTCDay()!==1)throw new HttpError(503,'Statement scheduling needs owner reconciliation.');
 const current=authorizationWeek(instant);
 return current>=first?current:null;
}
export function statementCsv(items) {
 const columns=['record_id','work_order_id','amount_due_cents','paid_cents','outstanding_cents','currency','status'];
 return columns.map(csvCell).join(',')+'\r\n'+items.map(r=>[r.id,r.gigId??'',r.amountDueCents,r.paidCents,r.outstandingCents,'USD',r.status].map(csvCell).join(',')).join('\r\n')+(items.length?'\r\n':'');
}

export function statementCommands({repo,now}) {
 return {'statement.schedule':{role:'OWNER',fields:['programId','expectedRevision','enabled'],run:async(tx,input,actor)=>{
  if(typeof input.enabled!=='boolean')throw new HttpError(400,'Choose whether weekly statements are scheduled.');
  const program=await repo.lockProgram(tx,uuid(input.programId));
  if(program.revision!==integer(input.expectedRevision,1,2147483647))throw new HttpError(409,'This program has changed. Refresh and review it again.');
  const previous=program.settings.weeklyStatements;
  let firstDueWeek=previous?.firstDueWeek??null;
  if(input.enabled){
   if(previous?.enabled===true)statementWeek(previous,now());
   else firstDueWeek=nextStatementWeek(now());
  }
  const schedule={enabled:input.enabled,firstDueWeek};
  await tx.query`UPDATE partner_programs SET settings=${JSON.stringify({...program.settings,weeklyStatements:schedule})}::jsonb,revision=revision+1 WHERE id=${program.id}`;
  await repo.audit(tx,{programId:program.id,actor,action:'statement.scheduled',entityKind:'program',entityId:program.id,changes:schedule});
  return {programId:program.id,revision:program.revision+1,...schedule};
 }}};
}
const metadata=row=>({id:row.id,programId:row.program_id,partnerId:row.partner_id,weekStart:String(iso(row.week_start_local)).slice(0,10),generatedAt:iso(row.generated_at),asOf:iso(row.generated_at),recordCount:row.record_count,sha256:row.sha256});
export async function readStatements(tx,actor,input={}) {
 if(actor.role==='PARTNER'&&input.programId)throw new HttpError(404,'Statement not found.');
 if(!['OWNER','PARTNER'].includes(actor.role))throw new HttpError(404,'Statement not found.');
 const partnerId=actor.role==='PARTNER'?actor.id:null,programId=input.programId?uuid(input.programId):null;
 if(input.id&&input.before)throw new HttpError(400,'Choose a statement or a history page.');
 if(input.id){
  const [row]=await tx.query`SELECT * FROM partner_weekly_statements WHERE id=${uuid(input.id)} AND (${partnerId}::uuid IS NULL OR partner_id=${partnerId}::uuid) AND (${programId}::uuid IS NULL OR program_id=${programId}::uuid)`;
  if(!row)throw new HttpError(404,'Statement not found.');
  if(digest(row.csv)!==row.sha256)throw new HttpError(503,'Statement integrity verification failed.');
  return {...metadata(row),filename:`partner-weekly-statement-${row.id}.csv`,csv:row.csv};
 }
 const before=input.before?uuid(input.before):null;
 let beforeWeek=null;
 if(before){
  const [cursor]=await tx.query`SELECT week_start_local FROM partner_weekly_statements WHERE id=${before} AND (${partnerId}::uuid IS NULL OR partner_id=${partnerId}::uuid) AND (${programId}::uuid IS NULL OR program_id=${programId}::uuid)`;
  if(!cursor)throw new HttpError(404,'Statement not found.');
  beforeWeek=String(iso(cursor.week_start_local)).slice(0,10);
 }
 const rows=await tx.query`SELECT id,program_id,partner_id,week_start_local,generated_at,record_count,sha256 FROM partner_weekly_statements WHERE (${partnerId}::uuid IS NULL OR partner_id=${partnerId}::uuid) AND (${programId}::uuid IS NULL OR program_id=${programId}::uuid) AND (${before}::uuid IS NULL OR (week_start_local,id)<(${beforeWeek}::date,${before}::uuid)) ORDER BY week_start_local DESC,id DESC LIMIT 101`;
 const items=rows.slice(0,100).map(metadata),result={items,nextCursor:rows.length>100?items.at(-1).id:null};
 if(actor.role==='OWNER'){
  const programs=await tx.query`SELECT id,label,revision,settings FROM partner_programs WHERE (${programId}::uuid IS NULL OR id=${programId}::uuid) ORDER BY created_at,id LIMIT 1001`;
  if(programs.length>1000)throw new HttpError(409,'Choose a smaller program scope.');
  result.schedules=programs.map(p=>({programId:p.id,label:p.label,revision:p.revision,enabled:p.settings.weeklyStatements?.enabled===true,firstDueWeek:p.settings.weeklyStatements?.firstDueWeek??null}));
 }
 return result;
}
export async function generateWeeklyStatements({database,now=()=>new Date(),batchSize=20}) {
 integer(batchSize,1,100);
 const instant=new Date(now()),current=authorizationWeek(instant),repo=createPostgresPartnerRepository({database});
 const [schema]=await database.query`SELECT to_regclass('public.partner_weekly_statements') IS NOT NULL AS ready`;
 if(!schema.ready)return {claimed:0,generated:0,skipped:0};
 const programs=await database.query`SELECT id,settings FROM partner_programs WHERE settings->'weeklyStatements'->'enabled'='true'::jsonb ORDER BY id LIMIT 1001`;
 if(programs.length>1000)throw new Error('Weekly statement scope requires reconciliation.');
 const eligible=programs.filter(p=>statementWeek(p.settings.weeklyStatements,instant)!==null).map(p=>p.id);
 if(!eligible.length)return {claimed:0,generated:0,skipped:0};
 const candidates=await database.query`SELECT a.id,a.program_id FROM partner_accounts a WHERE a.program_id=ANY(${eligible}::uuid[]) AND (a.credential_hash IS NOT NULL OR EXISTS(SELECT 1 FROM partner_payables p WHERE p.partner_id=a.id)) AND NOT EXISTS(SELECT 1 FROM partner_weekly_statements s WHERE s.partner_id=a.id AND s.week_start_local=${current}::date) ORDER BY a.program_id,a.id LIMIT ${batchSize}`;
 let generated=0,skipped=0,failed=0;
 for(const candidate of candidates){
  try{
   const created=await database.withTransaction(async tx=>{
    // Financial writers use account -> program. Never acquire the account after
    // holding its program; this also serializes multiple scheduler processes.
    const [account]=await tx.query`SELECT id,program_id,credential_hash FROM partner_accounts WHERE id=${candidate.id} FOR UPDATE`;
    if(!account)return false;
    const program=await repo.lockProgram(tx,account.program_id);
    const snapshotAt=new Date(now());
    const week=statementWeek(program.settings.weeklyStatements,snapshotAt);
    if(week!==current)return false;
    const [existing]=await tx.query`SELECT id FROM partner_weekly_statements WHERE partner_id=${account.id} AND week_start_local=${week}::date`;
    if(existing)return false;
    const items=await readPayables(tx,{actor:{role:'PARTNER',id:account.id}});
    if(account.credential_hash===null&&!items.length)return false;
    const id=randomUUID(),csv=statementCsv(items),sha256=digest(csv);
    await tx.query`INSERT INTO partner_weekly_statements(id,program_id,partner_id,week_start_local,generated_at,record_count,csv,sha256) VALUES(${id},${program.id},${account.id},${week}::date,${snapshotAt.toISOString()},${items.length},${csv},${sha256})`;
    await repo.audit(tx,{programId:program.id,actor:{role:'SYSTEM',id:'weekly-statements'},action:'statement.generated',entityKind:'statement',entityId:id,changes:{weekStart:week,recordCount:items.length}});
    return true;
   });
   if(created)generated++;else skipped++;
  }catch{failed++;}
 }
 if(failed)throw new Error('Weekly statement generation unavailable.');
 return {claimed:candidates.length,generated,skipped};
}
