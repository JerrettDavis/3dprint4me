import { randomUUID } from 'node:crypto';
import { HttpError,isValidEmail } from '../http.js';
import { digest } from './postgres-repository.js';
import { exact,text,integer,uuid,timestamp,iso } from './validation.js';
export const CONSENT_VERSION='follow-up-permission-v1';
export const CONSENT_TEXT='I agree that 3dprint4.me may contact me about the stated project using my chosen contact method. I can withdraw this permission by contacting the owner.';
function contactData(value) {
 exact(value,['name','email','phone','preferredContact']);const result={};
 if(value.name)result.name=text(value.name,160);
 if(value.email){result.email=text(value.email,254).toLowerCase();if(!isValidEmail(result.email))throw new HttpError(422,'Enter a valid email address.');}
 if(value.phone){const digits=text(value.phone,40).replace(/[ ()+.-]/g,'');if(!/^\d{7,15}$/.test(digits))throw new HttpError(422,'Enter a valid phone number.');result.phone='+'+(digits.length===10?'1':'')+digits;}
 if(!['email','phone'].includes(value.preferredContact)||!result[value.preferredContact])throw new HttpError(422,'Choose a supplied follow-up contact method.');
 result.preferredContact=value.preferredContact;return result;
}
export function visitCommands({repo,now}) {
 async function lead(tx,actor,id){
  const rows=actor.role==='OWNER'?await tx.query`SELECT l.*,a.program_id,v.gig_id FROM partner_leads l JOIN partner_accounts a ON a.id=l.partner_id JOIN partner_visits v ON v.id=l.visit_id WHERE l.id=${uuid(id)} FOR UPDATE OF l`:await tx.query`SELECT l.*,a.program_id,v.gig_id FROM partner_leads l JOIN partner_accounts a ON a.id=l.partner_id JOIN partner_visits v ON v.id=l.visit_id WHERE l.id=${uuid(id)} AND l.partner_id=${actor.id} FOR UPDATE OF l`;
  if(!rows[0])throw new HttpError(404,'Lead not found.');return rows[0];
 }
 const result={
  'visit.record':{role:'PARTNER',fields:['gigId','expectedGigRevision','clientId','businessName','approximateArea','outcome','placement','sampleCount','visitedAt','consent','contact','consentPurpose'],run:async(tx,input,actor)=>{
   const gig=await repo.getGig(tx,{actor,gigId:uuid(input.gigId),lock:true});
   if(gig.revision!==integer(input.expectedGigRevision,1,2147483647)||!['accepted','changes_requested'].includes(gig.status))throw new HttpError(409,'This gig has changed. Review it before submitting a visit.');
   if(typeof input.consent!=='boolean')throw new HttpError(422,'Record follow-up permission explicitly.');
   if(!input.consent&&(input.contact||input.consentPurpose))throw new HttpError(422,'Personal contact details require specific follow-up permission.');
   const business=text(input.businessName,200),businessKey=business.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
   if(!businessKey)throw new HttpError(400,'Enter a business name.');
   if(!['interested','accepted_material','declined','unavailable'].includes(input.outcome)||!['none','permission_received','declined','no_soliciting'].includes(input.placement))throw new HttpError(422,'Choose a permitted visit outcome and placement.');
   const count=integer(input.sampleCount??0,0,1000),area=text(input.approximateArea,200,{optional:true}),visitedAt=timestamp(input.visitedAt);
   if(new Date(visitedAt)>new Date(now().getTime()+300000)||new Date(visitedAt)<new Date(gig.accepted_at))throw new HttpError(422,'Visit time must be after acceptance and cannot be in the future.');
   if((input.outcome==='accepted_material'||count>0)&&input.placement!=='permission_received')throw new HttpError(422,'Materials may be placed only with permission.');
   if(input.placement==='no_soliciting'&&(!['declined','unavailable'].includes(input.outcome)||count>0))throw new HttpError(422,'Respect no-soliciting restrictions without distributing materials.');
   const contact=input.consent?contactData(input.contact):null,purpose=input.consent?text(input.consentPurpose,500):null,id=randomUUID();
   const [visit]=await tx.query`INSERT INTO partner_visits(id,gig_id,partner_id,client_created_id,business_name,business_key,outcome,details,visited_at) VALUES(${id},${gig.id},${actor.id},${uuid(input.clientId)},${business},${businessKey},${input.outcome},${JSON.stringify({area,placement:input.placement,sampleCount:count})}::jsonb,${visitedAt}) ON CONFLICT DO NOTHING RETURNING id`;
   if(!visit)throw new HttpError(409,'This business visit is already recorded.');
   let leadId=null;
   if(contact){
    leadId=randomUUID();const contactKey=digest(contact.email??contact.phone);
    const [created]=await tx.query`INSERT INTO partner_leads(id,visit_id,partner_id,contact_data,contact_key,consent_text,purpose,consent_at) VALUES(${leadId},${id},${actor.id},${JSON.stringify(contact)}::jsonb,${contactKey},${CONSENT_TEXT},${purpose},${now().toISOString()}) ON CONFLICT DO NOTHING RETURNING id`;
    if(!created)throw new HttpError(409,'This follow-up contact is already recorded. Ask the owner to review the existing contact.');
    await tx.query`INSERT INTO partner_consent_events(id,lead_id,actor_id,event_type,evidence) VALUES(${randomUUID()},${leadId},${actor.id},'granted',${JSON.stringify({version:CONSENT_VERSION,consentText:CONSENT_TEXT,purpose,sourceVisitId:id})}::jsonb)`;
   }
   await repo.audit(tx,{programId:gig.program_id,actor,action:'visit.recorded',entityKind:'visit',entityId:id,changes:{gigId:gig.id,consentedLead:!!leadId,consentVersion:leadId?CONSENT_VERSION:null}});return {id,leadId,status:'recorded'};
  }},
  'lead.review':{role:'OWNER',fields:['leadId','expectedRevision','decision','reason'],run:async(tx,input,actor)=>{
   const row=await lead(tx,actor,input.leadId);if(row.revision!==integer(input.expectedRevision,1,2147483647)||row.withdrawn_at||row.deleted_at)throw new HttpError(409,'This lead is no longer eligible for follow-up review.');
   if(!['qualified','rejected'].includes(input.decision))throw new HttpError(400,'Choose a lead review decision.');const reason=text(input.reason,2000);
   await tx.query`UPDATE partner_leads SET status=${input.decision},revision=revision+1 WHERE id=${row.id}`;
   await tx.query`INSERT INTO partner_work_events(id,program_id,gig_id,partner_id,event_type,actor_kind,actor_id,reason,data) VALUES(${randomUUID()},${row.program_id},${row.gig_id},${row.partner_id},'lead.reviewed',${actor.role},${actor.id},${reason},${JSON.stringify({leadId:row.id,decision:input.decision})}::jsonb)`;
   await repo.audit(tx,{programId:row.program_id,actor,action:'lead.reviewed',entityKind:'lead',entityId:row.id,changes:{decision:input.decision}});return {id:row.id,status:input.decision,revision:row.revision+1};
  }},
 };
 for(const action of ['withdraw','delete','correct'])result['lead.'+action]={role:['OWNER','PARTNER'],fields:['leadId','expectedRevision',...(action==='correct'?['contact','consent','consentPurpose']:[])],run:async(tx,input,actor)=>{
  const row=await lead(tx,actor,input.leadId);if(row.revision!==integer(input.expectedRevision,1,2147483647)||row.deleted_at)throw new HttpError(409,'This lead has changed.');
  let changeEvidence={};
  if(action==='correct'){
   if(row.withdrawn_at)throw new HttpError(409,'Withdrawn permission cannot be renewed by editing contact details.');
   const contact=contactData(input.contact),key=digest(contact.email??contact.phone);
   const changed=contact.email!==row.contact_data.email||contact.phone!==row.contact_data.phone;
   if(changed&&(input.consent!==true||typeof input.consentPurpose!=='string'||!input.consentPurpose.trim()))throw new HttpError(422,'A corrected email or phone requires renewed purpose-specific permission.');
   const purpose=changed?text(input.consentPurpose,500):row.purpose;
   changeEvidence={version:CONSENT_VERSION,consentText:changed?CONSENT_TEXT:row.consent_text,renewedPermission:changed};
   try{await tx.query`UPDATE partner_leads SET contact_data=${JSON.stringify(contact)}::jsonb,contact_key=${key},purpose=${purpose},consent_text=CASE WHEN ${changed} THEN ${CONSENT_TEXT} ELSE consent_text END,consent_at=CASE WHEN ${changed} THEN ${now().toISOString()}::timestamptz ELSE consent_at END,status=CASE WHEN ${changed} THEN 'needs_review' ELSE status END,revision=revision+1 WHERE id=${row.id}`;}catch(error){if(error.code==='23505')throw new HttpError(409,'This follow-up contact is already recorded.');throw error;}
  }else{
   const time=now().toISOString();
   await tx.query`UPDATE partner_leads SET withdrawn_at=COALESCE(withdrawn_at,${time}::timestamptz),deleted_at=CASE WHEN ${action}='delete' THEN ${time}::timestamptz ELSE deleted_at END,contact_data=CASE WHEN ${action}='delete' THEN '{}'::jsonb ELSE contact_data END,status=${action==='delete'?'deleted':'withdrawn'},revision=revision+1 WHERE id=${row.id}`;
  }
  await tx.query`INSERT INTO partner_consent_events(id,lead_id,actor_id,event_type,evidence) VALUES(${randomUUID()},${row.id},${actor.id},${action==='withdraw'?'withdrawn':action==='delete'?'deleted':'corrected'},${JSON.stringify(changeEvidence)}::jsonb)`;
  await repo.audit(tx,{programId:row.program_id,actor,action:'lead.'+action,entityKind:'lead',entityId:row.id});return {id:row.id,revision:row.revision+1};
 }};
 return result;
}
export async function readVisits(tx,actor,resource){
 if(resource==='visits'){
  const rows=actor.role==='PARTNER'?await tx.query`SELECT id,gig_id,business_name,outcome,details,visited_at,revision FROM partner_visits WHERE partner_id=${actor.id} ORDER BY visited_at DESC,id LIMIT 1000`:await tx.query`SELECT id,gig_id,partner_id,business_name,outcome,details,visited_at,revision FROM partner_visits ORDER BY visited_at DESC,id LIMIT 1000`;
  return {items:rows};
 }
 if(resource==='leads'){
  const rows=actor.role==='PARTNER'?await tx.query`SELECT id,visit_id,contact_data,purpose,consent_text,consent_at,withdrawn_at,deleted_at,status,revision FROM partner_leads WHERE partner_id=${actor.id} ORDER BY created_at DESC,id LIMIT 1000`:await tx.query`SELECT id,partner_id,visit_id,contact_data,purpose,consent_text,consent_at,withdrawn_at,deleted_at,status,revision FROM partner_leads ORDER BY created_at DESC,id LIMIT 1000`;
  return {items:rows.map(row=>({id:row.id,partnerId:row.partner_id??actor.id,visitId:row.visit_id,contact:row.contact_data,purpose:row.purpose,consentText:row.consent_text,consentAt:iso(row.consent_at),withdrawnAt:iso(row.withdrawn_at)??null,deletedAt:iso(row.deleted_at)??null,status:row.status,revision:row.revision,followUpAllowed:row.status==='qualified'&&!row.withdrawn_at&&!row.deleted_at}))};
 }
 return null;
}
