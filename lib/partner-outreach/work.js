import { randomUUID } from 'node:crypto';
import { HttpError } from '../http.js';
import { freezeOffer,transitionGig } from './domain.js';
import { authorizationWeek } from './policy.js';
import { exact,text,integer,uuid,date,iso } from './validation.js';

export const gigView=row=>({id:row.id,partnerId:row.partner_id,campaignId:row.campaign_id,terms:row.terms_snapshot,status:row.status,revision:row.revision,feeCents:row.accepted_fee_cents??row.terms_snapshot.feeCents,maximumBonusCents:row.accepted_at?row.maximum_bonus_cents:(row.terms_snapshot.maximumBonusCents??0),acceptedAt:iso(row.accepted_at)??null,submittedAt:iso(row.submitted_at)??null,authorizationWeek:row.week_start_local?String(iso(row.week_start_local)).slice(0,10):null});
export function workCommands({repo,approvals,now}) {
 async function lockGig(tx,actor,gigId){
  const candidate=await repo.getGig(tx,{actor,gigId});
  await tx.query`SELECT id FROM partner_accounts WHERE id=${candidate.partner_id} FOR UPDATE`;
  await repo.lockProgram(tx,candidate.program_id);
  return repo.getGig(tx,{actor,gigId,lock:true});
 }
 const owner=(fields,run)=>({role:'OWNER',fields,run}),partner=(fields,run)=>({role:'PARTNER',fields,run});
 return {
  'program.create':owner(['label','startsOn'],async(tx,input,actor)=>{
   const id=randomUUID(),label=text(input.label,200),starts=date(input.startsOn);
   if(starts>'2026-12-31')throw new HttpError(400,'The pilot ends December 31, 2026.');
   await tx.query`INSERT INTO partner_programs(id,label,starts_on) VALUES(${id},${label},${starts})`;
   await repo.audit(tx,{programId:id,actor,action:'program.created',entityKind:'program',entityId:id});return {id,revision:1};
  }),
  'program.configure':owner(['programId','expectedRevision','enabled','weeklyCapCents','contractVersionId','policyVersionId'],async(tx,input,actor)=>{
   const program=await repo.lockProgram(tx,uuid(input.programId));
   if(program.revision!==integer(input.expectedRevision,1,2147483647))throw new HttpError(409,'Program settings have changed.');
   if(input.enabled!==undefined&&typeof input.enabled!=='boolean')throw new HttpError(400,'Activation must be a boolean.');
   const settings={...program.settings};for(const key of ['contractVersionId','policyVersionId'])if(input[key]!==undefined)settings[key]=uuid(input[key]);
   const cap=input.weeklyCapCents===undefined?program.default_weekly_cap_cents:integer(input.weeklyCapCents);
   // Apply settings under this lock, then evaluate actual evidence before commit.
   const enabled=input.enabled??program.enabled;
   await tx.query`UPDATE partner_programs SET settings=${JSON.stringify(settings)}::jsonb,default_weekly_cap_cents=${cap},enabled=${enabled},revision=revision+1 WHERE id=${program.id}`;
   if(enabled)await approvals.requireActive(tx,program.id,now());
   await repo.audit(tx,{programId:program.id,actor,action:'program.configured',entityKind:'program',entityId:program.id,changes:{enabled,weeklyCapCents:cap}});
   return {id:program.id,revision:program.revision+1,enabled,weeklyCapCents:cap};
  }),
  'program.week_cap':owner(['programId','weekStart','capCents','expectedRevision','reason'],async(tx,input,actor)=>{
   const program=await repo.lockProgram(tx,uuid(input.programId)),week=date(input.weekStart),cap=integer(input.capCents),reason=text(input.reason,1000);
   if(authorizationWeek(week+'T18:00:00Z')!==week)throw new HttpError(400,'Choose a Monday Central week.');
   let [current]=await tx.query`SELECT * FROM partner_program_weeks WHERE program_id=${program.id} AND week_start_local=${week} FOR UPDATE`;
   const expected=integer(input.expectedRevision,0,2147483647);
   if((current?.revision??0)!==expected)throw new HttpError(409,'The weekly budget has changed.');
   if(!current){const [created]=await tx.query`INSERT INTO partner_program_weeks(id,program_id,week_start_local,cap_cents) VALUES(${randomUUID()},${program.id},${week},${cap}) RETURNING *`;current=created;}
   else await tx.query`UPDATE partner_program_weeks SET cap_cents=${cap},revision=revision+1 WHERE id=${current.id}`;
   await tx.query`INSERT INTO partner_work_events(id,program_id,event_type,actor_kind,actor_id,reason,data) VALUES(${randomUUID()},${program.id},'program.week_cap_changed',${actor.role},${actor.id},${reason},${JSON.stringify({week,capCents:cap,committedCents:current.committed_cents})}::jsonb)`;
   await repo.audit(tx,{programId:program.id,actor,action:'program.week_cap_changed',entityKind:'week',entityId:current.id,changes:{capCents:cap,committedCents:current.committed_cents,reasonRecorded:!!reason}});
   return {id:current.id,revision:expected+1,capCents:cap,committedCents:current.committed_cents,remainingCents:Math.max(0,cap-current.committed_cents)};
  }),
  'partner.create':owner(['programId','displayName'],async(tx,input,actor)=>{
   const program=await repo.lockProgram(tx,uuid(input.programId)),id=randomUUID(),name=text(input.displayName,120);
   await tx.query`INSERT INTO partner_accounts(id,program_id,display_name) VALUES(${id},${program.id},${name})`;
   await repo.audit(tx,{programId:program.id,actor,action:'partner.created',entityKind:'partner',entityId:id});return {id,displayName:name,status:'invited',revision:1};
  }),
  'campaign.create':owner(['programId','terms'],async(tx,input,actor)=>{
   const program=await repo.lockProgram(tx,uuid(input.programId)),terms=freezeOffer(input.terms),id=randomUUID();
   await tx.query`INSERT INTO partner_campaigns(id,program_id,title,terms) VALUES(${id},${program.id},${terms.title},${JSON.stringify(terms)}::jsonb)`;
   await repo.audit(tx,{programId:program.id,actor,action:'campaign.created',entityKind:'campaign',entityId:id});return {id,status:'draft',revision:1,terms};
  }),
  'campaign.publish':owner(['campaignId','expectedRevision'],async(tx,input,actor)=>{
   const [candidate]=await tx.query`SELECT program_id FROM partner_campaigns WHERE id=${uuid(input.campaignId)}`;if(!candidate)throw new HttpError(404,'Campaign not found.');
   await repo.lockProgram(tx,candidate.program_id);await approvals.requireActive(tx,candidate.program_id,now());
   const [row]=await tx.query`UPDATE partner_campaigns SET status='published',revision=revision+1 WHERE id=${input.campaignId} AND revision=${integer(input.expectedRevision,1,2147483647)} AND status IN ('draft','paused') RETURNING *`;
   if(!row)throw new HttpError(409,'Campaign has changed.');
   await repo.audit(tx,{programId:row.program_id,actor,action:'campaign.published',entityKind:'campaign',entityId:row.id});return {id:row.id,status:row.status,revision:row.revision};
  }),
  'campaign.pause':owner(['campaignId','expectedRevision'],async(tx,input,actor)=>{
   const [candidate]=await tx.query`SELECT program_id FROM partner_campaigns WHERE id=${uuid(input.campaignId)}`;if(!candidate)throw new HttpError(404,'Campaign not found.');
   await repo.lockProgram(tx,candidate.program_id);
   const [row]=await tx.query`UPDATE partner_campaigns SET status='paused',revision=revision+1 WHERE id=${uuid(input.campaignId)} AND revision=${integer(input.expectedRevision,1,2147483647)} RETURNING *`;if(!row)throw new HttpError(409,'Campaign has changed.');
   await repo.audit(tx,{programId:row.program_id,actor,action:'campaign.paused',entityKind:'campaign',entityId:row.id});return {id:row.id,status:row.status,revision:row.revision};
  }),
  'gig.offer':owner(['campaignId','partnerId'],async(tx,input,actor)=>{
   const [account]=await tx.query`SELECT * FROM partner_accounts WHERE id=${uuid(input.partnerId)} FOR UPDATE`;if(!account||account.status!=='active')throw new HttpError(409,'An active partner is required.');
   await repo.lockProgram(tx,account.program_id);await approvals.requireActive(tx,account.program_id,now());
   const [campaign]=await tx.query`SELECT * FROM partner_campaigns WHERE id=${uuid(input.campaignId)} AND program_id=${account.program_id} AND status='published'`;
   if(!campaign)throw new HttpError(409,'A published campaign in this program is required.');
   const id=randomUUID(),terms=freezeOffer(campaign.terms);
   await tx.query`INSERT INTO partner_gigs(id,program_id,partner_id,campaign_id,terms_snapshot,status) VALUES(${id},${account.program_id},${account.id},${campaign.id},${JSON.stringify(terms)}::jsonb,'offered')`;
   await repo.audit(tx,{programId:account.program_id,actor,action:'gig.offered',entityKind:'gig',entityId:id});return {id,status:'offered',revision:1,terms};
  }),
  'gig.accept':partner(['gigId','expectedRevision'],async(tx,input,actor)=>{
   const [account]=await tx.query`SELECT program_id FROM partner_accounts WHERE id=${actor.id}`;
   await repo.lockProgram(tx,account.program_id);await approvals.requireActive(tx,account.program_id,now());
   return repo.reserveGig(tx,{actor,gigId:uuid(input.gigId),expectedRevision:integer(input.expectedRevision,1,2147483647),instant:now().toISOString(),authorizationApproved:true});
  }),
  'gig.counteroffer':partner(['gigId','expectedRevision','proposedFeeCents','message'],async(tx,input,actor)=>{
   const gig=await lockGig(tx,actor,uuid(input.gigId));
   if(gig.status!=='offered'||gig.revision!==integer(input.expectedRevision,1,2147483647))throw new HttpError(409,'This offer has changed.');
   const amount=integer(input.proposedFeeCents),message=text(input.message,2000),id=randomUUID();
   await tx.query`INSERT INTO partner_negotiations(id,gig_id,partner_id,proposed_fee_cents,message,actor_id) VALUES(${id},${gig.id},${actor.id},${amount},${message},${actor.id})`;
   await tx.query`UPDATE partner_gigs SET revision=revision+1 WHERE id=${gig.id}`;
   await repo.audit(tx,{programId:gig.program_id,actor,action:'gig.counteroffered',entityKind:'gig',entityId:gig.id,changes:{proposedFeeCents:amount}});return {id:gig.id,status:'offered',revision:gig.revision+1,negotiationId:id};
  }),
  'gig.reoffer':owner(['gigId','expectedRevision','terms','message'],async(tx,input,actor)=>{
   const candidate=await repo.getGig(tx,{actor,gigId:uuid(input.gigId)});
   const [account]=await tx.query`SELECT * FROM partner_accounts WHERE id=${candidate.partner_id} FOR UPDATE`;
   await repo.lockProgram(tx,account.program_id);await approvals.requireActive(tx,account.program_id,now());
   const gig=await repo.getGig(tx,{actor,gigId:candidate.id,lock:true}),terms=freezeOffer(input.terms),message=text(input.message,2000);
   if(gig.status!=='offered'||gig.revision!==integer(input.expectedRevision,1,2147483647))throw new HttpError(409,'Only an unaccepted offer can be renegotiated.');
   await tx.query`INSERT INTO partner_negotiations(id,gig_id,partner_id,proposed_fee_cents,message,actor_id) VALUES(${randomUUID()},${gig.id},${gig.partner_id},${terms.feeCents},${message},${actor.id})`;
   await tx.query`UPDATE partner_gigs SET terms_snapshot=${JSON.stringify(terms)}::jsonb,revision=revision+1 WHERE id=${gig.id}`;
   await repo.audit(tx,{programId:gig.program_id,actor,action:'gig.reoffered',entityKind:'gig',entityId:gig.id});return {id:gig.id,status:'offered',revision:gig.revision+1,terms};
  }),
  ...Object.fromEntries(['decline','submit','request_cancel','report_unsafe','dispute','withdraw','approve','request_changes','make_payable'].map(action=>['gig.'+action,{role:['withdraw','approve','request_changes','make_payable'].includes(action)?'OWNER':'PARTNER',fields:['gigId','expectedRevision','reason'],run:async(tx,input,actor)=>{
   const gig=await lockGig(tx,actor,uuid(input.gigId));
   const command={action,expectedRevision:integer(input.expectedRevision,1,2147483647)};if(input.reason!==undefined)command.reason=text(input.reason,2000);
   const next=transitionGig({...gig,partnerId:gig.partner_id},command,actor);
   const time=now().toISOString();
   await tx.query`UPDATE partner_gigs SET status=${next.status},revision=${next.revision},submitted_at=CASE WHEN ${action}='submit' THEN ${time}::timestamptz ELSE submitted_at END,approved_at=CASE WHEN ${action}='approve' THEN ${time}::timestamptz ELSE approved_at END WHERE id=${gig.id}`;
   if(action==='make_payable')await tx.query`INSERT INTO partner_payables(id,partner_id,gig_id,amount_cents) VALUES(${randomUUID()},${gig.partner_id},${gig.id},${gig.accepted_fee_cents}) ON CONFLICT(gig_id) DO NOTHING`;
   await tx.query`INSERT INTO partner_work_events(id,program_id,gig_id,partner_id,event_type,actor_kind,actor_id,reason,data) VALUES(${randomUUID()},${gig.program_id},${gig.id},${gig.partner_id},${'gig.'+action},${actor.role},${actor.id},${input.reason??''},${JSON.stringify({from:gig.status,to:next.status})}::jsonb)`;
   await repo.audit(tx,{programId:gig.program_id,actor,action:'gig.'+action,entityKind:'gig',entityId:gig.id,changes:{from:gig.status,to:next.status,reasonRecorded:!!input.reason}});
   return {id:gig.id,status:next.status,revision:next.revision,feeCents:gig.accepted_fee_cents??gig.terms_snapshot.feeCents};
  }}])),
 };
}
