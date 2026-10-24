import { randomUUID } from 'node:crypto';
import { HttpError } from '../http.js';
import { integer,text,uuid,timestamp,iso } from './validation.js';

const amount=value=>integer(value,1,2147483647);
function safeCents(value){const n=Number(value);if(!Number.isSafeInteger(n))throw new HttpError(503,'Financial records need owner reconciliation.');return n;}
export function payableView(row){
 const base=safeCents(row.amount_cents),adjustments=safeCents(row.adjustment_cents??0),paid=safeCents(row.paid_cents??0),due=base+adjustments;
 if(!Number.isSafeInteger(due)||due<0||paid<0)throw new HttpError(503,'Financial records need owner reconciliation.');
 return {id:row.id,partnerId:row.partner_id,gigId:row.gig_id??null,referralEventId:row.referral_event_id??null,baseCents:base,adjustmentCents:adjustments,amountDueCents:due,paidCents:paid,outstandingCents:Math.max(0,due-paid),overpaidCents:Math.max(0,paid-due),status:due===0?'settled':paid>=due?'paid':paid>0?'part_paid':'payable',occurredAt:iso(row.occurred_at),programId:row.program_id};
}
export async function readPayables(tx,{actor,programId=null,payableId=null}={}){
 const partnerId=actor.role==='PARTNER'?actor.id:null;
 const rows=await tx.query`SELECT p.*,a.program_id,COALESCE((SELECT sum(e.amount_cents) FROM partner_payment_events e WHERE e.payable_id=p.id),0)::text AS paid_cents,COALESCE((SELECT sum(j.amount_cents) FROM partner_payable_adjustments j WHERE j.payable_id=p.id),0)::text AS adjustment_cents FROM partner_payables p JOIN partner_accounts a ON a.id=p.partner_id WHERE (${partnerId}::uuid IS NULL OR p.partner_id=${partnerId}::uuid) AND (${programId}::uuid IS NULL OR a.program_id=${programId}::uuid) AND (${payableId}::uuid IS NULL OR p.id=${payableId}::uuid) ORDER BY p.occurred_at,p.id LIMIT 10001`;
 if(rows.length>10000)throw new HttpError(409,'Choose a smaller accounting export period before continuing.');
 return rows.map(payableView);
}
export async function lockPayable(tx,repo,id){
 const [candidate]=await tx.query`SELECT p.id,p.partner_id,a.program_id FROM partner_payables p JOIN partner_accounts a ON a.id=p.partner_id WHERE p.id=${uuid(id)}`;
 if(!candidate)throw new HttpError(404,'Payable not found.');
 await tx.query`SELECT id FROM partner_accounts WHERE id=${candidate.partner_id} FOR UPDATE`;
 await repo.lockProgram(tx,candidate.program_id);
 // Immutable payables deliberately have no UPDATE grant. The account/program
 // locks serialize all payment/adjustment writers without locking evidence rows.
 const [current]=await readPayables(tx,{actor:{role:'OWNER'},payableId:id});return current;
}
async function reflectPayment(tx,current){
 if(current.gigId)await tx.query`UPDATE partner_gigs SET status=${current.outstandingCents===0?'paid':'payable'},revision=revision+1 WHERE id=${current.gigId} AND status IN ('payable','paid')`;
}
export function ledgerCommands({repo,now}){
 async function adjustment(tx,current,input,actor){
  const delta=integer(input.amountCents,-2147483647,2147483647);if(delta===0)throw new HttpError(400,'An adjustment must change the recorded obligation.');
  if(input.partnerAcknowledged!==true||input.verifiedResolution!==true)throw new HttpError(400,'Record the verified external resolution and partner acknowledgment.');
  const reason=text(input.reason,2000),reference=text(input.resolutionReference,200),due=current.amountDueCents+delta;
  if(!Number.isSafeInteger(due)||due<current.paidCents||due<0)throw new HttpError(409,'The resolution cannot erase settled value or create a negative obligation. Reconcile payment corrections first.');
  const id=randomUUID(),[row]=await tx.query`INSERT INTO partner_payable_adjustments(id,payable_id,amount_cents,reason,resolution_reference,partner_acknowledged,verified_resolution,actor_id,occurred_at) VALUES(${id},${current.id},${delta},${reason},${reference},true,true,${actor.id},${now().toISOString()}) ON CONFLICT DO NOTHING RETURNING id`;
  if(!row)throw new HttpError(409,'This resolution is already recorded for the payable.');
  await repo.audit(tx,{programId:current.programId,actor,action:'payable.adjusted',entityKind:'payable',entityId:current.id,changes:{adjustmentId:id,amountCents:delta}});
  return id;
 }
 return {
  'payment.record':{role:'OWNER',fields:['payableId','amountCents','paymentReference','method','occurredAt','verified'],run:async(tx,input,actor)=>{
   if(input.verified!==true)throw new HttpError(400,'Verify actual settlement before recording payment.');
   const current=await lockPayable(tx,repo,input.payableId),cents=amount(input.amountCents),reference=text(input.paymentReference,150).normalize('NFKC'),occurredAt=timestamp(input.occurredAt);
   if(/[a-z][a-z0-9+.-]*:\/\//i.test(reference))throw new HttpError(400,'Record an independently verified settlement reference, not a return URL.');
   if(cents>current.outstandingCents)throw new HttpError(409,'This amount exceeds the outstanding obligation.');
   if(!['bank_transfer','cash','check','other'].includes(input.method))throw new HttpError(400,'Choose a payment method.');
   if(new Date(occurredAt)>new Date(now().getTime()+300000))throw new HttpError(400,'A payment cannot be recorded as settled in the future.');
   const id=randomUUID(),[record]=await tx.query`INSERT INTO partner_payment_events(id,partner_id,payable_id,event_type,amount_cents,payment_reference,payment_method,actor_id,occurred_at,idempotency_key) VALUES(${id},${current.partnerId},${current.id},'settled',${cents},${reference},${input.method},${actor.id},${occurredAt},${randomUUID()}) ON CONFLICT DO NOTHING RETURNING id`;
   if(!record)throw new HttpError(409,'This payment evidence has already been recorded.');
   const [updated]=await readPayables(tx,{actor,payableId:current.id});await reflectPayment(tx,updated);
   await repo.audit(tx,{programId:current.programId,actor,action:'payment.recorded',entityKind:'payment',entityId:id,changes:{payableId:current.id,amountCents:cents}});
   return {id,payableId:current.id,paidCents:updated.paidCents,outstandingCents:updated.outstandingCents};
  }},
  'payment.reverse':{role:'OWNER',fields:['paymentId','paymentReference','occurredAt','verifiedNotSettled','reason'],run:async(tx,input,actor)=>{
   if(input.verifiedNotSettled!==true)throw new HttpError(400,'Verify the nonsettlement or returned transfer before recording a reversal.');
   const [candidate]=await tx.query`SELECT payable_id FROM partner_payment_events WHERE id=${uuid(input.paymentId)}`;if(!candidate)throw new HttpError(404,'Payment event not found.');
   const current=await lockPayable(tx,repo,candidate.payable_id),[original]=await tx.query`SELECT * FROM partner_payment_events WHERE id=${input.paymentId}`;
   if(original.event_type!=='settled')throw new HttpError(409,'Only an original settlement can be reversed.');
   const reason=text(input.reason,2000),reference=text(input.paymentReference,150).normalize('NFKC'),occurredAt=timestamp(input.occurredAt),id=randomUUID();
   if(new Date(occurredAt)>new Date(now().getTime()+300000)||new Date(occurredAt)<new Date(original.occurred_at))throw new HttpError(400,'Choose a valid reversal time after the original payment.');
   const [row]=await tx.query`INSERT INTO partner_payment_events(id,partner_id,payable_id,event_type,amount_cents,reverses_event_id,payment_reference,payment_method,actor_id,occurred_at,idempotency_key) VALUES(${id},${current.partnerId},${current.id},'reversed',${-original.amount_cents},${original.id},${reference},${original.payment_method},${actor.id},${occurredAt},${randomUUID()}) ON CONFLICT DO NOTHING RETURNING id`;
   if(!row)throw new HttpError(409,'This settlement has already been reversed.');
   const [updated]=await readPayables(tx,{actor,payableId:current.id});await reflectPayment(tx,updated);
   await tx.query`INSERT INTO partner_work_events(id,program_id,gig_id,partner_id,event_type,actor_kind,actor_id,reason,data) VALUES(${randomUUID()},${current.programId},${current.gigId},${current.partnerId},'payment.reversed',${actor.role},${actor.id},${reason},${JSON.stringify({paymentId:id,reversesPaymentId:original.id})}::jsonb)`;
   await repo.audit(tx,{programId:current.programId,actor,action:'payment.reversed',entityKind:'payment',entityId:id,changes:{payableId:current.id,amountCents:-original.amount_cents}});
   return {id,payableId:current.id,outstandingCents:updated.outstandingCents,paidCents:updated.paidCents};
  }},
  'payable.adjust':{role:'OWNER',fields:['payableId','amountCents','reason','resolutionReference','partnerAcknowledged','verifiedResolution'],run:async(tx,input,actor)=>{
   const current=await lockPayable(tx,repo,input.payableId),id=await adjustment(tx,current,input,actor);
   const [updated]=await readPayables(tx,{actor,payableId:current.id});await reflectPayment(tx,updated);return {id,payable:updated};
  }},
  'gig.reconcile':{role:'OWNER',fields:['gigId','expectedRevision','agreedCents','reason','resolutionReference','partnerAcknowledged','verifiedResolution'],run:async(tx,input,actor)=>{
   const candidate=await repo.getGig(tx,{actor,gigId:uuid(input.gigId)});
   await tx.query`SELECT id FROM partner_accounts WHERE id=${candidate.partner_id} FOR UPDATE`;await repo.lockProgram(tx,candidate.program_id);
   const gig=await repo.getGig(tx,{actor,gigId:candidate.id,lock:true});
   if(gig.revision!==integer(input.expectedRevision,1,2147483647)||!['disputed','cancellation_requested','changes_requested'].includes(gig.status)||gig.accepted_fee_cents===null)throw new HttpError(409,'This gig is unavailable for reconciliation.');
   if(input.partnerAcknowledged!==true||input.verifiedResolution!==true)throw new HttpError(400,'Record the verified external resolution and partner acknowledgment.');
   const agreed=integer(input.agreedCents,0,2147483647),reason=text(input.reason,2000),reference=text(input.resolutionReference,200);
   await tx.query`INSERT INTO partner_payables(id,partner_id,gig_id,amount_cents,occurred_at) VALUES(${randomUUID()},${gig.partner_id},${gig.id},${gig.accepted_fee_cents},${now().toISOString()}) ON CONFLICT(gig_id) DO NOTHING`;
   const [payable]=await tx.query`SELECT id FROM partner_payables WHERE gig_id=${gig.id}`;const current=await lockPayable(tx,repo,payable.id);
   if(agreed!==current.amountDueCents)await adjustment(tx,current,{...input,amountCents:agreed-current.amountDueCents},actor);
   await tx.query`UPDATE partner_gigs SET status='settled',revision=revision+1 WHERE id=${gig.id}`;
   await tx.query`INSERT INTO partner_work_events(id,program_id,gig_id,partner_id,event_type,actor_kind,actor_id,reason,data) VALUES(${randomUUID()},${gig.program_id},${gig.id},${gig.partner_id},'gig.reconciled',${actor.role},${actor.id},${reason},${JSON.stringify({resolutionReference:reference,agreedCents:agreed,partnerAcknowledged:true})}::jsonb)`;
   await repo.audit(tx,{programId:gig.program_id,actor,action:'gig.reconciled',entityKind:'gig',entityId:gig.id,changes:{agreedCents:agreed}});
   return {id:gig.id,status:'settled',revision:gig.revision+1,payableId:current.id,amountDueCents:agreed};
  }},
 };
}
export async function financialRead(tx,actor,resource,input={}){
 if(resource!=='earnings'&&resource!=='ledger')return null;
 if(resource==='ledger'&&actor.role!=='OWNER')throw new HttpError(404,'Resource not found.');
 const items=await readPayables(tx,{actor,programId:input.programId?uuid(input.programId):null});
 const totals={obligationCents:0,paidCents:0,outstandingCents:0,overpaidCents:0};for(const row of items){totals.obligationCents+=row.amountDueCents;totals.paidCents+=row.paidCents;totals.outstandingCents+=row.outstandingCents;totals.overpaidCents+=row.overpaidCents;}
 const partnerId=actor.role==='PARTNER'?actor.id:null,programId=input.programId??null;
 const [authorizations]=await tx.query`SELECT COALESCE(sum(r.amount_cents),0)::text AS cents FROM partner_budget_reservations r JOIN partner_gigs g ON g.id=r.gig_id WHERE (${partnerId}::uuid IS NULL OR g.partner_id=${partnerId}::uuid) AND (${programId}::uuid IS NULL OR g.program_id=${programId}::uuid)`;
 totals.authorizedMaximumCents=safeCents(authorizations.cents);totals.unfundedObligationCents=Math.max(0,totals.obligationCents-totals.authorizedMaximumCents);
 const gigs=await tx.query`SELECT status,accepted_fee_cents,terms_snapshot,maximum_bonus_cents FROM partner_gigs WHERE (${partnerId}::uuid IS NULL OR partner_id=${partnerId}::uuid) AND (${programId}::uuid IS NULL OR program_id=${programId}::uuid) LIMIT 10001`;
 Object.assign(totals,{offeredCents:0,committedCents:0,submittedCents:0,approvedCents:0,disputedCents:0,contingentBonusCents:0});
 for(const g of gigs){const fee=g.accepted_fee_cents??g.terms_snapshot.feeCents??0;if(g.status==='offered')totals.offeredCents+=fee;if(g.accepted_fee_cents!==null)totals.committedCents+=fee;if(['submitted','changes_requested'].includes(g.status))totals.submittedCents+=fee;if(g.status==='approved')totals.approvedCents+=fee;if(g.status==='disputed')totals.disputedCents+=fee;if(g.accepted_fee_cents!==null)totals.contingentBonusCents+=g.maximum_bonus_cents;}
 const [bonuses]=await tx.query`SELECT COALESCE(sum(e.amount_cents),0)::text AS cents FROM partner_referral_events e JOIN partner_referrals r ON r.id=e.referral_id WHERE (${partnerId}::uuid IS NULL OR e.partner_id=${partnerId}::uuid) AND (${programId}::uuid IS NULL OR r.program_id=${programId}::uuid)`;
 totals.earnedBonusCents=safeCents(bonuses.cents);totals.contingentBonusCents=Math.max(0,totals.contingentBonusCents-totals.earnedBonusCents);
 const paymentEvents=await tx.query`SELECT e.id,e.partner_id,e.payable_id,e.event_type,e.amount_cents,e.reverses_event_id,e.payment_reference,e.payment_method,e.occurred_at FROM partner_payment_events e JOIN partner_accounts a ON a.id=e.partner_id WHERE (${partnerId}::uuid IS NULL OR e.partner_id=${partnerId}::uuid) AND (${programId}::uuid IS NULL OR a.program_id=${programId}::uuid) ORDER BY e.occurred_at DESC,e.id LIMIT 10001`;
 if(paymentEvents.length>10000)throw new HttpError(409,'Payment history requires a smaller program scope.');
 const result={items,totals,paymentEvents,manualPaymentsOnly:true};
 if(actor.role!=='OWNER')return result;
 const adjustments=await tx.query`SELECT j.id,j.payable_id,j.amount_cents,j.reason,j.resolution_reference,j.partner_acknowledged,j.verified_resolution,j.occurred_at FROM partner_payable_adjustments j JOIN partner_payables p ON p.id=j.payable_id JOIN partner_accounts a ON a.id=p.partner_id WHERE (${programId}::uuid IS NULL OR a.program_id=${programId}::uuid) ORDER BY j.occurred_at,j.id LIMIT 10001`;
 if(adjustments.length>10000)throw new HttpError(409,'Adjustment history requires a smaller program scope.');
 return {...result,adjustments:adjustments.map(j=>({id:j.id,payableId:j.payable_id,amountCents:j.amount_cents,reason:j.reason,resolutionReference:j.resolution_reference,partnerAcknowledged:j.partner_acknowledged,verifiedResolution:j.verified_resolution,occurredAt:iso(j.occurred_at)}))};
}
