import { randomUUID } from 'node:crypto';
import { HttpError } from '../http.js';
import { digest } from './postgres-repository.js';
import { uuid,iso,date } from './validation.js';
const COLUMNS=['record_id','record_kind','occurred_at_utc','partner_internal_id','work_order_id','expense_category','amount_cents','currency','accrual_status','payment_status','payment_date','payment_method','bank_reference','bonus_trigger_id','tax_reporting_class','receipt_ref','export_batch_id'];
export function csvCell(value){
 if(typeof value==='number'){if(!Number.isSafeInteger(value))throw new HttpError(503,'Accounting amount needs reconciliation.');return String(value);}
 let str=String(value??'');if(/^[\s\u0000-\u001f]*[=+@-]/.test(str.normalize('NFKC'))||/^[\t\r\n]/.test(str))str="'"+str;
 return '"'+str.replace(/"/g,'""')+'"';
}
export function accountingCsv(rows){return COLUMNS.map(csvCell).join(',')+'\r\n'+rows.map(r=>COLUMNS.map(k=>csvCell(r[k])).join(',')).join('\r\n')+(rows.length?'\r\n':'');}
function rendered(id,manifest){const csv=accountingCsv(manifest.rows);return {batchId:id,basis:manifest.basis,recordCount:manifest.rows.length,csv,sha256:digest(csv),filename:`partner-accounting-${id}.csv`,providerMode:'manual_csv',providerImportVerified:false};}
export function accountingCommands({repo,now}){
 return {'finance.export':{role:'OWNER',fields:['programId','basis','from','through'],run:async(tx,input,actor)=>{
  const program=await repo.lockProgram(tx,uuid(input.programId));if(!['cash','accrual'].includes(input.basis))throw new HttpError(400,'Choose the accounting basis approved by your accountant.');
  const from=input.from===undefined?null:date(input.from),through=input.through===undefined?null:date(input.through);
  if(from&&through&&from>through)throw new HttpError(400,'The accounting period must start before it ends.');
  const batchId=randomUUID();let records=[];
  if(input.basis==='accrual'){
   const payables=await tx.query`SELECT p.*,a.program_id FROM partner_payables p JOIN partner_accounts a ON a.id=p.partner_id WHERE a.program_id=${program.id} AND (${from}::date IS NULL OR p.occurred_at>=(${from}::date::timestamp AT TIME ZONE 'America/Chicago')) AND (${through}::date IS NULL OR p.occurred_at<((${through}::date+1)::timestamp AT TIME ZONE 'America/Chicago')) ORDER BY p.occurred_at,p.id LIMIT 10001`;
   records.push(...payables.map(p=>({sourceKind:'payable',sourceId:p.id,kind:'obligation',id:'payable:'+p.id,partnerId:p.partner_id,gigId:p.gig_id,bonusId:p.referral_event_id,amountCents:p.amount_cents,occurredAt:iso(p.occurred_at)})));
   const adjustments=await tx.query`SELECT j.*,p.partner_id,p.gig_id,p.referral_event_id FROM partner_payable_adjustments j JOIN partner_payables p ON p.id=j.payable_id JOIN partner_accounts a ON a.id=p.partner_id WHERE a.program_id=${program.id} AND (${from}::date IS NULL OR j.occurred_at>=(${from}::date::timestamp AT TIME ZONE 'America/Chicago')) AND (${through}::date IS NULL OR j.occurred_at<((${through}::date+1)::timestamp AT TIME ZONE 'America/Chicago')) ORDER BY j.occurred_at,j.id LIMIT 10001`;
   records.push(...adjustments.map(p=>({sourceKind:'adjustment',sourceId:p.id,kind:'obligation_adjustment',id:'adjustment:'+p.id,partnerId:p.partner_id,gigId:p.gig_id,bonusId:p.referral_event_id,amountCents:p.amount_cents,occurredAt:iso(p.occurred_at)})));
  }else{
   const payments=await tx.query`SELECT e.*,p.gig_id,p.referral_event_id FROM partner_payment_events e JOIN partner_payables p ON p.id=e.payable_id JOIN partner_accounts a ON a.id=e.partner_id WHERE a.program_id=${program.id} AND (${from}::date IS NULL OR e.occurred_at>=(${from}::date::timestamp AT TIME ZONE 'America/Chicago')) AND (${through}::date IS NULL OR e.occurred_at<((${through}::date+1)::timestamp AT TIME ZONE 'America/Chicago')) ORDER BY e.occurred_at,e.id LIMIT 10001`;
   records=payments.map(p=>({sourceKind:'payment',sourceId:p.id,kind:p.event_type,id:'payment:'+p.id,partnerId:p.partner_id,gigId:p.gig_id,bonusId:p.referral_event_id,amountCents:p.amount_cents,occurredAt:iso(p.occurred_at),reference:p.payment_reference,method:p.payment_method}));
  }
  if(records.length>10000)throw new HttpError(409,'This export requires a smaller accounting period.');
  const prior=await tx.query`SELECT source_kind,source_id FROM partner_export_entries WHERE program_id=${program.id} AND basis=${input.basis}`;
  const done=new Set(prior.map(r=>r.source_kind+':'+r.source_id));records=records.filter(r=>!done.has(r.sourceKind+':'+r.sourceId));
  const rows=records.map(r=>({record_id:r.id,record_kind:r.kind,occurred_at_utc:r.occurredAt,partner_internal_id:r.partnerId,work_order_id:r.gigId??'',expense_category:'pending_cpa_classification',amount_cents:r.amountCents,currency:'USD',accrual_status:input.basis==='accrual'?'recorded_obligation':'cash_event',payment_status:input.basis==='cash'?(r.amountCents>0?'verified_settlement':'reversal'):'not_a_payment',payment_date:input.basis==='cash'?r.occurredAt.slice(0,10):'',payment_method:r.method??'',bank_reference:r.reference??'',bonus_trigger_id:r.bonusId??'',tax_reporting_class:'review_required',receipt_ref:r.sourceId,export_batch_id:batchId}));
  const manifest={schemaVersion:1,basis:input.basis,from,through,generatedAt:now().toISOString(),rows};
  await tx.query`INSERT INTO partner_export_batches(id,actor_id,program_id,kind,manifest) VALUES(${batchId},${actor.id},${program.id},'accounting',${JSON.stringify(manifest)}::jsonb)`;
  for(const record of records)await tx.query`INSERT INTO partner_export_entries(id,program_id,batch_id,basis,source_kind,source_id) VALUES(${randomUUID()},${program.id},${batchId},${input.basis},${record.sourceKind},${record.sourceId})`;
  await repo.audit(tx,{programId:program.id,actor,action:'finance.exported',entityKind:'export',entityId:batchId,changes:{basis:input.basis,recordCount:rows.length}});
  return rendered(batchId,manifest);
 }}};
}
export async function readAccountingExport(tx,actor,input){
 if(actor.role!=='OWNER')throw new HttpError(404,'Export not found.');
 const [batch]=await tx.query`SELECT id,manifest FROM partner_export_batches WHERE id=${uuid(input.id)} AND kind='accounting'`;
 if(!batch)throw new HttpError(404,'Export not found.');return rendered(batch.id,batch.manifest);
}
