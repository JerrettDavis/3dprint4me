import { HttpError } from '../http.js';
import { createPostgresPartnerRepository } from './postgres-repository.js';
import { createPartnerApprovals } from './approvals.js';
import { visitCommands,readVisits } from './visits.js';
import { activityCommands,readActivity } from './activity.js';
import { ledgerCommands,financialRead } from './ledger.js';
import { accountingCommands,readAccountingExport } from './accounting.js';
import { profileCommands,readOwnExport } from './profile.js';
import { legalCommands,readLegal } from './legal.js';
import { templateSeedCommands } from './template-seeds.js';
import { reviewPackageCommands,readReviewPackage } from './review-packages.js';
import { reviewFeedbackCommands,readReviewFeedback } from './review-feedback.js';
import { referralCommands,readReferrals } from './referrals.js';
import { workCommands,gigView } from './work.js';
import { verifyOwnerActor } from './owner-identity.js';
import { exact,uuid,iso } from './validation.js';

export function createPartnerApplication({database,env=process.env,now=()=>new Date(),additionalCommands={},allowSyntheticOwner=false}={}) {
 const repo=createPostgresPartnerRepository({database}),approvals=createPartnerApprovals({env,now});
 const commands={...workCommands({repo,approvals,now}),...referralCommands({repo,now}),...visitCommands({repo,now}),...activityCommands({repo,now}),...ledgerCommands({repo,now}),...accountingCommands({repo,now}),...profileCommands({repo,now}),...legalCommands({repo,approvals,now}),...templateSeedCommands({repo,now}),...reviewPackageCommands({repo,now,env}),...reviewFeedbackCommands({repo,now}),...additionalCommands};
 async function guard(tx,actor){
  if(actor?.role==='OWNER'){if(allowSyntheticOwner&&!actor.ownerSessionHash)return;await verifyOwnerActor(tx,actor,{env,now,lock:true});return;}
  if(actor?.role!=='PARTNER')throw new HttpError(403,'Access denied.');
  const [account]=await tx.query`SELECT status,credential_version FROM partner_accounts WHERE id=${uuid(actor.id)} FOR UPDATE`;
  const [session]=await tx.query`SELECT id FROM partner_sessions WHERE id=${uuid(actor.sessionId)} AND partner_id=${actor.id} AND revoked_at IS NULL AND credential_version=${actor.credentialVersion} AND expires_at>${now().toISOString()} AND absolute_expires_at>${now().toISOString()}`;
  if(!account||account.status!=='active'||account.credential_version!==actor.credentialVersion||!session)throw new HttpError(401,'Your session has ended. Sign in again or contact the owner.');
 }
 async function execute({actor,action,input,key}) {
  if(!Object.hasOwn(commands,action))throw new HttpError(400,'Unknown partner command.');
  const handler=commands[action];if(!(Array.isArray(handler.role)?handler.role.includes(actor?.role):actor?.role===handler.role))throw new HttpError(403,'Access denied.');
  exact(input,handler.fields);
  return repo.withCommand({actor,operation:action,key,payload:input,authorize:tx=>guard(tx,actor)},tx=>handler.run(tx,input,actor));
 }
 async function read(actor,resource,input={}){
  exact(input,['id','programId','compareTo']);
  const result=await database.withTransaction(async tx=>{
   await guard(tx,actor);
   if(actor.role==='PARTNER'&&!['gig','own-export'].includes(resource)&&(input.id||input.programId))throw new HttpError(404,'Resource not found.');
   if(resource==='referrals')return readReferrals(tx,actor);
   if(resource==='earnings'||resource==='ledger')return financialRead(tx,actor,resource,input);
   if(['legal','legal-version','legal-diff'].includes(resource))return readLegal(tx,actor,resource,input,now());
   if(resource==='review-feedback')return readReviewFeedback(tx,actor,input,{repo});
   if(resource==='review-package')return readReviewPackage(tx,actor,input,{repo,now});
   if(resource==='own-export')return readOwnExport(tx,actor,input,now());
   if(resource==='statement')return financialRead(tx,actor,'earnings',input);
   if(resource==='export')return readAccountingExport(tx,actor,input);
   if(resource==='visits'||resource==='leads')return readVisits(tx,actor,resource);
   if(resource==='activity')return readActivity(tx,actor);
   if(resource==='gig'){const item=gigView(await repo.getGig(tx,{actor,gigId:uuid(input.id)}));return {item,events:await tx.query`SELECT id,event_type,actor_kind,reason,data,created_at FROM partner_work_events WHERE gig_id=${input.id} ORDER BY created_at,id LIMIT 200`,materials:await tx.query`SELECT id,event_type,items,created_at FROM partner_material_events WHERE gig_id=${input.id} ORDER BY created_at,id LIMIT 200`,negotiations:actor.role==='PARTNER'?await tx.query`SELECT id,proposed_fee_cents,message,actor_id,created_at FROM partner_negotiations WHERE gig_id=${input.id} AND partner_id=${actor.id} ORDER BY created_at,id LIMIT 100`:await tx.query`SELECT id,proposed_fee_cents,message,actor_id,created_at FROM partner_negotiations WHERE gig_id=${input.id} ORDER BY created_at,id LIMIT 100`};}
   if(resource==='gigs'){
    const rows=actor.role==='PARTNER'?await tx.query`SELECT g.*,w.week_start_local FROM partner_gigs g LEFT JOIN partner_program_weeks w ON w.id=g.program_week_id WHERE g.partner_id=${actor.id} ORDER BY g.created_at DESC,g.id LIMIT 500`:await tx.query`SELECT g.*,w.week_start_local FROM partner_gigs g LEFT JOIN partner_program_weeks w ON w.id=g.program_week_id ORDER BY g.created_at DESC,g.id LIMIT 500`;
    return {items:rows.map(gigView)};
   }
   if(resource==='profile'&&actor.role==='PARTNER'){const [row]=await tx.query`SELECT id,program_id,display_name,status,profile,revision FROM partner_accounts WHERE id=${actor.id}`;const clearance=await approvals.status(tx,row.program_id);return {item:row,program:{newWorkAvailable:clearance.allowed,endsOn:String(iso(clearance.program.ends_on)).slice(0,10)}};}
   if(resource==='agreements'&&actor.role==='PARTNER')return {items:await tx.query`SELECT i.id,i.version_id,i.snapshot_markdown,i.snapshot_sha256,i.issued_at,a.acknowledged_at FROM partner_agreement_issues i LEFT JOIN partner_agreement_acknowledgments a ON a.issue_id=i.id WHERE i.partner_id=${actor.id} ORDER BY i.issued_at DESC LIMIT 200`};
   if(actor.role!=='OWNER')throw new HttpError(404,'Resource not found.');
   if(resource==='programs'){
    const rows=await tx.query`SELECT * FROM partner_programs ORDER BY created_at,id LIMIT 100`;
    const items=[];for(const row of rows){const status=await approvals.status(tx,row.id);items.push({...row,starts_on:String(iso(row.starts_on)).slice(0,10),ends_on:String(iso(row.ends_on)).slice(0,10),clearance:{allowed:status.allowed,missing:status.missing}});}return {items};
   }
   if(resource==='partners')return {items:await tx.query`SELECT id,program_id,display_name,status,profile,revision,created_at FROM partner_accounts ORDER BY created_at DESC,id LIMIT 500`};
   if(resource==='campaigns')return {items:await tx.query`SELECT id,program_id,title,terms,status,revision,created_at FROM partner_campaigns ORDER BY created_at DESC,id LIMIT 500`};
   if(resource==='budgets')return {items:await tx.query`SELECT id,program_id,week_start_local,cap_cents,committed_cents,revision FROM partner_program_weeks ORDER BY week_start_local DESC,program_id LIMIT 500`};
   if(resource==='audit')return {items:await tx.query`SELECT id,program_id,actor_kind,actor_id,action,entity_kind,entity_id,minimal_diff,created_at FROM partner_audit_events ORDER BY created_at DESC,id DESC LIMIT 200`};
   throw new HttpError(404,'Resource not found.');
  });
  if(resource==='own-export'&&result.unavailable)throw new HttpError(410,'This export expired or contains changed records. Create a new copy.');
  return result;
 }
 return {execute,read,guard,repo,approvals};
}
