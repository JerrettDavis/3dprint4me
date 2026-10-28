import {REFERRAL_CONSENT_VERSION} from '../../public/assets/js/order/referral.js';
import { randomUUID,randomBytes } from 'node:crypto';
import { HttpError } from '../http.js';
import { canonicalJson,digest } from './postgres-repository.js';
import { freezeOffer } from './domain.js';
import { uuid,text,timestamp,integer,iso } from './validation.js';

const civil=instant=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant)).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}`;};
function identityKeys(contact){
 const keys=[];if(contact.email)keys.push('email:'+digest(contact.email.normalize('NFKC').toLowerCase()));
 if(contact.phone){let digits=contact.phone.replace(/\D/g,'');if(digits.length===10)digits='1'+digits;if(digits)keys.push('phone:'+digest('+'+digits));}return keys;
}
async function participantMatch(tx,keys){
 const rows=await tx.query`SELECT profile FROM partner_accounts WHERE profile ? 'email' OR profile ? 'phone' LIMIT 10001`;
 if(rows.length>10000)throw new HttpError(503,'Participant identity checks need owner reconciliation.');
 const source=new Set(keys);return rows.some(row=>identityKeys(row.profile).some(key=>source.has(key)));
}
export async function issueReferral(tx,gig,instant){
 const terms=freezeOffer(gig.terms_snapshot);if(!terms.bonusRules.length)return null;
 const policy={schemaVersion:1,gigId:gig.id,programId:gig.program_id,termsHash:digest(canonicalJson(terms)),bonusRules:terms.bonusRules},hash=digest(canonicalJson(policy)),id=randomUUID(),code=randomBytes(12).toString('base64url');
 await tx.query`INSERT INTO partner_referrals(id,partner_id,program_id,code,originating_gig_id,policy_snapshot,policy_sha256,created_at) VALUES(${id},${gig.partner_id},${gig.program_id},${code},${gig.id},${JSON.stringify(policy)}::jsonb,${hash},${instant.toISOString()})`;
 return {id,code,policyHash:hash};
}
export async function recordLeadQualification(tx,row,actor,instant){
 const [prior]=await tx.query`SELECT id FROM partner_lead_qualifications WHERE lead_id=${row.id}`;if(prior)return prior.id;
 const [consent]=await tx.query`SELECT id,evidence FROM partner_consent_events WHERE lead_id=${row.id} AND event_type IN ('granted','corrected') ORDER BY created_at DESC,id DESC LIMIT 1`;
 if(!consent)throw new HttpError(409,'Qualification requires recorded contact permission.');
 const keys=identityKeys(row.contact_data);
 const evidence={sourceVisitId:row.visit_id,consentEventId:consent.id,consentVersion:consent.evidence.version,consentAt:iso(row.consent_at),leadRevision:row.revision,participantMatch:await participantMatch(tx,keys)},id=randomUUID();
 await tx.query`INSERT INTO partner_lead_qualifications(id,lead_id,partner_id,program_id,gig_id,identity_keys,evidence,qualified_at,verified_by) VALUES(${id},${row.id},${row.partner_id},${row.program_id},${row.gig_id},${JSON.stringify(keys)}::jsonb,${JSON.stringify(evidence)}::jsonb,${instant.toISOString()},${actor.id})`;
 return id;
}
export function referralCommands({repo,now}){
 async function lock(tx,id){
  const [ref]=await tx.query`SELECT * FROM partner_referrals WHERE id=${uuid(id)}`;if(!ref)throw new HttpError(404,'Referral not found.');
  await tx.query`SELECT id FROM partner_accounts WHERE id=${ref.partner_id} FOR UPDATE`;await repo.lockProgram(tx,ref.program_id);
  const gig=await repo.getGig(tx,{actor:{role:'OWNER'},gigId:ref.originating_gig_id,lock:true}),terms=freezeOffer(gig.terms_snapshot);
  if(!gig.accepted_at||digest(canonicalJson(ref.policy_snapshot))!==ref.policy_sha256||ref.policy_snapshot.termsHash!==digest(canonicalJson(terms))||terms.maximumBonusCents!==gig.maximum_bonus_cents)throw new HttpError(503,'The reserved bonus record needs reconciliation.');
  return {ref,gig,terms};
 }
 const owner=(fields,run)=>({role:'OWNER',fields,run});
 return {
  'referral.attribute':owner(['referralId','requestId','consentedAt','consentVerified','independentCustomerConfirmed','evidenceReference'],async(tx,input,actor)=>{
   const {ref,gig}=await lock(tx,input.referralId),requestId=text(input.requestId,200),at=timestamp(input.consentedAt);
   if(input.consentVerified!==true||input.independentCustomerConfirmed!==true)throw new HttpError(400,'Verify customer opt-in and an independent customer before recording attribution.');
   const [request]=await tx.query`SELECT id,contact_email,payload,created_at,status FROM service_requests WHERE id=${requestId} FOR SHARE`;
   if(!request||['cancelled','declined'].includes(request.status))throw new HttpError(404,'Eligible customer request not found.');
   let permissionTime=request.created_at;
   if(request.payload?.source==='3dprint4.me'||request.payload?.referral!==undefined){
    const choice=request.payload.referral;
    if(choice?.consent!==true||choice.consentVersion!==REFERRAL_CONSENT_VERSION||choice.code!==ref.code)throw new HttpError(409,'This request does not contain customer permission for the chosen referral code.');
    permissionTime=request.payload.submittedAt;
    if(!Number.isFinite(new Date(permissionTime).getTime())||new Date(at).getTime()!==new Date(permissionTime).getTime())throw new HttpError(400,'Use the server receipt time of the customer referral permission.');
   }
   if(new Date(at)<new Date(gig.accepted_at)||new Date(at)>now()||new Date(request.created_at)<new Date(gig.accepted_at)||new Date(at)>new Date(permissionTime))throw new HttpError(400,'Attribution needs customer permission at or before the completed request and after work acceptance.');
   const keys=identityKeys({email:request.contact_email,phone:request.payload?.contact?.phone});
   if(await participantMatch(tx,keys))throw new HttpError(409,'A participant purchase cannot qualify as an independent customer referral.');
   const id=randomUUID(),evidence=text(input.evidenceReference,500),[created]=await tx.query`INSERT INTO partner_referral_attributions(id,referral_id,request_id,identity_keys,consented_at,evidence_reference,recorded_by,created_at) VALUES(${id},${ref.id},${request.id},${JSON.stringify(keys)}::jsonb,${at},${evidence},${actor.id},${now().toISOString()}) ON CONFLICT DO NOTHING RETURNING id`;
   if(!created)throw new HttpError(409,'This request already has recorded attribution.');
   await repo.audit(tx,{programId:ref.program_id,actor,action:'referral.attributed',entityKind:'referral_attribution',entityId:id,changes:{referralId:ref.id}});return {id,referralId:ref.id,status:'attributed_not_paid'};
  }),
  'referral.verify_sale':owner(['referralId','attributionId','amountCents','paymentReference','method','settledAt','settlementVerified','paidInFull','refundsReviewed','independentCustomerConfirmed'],async(tx,input,actor)=>{
   const {ref}=await lock(tx,input.referralId);
   if(input.settlementVerified!==true||input.paidInFull!==true||input.refundsReviewed!==true||input.independentCustomerConfirmed!==true)throw new HttpError(400,'Independently verify full settlement, refunds and customer eligibility. Quotes and return URLs are not payment evidence.');
   const [source]=await tx.query`SELECT a.*,r.status,r.contact_email,r.payload,r.created_at AS requested_at FROM partner_referral_attributions a JOIN service_requests r ON r.id=a.request_id WHERE a.id=${uuid(input.attributionId)} AND a.referral_id=${ref.id} FOR SHARE OF r`;
   if(!source||['cancelled','declined'].includes(source.status))throw new HttpError(404,'Eligible attributed request not found.');
   const keys=[...new Set([...source.identity_keys,...identityKeys({email:source.contact_email,phone:source.payload?.contact?.phone})])];
   if(await participantMatch(tx,keys))throw new HttpError(409,'A participant purchase cannot qualify as an independent customer referral.');
   const cents=integer(input.amountCents,1,2147483647),reference=text(input.paymentReference,200).normalize('NFKC'),settled=timestamp(input.settledAt);
   if(/[a-z][a-z0-9+.-]*:\/\//i.test(reference)||!['bank_transfer','cash','check','provider_settlement'].includes(input.method)||new Date(settled)>now()||new Date(settled)<new Date(source.requested_at)||new Date(settled)<new Date(source.consented_at))throw new HttpError(400,'Record an actual settlement reference, method and consistent payment time.');
   const id=randomUUID(),[created]=await tx.query`INSERT INTO partner_sale_evidence(id,attribution_id,request_id,identity_keys,amount_cents,payment_reference,proof_key,payment_method,settled_at,verified_by,created_at) VALUES(${id},${source.id},${source.request_id},${JSON.stringify(keys)}::jsonb,${cents},${reference},${digest(reference.toLowerCase())},${input.method},${settled},${actor.id},${now().toISOString()}) ON CONFLICT DO NOTHING RETURNING id`;
   if(!created)throw new HttpError(409,'This settlement evidence is already recorded.');
   await repo.audit(tx,{programId:ref.program_id,actor,action:'referral.sale_verified',entityKind:'sale_evidence',entityId:id,changes:{referralId:ref.id}});return {id,referralId:ref.id,status:'verified_not_awarded'};
  }),
  'referral.award':owner(['referralId','ruleId','qualificationId','saleEvidenceId','criteriaConfirmed','antiFraudConfirmed'],async(tx,input,actor)=>{
   const {ref,gig,terms}=await lock(tx,input.referralId),rule=terms.bonusRules.find(r=>r.id===input.ruleId);
   if(!rule)throw new HttpError(404,'Accepted bonus rule not found.');
   if(input.criteriaConfirmed!==true||input.antiFraudConfirmed!==true)throw new HttpError(400,'Review the frozen criteria, self-referral and collusion checks before awarding.');
   let source,qualifiedAt,claims;
   if(rule.trigger==='qualified_lead'){
    if(input.saleEvidenceId!==undefined)throw new HttpError(400,'Choose only the qualification source for this rule.');
    const [q]=await tx.query`SELECT * FROM partner_lead_qualifications WHERE id=${uuid(input.qualificationId)} AND partner_id=${ref.partner_id} AND gig_id=${gig.id} AND program_id=${ref.program_id}`;
    if(!q)throw new HttpError(404,'Qualified introduction not found.');
    if(q.evidence.participantMatch||await participantMatch(tx,q.identity_keys))throw new HttpError(409,'Participant contacts cannot earn an independent introduction bonus.');
    source=q.id;qualifiedAt=q.qualified_at;claims=q.identity_keys.map(key=>({kind:'lead_identity',key:digest(ref.program_id+':'+key)}));
   }else{
    if(input.qualificationId!==undefined)throw new HttpError(400,'Choose only the verified sale source for this rule.');
    const [s]=await tx.query`SELECT s.*,a.identity_keys AS attributed_identity_keys,r.contact_email,r.payload,r.status FROM partner_sale_evidence s JOIN partner_referral_attributions a ON a.id=s.attribution_id JOIN service_requests r ON r.id=s.request_id WHERE s.id=${uuid(input.saleEvidenceId)} AND a.referral_id=${ref.id} FOR SHARE OF r`;
    if(!s)throw new HttpError(404,'Independently verified settlement not found.');
    if(['cancelled','declined'].includes(s.status)||await participantMatch(tx,[...s.identity_keys,...s.attributed_identity_keys,...identityKeys({email:s.contact_email,phone:s.payload?.contact?.phone})]))throw new HttpError(409,'The customer request no longer qualifies for an independent sale bonus.');
    source=s.attribution_id;qualifiedAt=s.settled_at;claims=[{kind:'request',key:digest(s.request_id)},{kind:'settlement',key:s.proof_key}];
   }
   if(!claims.length||new Date(qualifiedAt)<new Date(gig.accepted_at)||new Date(qualifiedAt)>now()||civil(qualifiedAt)>rule.qualifiesBy)throw new HttpError(409,'This source does not meet the accepted qualification period.');
   const [prior]=await tx.query`SELECT e.id,e.amount_cents,p.id AS payable_id FROM partner_referral_events e JOIN partner_payables p ON p.referral_event_id=e.id WHERE e.referral_id=${ref.id} AND e.rule_id=${rule.id} AND e.source_event_id=${source}`;
   if(prior)return {id:prior.id,payableId:prior.payable_id,amountCents:prior.amount_cents};
   const [used]=await tx.query`SELECT count(*) FILTER(WHERE rule_id=${rule.id})::int AS rule_count,COALESCE(sum(amount_cents),0)::int AS cents FROM partner_referral_events WHERE referral_id=${ref.id}`;
   if(used.rule_count>=rule.maximumAwards||used.cents+rule.amountCents>gig.maximum_bonus_cents)throw new HttpError(409,'The accepted bonus maximum has already been earned.');
   const id=randomUUID(),payableId=randomUUID();
   await tx.query`INSERT INTO partner_referral_events(id,referral_id,partner_id,rule_id,source_event_id,event_type,bonus_policy_version,amount_cents,verified_by,verified_at) VALUES(${id},${ref.id},${ref.partner_id},${rule.id},${source},${rule.trigger==='qualified_lead'?'consented_lead':'verified_sale'},${ref.policy_sha256},${rule.amountCents},${actor.id},${now().toISOString()})`;
   for(const claim of claims){const [created]=await tx.query`INSERT INTO partner_bonus_claims(source_kind,source_key,event_id) VALUES(${claim.kind},${claim.key},${id}) ON CONFLICT DO NOTHING RETURNING event_id`;if(!created)throw new HttpError(409,'This source has already earned a bonus.');}
   await tx.query`INSERT INTO partner_payables(id,partner_id,referral_event_id,amount_cents,occurred_at) VALUES(${payableId},${ref.partner_id},${id},${rule.amountCents},${now().toISOString()})`;
   await repo.audit(tx,{programId:ref.program_id,actor,action:'referral.bonus_earned',entityKind:'referral_event',entityId:id,changes:{referralId:ref.id,payableId,amountCents:rule.amountCents,authorizationWeekId:gig.program_week_id}});
   return {id,payableId,amountCents:rule.amountCents};
  }),
 };
}
export async function readReferrals(tx,actor){
 const partnerId=actor.role==='PARTNER'?actor.id:null;
 const refs=await tx.query`SELECT id,partner_id,originating_gig_id,code,policy_snapshot,policy_sha256 FROM partner_referrals WHERE (${partnerId}::uuid IS NULL OR partner_id=${partnerId}::uuid) ORDER BY created_at,id LIMIT 10001`;
 const awards=await tx.query`SELECT id,referral_id,partner_id,rule_id,event_type,amount_cents,verified_at FROM partner_referral_events WHERE (${partnerId}::uuid IS NULL OR partner_id=${partnerId}::uuid) ORDER BY verified_at,id LIMIT 10001`;
 if(refs.length>10000||awards.length>10000)throw new HttpError(409,'Referral records exceed the download limit; request a complete owner-assisted export.');
 const result={items:refs.map(r=>({id:r.id,partnerId:r.partner_id,gigId:r.originating_gig_id,code:r.code,policyHash:r.policy_sha256,bonusRules:r.policy_snapshot.bonusRules})),awards:awards.map(r=>({id:r.id,referralId:r.referral_id,ruleId:r.rule_id,kind:r.event_type,amountCents:r.amount_cents,earnedAt:iso(r.verified_at)}))};
 if(actor.role!=='OWNER')return result;
 const attributions=await tx.query`SELECT id,referral_id,request_id,consented_at,evidence_reference,created_at FROM partner_referral_attributions ORDER BY created_at,id LIMIT 10001`;
 const sales=await tx.query`SELECT id,attribution_id,request_id,amount_cents,payment_method,payment_reference,settled_at FROM partner_sale_evidence ORDER BY created_at,id LIMIT 10001`;
 const qualifications=await tx.query`SELECT q.id,q.lead_id,q.partner_id,q.gig_id,q.qualified_at,l.status,l.withdrawn_at,l.deleted_at FROM partner_lead_qualifications q JOIN partner_leads l ON l.id=q.lead_id ORDER BY q.qualified_at,q.id LIMIT 10001`;
 // Only actual web opt-ins whose opaque code belongs to accepted referral terms.
 // Manual/paper permission remains an explicit owner-attested command, not inferred here.
 const requests=await tx.query`SELECT r.id,r.project_title,r.status,r.payload FROM service_requests r WHERE r.status NOT IN ('cancelled','declined') AND r.payload->'referral'->>'consent'='true' AND r.payload->'referral'->>'consentVersion'=${REFERRAL_CONSENT_VERSION} AND EXISTS(SELECT 1 FROM partner_referrals f WHERE f.code=r.payload->'referral'->>'code') AND NOT EXISTS(SELECT 1 FROM partner_referral_attributions a WHERE a.request_id=r.id) ORDER BY r.created_at,r.id LIMIT 10001`;
 if([attributions,sales,qualifications,requests].some(rows=>rows.length>10000))throw new HttpError(409,'Referral review records exceed the limit; request owner-assisted reconciliation.');
 return {...result,
  attributions:attributions.map(r=>({id:r.id,referralId:r.referral_id,requestId:r.request_id,consentedAt:iso(r.consented_at),evidenceReference:r.evidence_reference,createdAt:iso(r.created_at)})),
  sales:sales.map(r=>({id:r.id,attributionId:r.attribution_id,requestId:r.request_id,amountCents:r.amount_cents,method:r.payment_method,paymentReference:r.payment_reference,settledAt:iso(r.settled_at)})),
  qualifications:qualifications.map(r=>({id:r.id,leadId:r.lead_id,partnerId:r.partner_id,gigId:r.gig_id,qualifiedAt:iso(r.qualified_at),followUpAllowed:r.status==='qualified'&&!r.withdrawn_at&&!r.deleted_at})),
  requests:requests.filter(r=>r.payload.referral.consent===true&&typeof r.payload.submittedAt==='string'&&Number.isFinite(new Date(r.payload.submittedAt).getTime())).map(r=>({id:r.id,title:r.project_title,status:r.status,code:r.payload.referral.code,consentedAt:new Date(r.payload.submittedAt).toISOString()}))};
}
