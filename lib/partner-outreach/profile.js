import { randomUUID } from 'node:crypto';
import { HttpError,isValidEmail } from '../http.js';
import { uuid,integer,text,iso } from './validation.js';
import { readPayables,financialRead } from './ledger.js';
import { csvCell } from './accounting.js';
import { digest } from './postgres-repository.js';
const jsonData=value=>JSON.parse(JSON.stringify(value));
function bounded(rows){if(rows.length>10000)throw new HttpError(409,'Request an owner-assisted export for this record volume.');return rows;}
export function profileCommands({repo,now}){
 return {
  'profile.update':{role:'PARTNER',fields:['expectedRevision','displayName','preferredContact','email','phone','accessibility','notificationOptOut'],run:async(tx,input,actor)=>{
   const [account]=await tx.query`SELECT profile,program_id,revision,display_name FROM partner_accounts WHERE id=${actor.id}`;
   if(account.revision!==integer(input.expectedRevision,1,2147483647))throw new HttpError(409,'Your profile has changed.');
   const profile={...account.profile},displayName=input.displayName===undefined?account.display_name:text(input.displayName,120);
   if(input.preferredContact!==undefined){if(!['none','email','phone'].includes(input.preferredContact))throw new HttpError(400,'Choose a contact preference.');profile.preferredContact=input.preferredContact;}
   if(input.email!==undefined){profile.email=text(input.email,254,{optional:true}).toLowerCase();if(profile.email&&!isValidEmail(profile.email))throw new HttpError(400,'Enter a valid email address.');}
   if(input.phone!==undefined){profile.phone=text(input.phone,40,{optional:true});if(profile.phone&&!/^[+\d ()-]{7,40}$/.test(profile.phone))throw new HttpError(400,'Enter a valid phone number.');}
   if(profile.preferredContact==='email'&&!profile.email||profile.preferredContact==='phone'&&!profile.phone)throw new HttpError(400,'Add your chosen contact method or choose no contact method.');
   if(input.accessibility!==undefined)profile.accessibility=text(input.accessibility,500,{optional:true});
   if(input.notificationOptOut!==undefined){if(typeof input.notificationOptOut!=='boolean')throw new HttpError(400,'Choose a notification preference.');profile.notificationOptOut=input.notificationOptOut;}
   if(profile.notificationOptOut===undefined)profile.notificationOptOut=true;
   await tx.query`UPDATE partner_accounts SET display_name=${displayName},profile=${JSON.stringify(profile)}::jsonb,revision=revision+1 WHERE id=${actor.id}`;
   await repo.audit(tx,{programId:account.program_id,actor,action:'profile.updated',entityKind:'partner',entityId:actor.id});return {id:actor.id,displayName,profile,revision:account.revision+1};
  }},
  'profile.export':{role:'PARTNER',fields:[],run:async(tx,input,actor)=>{
   const [profile]=await tx.query`SELECT id,program_id,display_name,status,profile,created_at FROM partner_accounts WHERE id=${actor.id}`;
   const data={profile,gigs:bounded(await tx.query`SELECT id,campaign_id,terms_snapshot,accepted_fee_cents,status,accepted_at,submitted_at,approved_at FROM partner_gigs WHERE partner_id=${actor.id} ORDER BY created_at,id LIMIT 10001`),visits:bounded(await tx.query`SELECT id,gig_id,business_name,outcome,details,visited_at FROM partner_visits WHERE partner_id=${actor.id} ORDER BY visited_at,id LIMIT 10001`),leads:bounded(await tx.query`SELECT id,visit_id,contact_data,purpose,consent_text,consent_at,withdrawn_at,deleted_at,status FROM partner_leads WHERE partner_id=${actor.id} ORDER BY created_at,id LIMIT 10001`),activities:bounded(await tx.query`SELECT id,started_at,ended_at,paused_at,running_since,elapsed_seconds FROM partner_activity_sessions WHERE partner_id=${actor.id} ORDER BY started_at,id LIMIT 10001`),agreements:bounded(await tx.query`SELECT id,version_id,snapshot_markdown,snapshot_sha256,issued_at FROM partner_agreement_issues WHERE partner_id=${actor.id} ORDER BY issued_at,id LIMIT 10001`),earnings:await financialRead(tx,actor,'earnings')};
   data.consentEvents=bounded(await tx.query`SELECT e.id,e.lead_id,e.event_type,e.evidence,e.created_at FROM partner_consent_events e JOIN partner_leads l ON l.id=e.lead_id WHERE l.partner_id=${actor.id} ORDER BY e.created_at,e.id LIMIT 10001`);
   data.materials=bounded(await tx.query`SELECT e.id,e.gig_id,e.event_type,e.items,e.created_at FROM partner_material_events e JOIN partner_gigs g ON g.id=e.gig_id WHERE g.partner_id=${actor.id} ORDER BY e.created_at,e.id LIMIT 10001`);
   data.workEvents=bounded(await tx.query`SELECT id,gig_id,event_type,actor_kind,reason,data,created_at FROM partner_work_events WHERE partner_id=${actor.id} ORDER BY created_at,id LIMIT 10001`);
   data.negotiations=bounded(await tx.query`SELECT id,gig_id,proposed_fee_cents,message,actor_id,created_at FROM partner_negotiations WHERE partner_id=${actor.id} ORDER BY created_at,id LIMIT 10001`);
   data.acknowledgments=bounded(await tx.query`SELECT id,issue_id,snapshot_sha256,acknowledged_at FROM partner_agreement_acknowledgments WHERE partner_id=${actor.id} ORDER BY acknowledged_at,id LIMIT 10001`);
   const snapshot=jsonData(data),batchId=randomUUID(),manifest={schemaVersion:1,partnerId:actor.id,generatedAt:now().toISOString(),data:snapshot};
   await tx.query`INSERT INTO partner_export_batches(id,actor_id,program_id,kind,manifest) VALUES(${batchId},${actor.id},${profile.program_id},'own_data',${JSON.stringify(manifest)}::jsonb)`;
   await repo.audit(tx,{programId:profile.program_id,actor,action:'profile.exported',entityKind:'export',entityId:batchId});
   return {batchId,filename:`partner-data-${batchId}.json`,generatedAt:manifest.generatedAt,data:snapshot};
  }},
  'statement.export':{role:['PARTNER','OWNER'],fields:['partnerId'],run:async(tx,input,actor)=>{
   const partnerId=actor.role==='PARTNER'?actor.id:uuid(input.partnerId);
   if(actor.role==='PARTNER'&&input.partnerId&&input.partnerId!==actor.id)throw new HttpError(404,'Partner not found.');
   const [account]=await tx.query`SELECT program_id FROM partner_accounts WHERE id=${partnerId}`;if(!account)throw new HttpError(404,'Partner not found.');
   const items=await readPayables(tx,{actor:{role:'PARTNER',id:partnerId}}),columns=['record_id','work_order_id','amount_due_cents','paid_cents','outstanding_cents','currency','status'];
   const csv=columns.map(csvCell).join(',')+'\r\n'+items.map(r=>[r.id,r.gigId??'',r.amountDueCents,r.paidCents,r.outstandingCents,'USD',r.status].map(csvCell).join(',')).join('\r\n')+(items.length?'\r\n':'');
   const batchId=randomUUID(),result={batchId,partnerId,filename:`partner-statement-${batchId}.csv`,csv,sha256:digest(csv),generatedAt:now().toISOString()};
   await tx.query`INSERT INTO partner_export_batches(id,actor_id,program_id,kind,manifest) VALUES(${batchId},${actor.id},${account.program_id},'statement',${JSON.stringify(result)}::jsonb)`;
   await repo.audit(tx,{programId:account.program_id,actor,action:'statement.exported',entityKind:'export',entityId:batchId});return result;
  }},
 };
}
export async function readOwnExport(tx,actor,input){
 if(actor.role!=='PARTNER')throw new HttpError(404,'Export not found.');
 const [row]=await tx.query`SELECT id,kind,manifest FROM partner_export_batches WHERE id=${uuid(input.id)} AND kind IN ('own_data','statement') AND manifest->>'partnerId'=${actor.id}`;
 if(!row)throw new HttpError(404,'Export not found.');
 return row.kind==='statement'?row.manifest:{batchId:row.id,filename:`partner-data-${row.id}.json`,generatedAt:row.manifest.generatedAt,data:row.manifest.data};
}
