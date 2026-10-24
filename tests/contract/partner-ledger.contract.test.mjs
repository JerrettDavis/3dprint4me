import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPartnerApplication } from '../../lib/partner-outreach/application.js';
import { partnerFixture,ACTIVE_ENV,TEST_NOW } from '../support/partner-fixture.mjs';
async function setup({payable=true}={}){
 const f=await partnerFixture(),env={...ACTIVE_ENV};
 const app=createPartnerApplication({database:f.database,env,allowSyntheticOwner:true,now:()=>new Date(TEST_NOW)});
 const run=(actor,action,input,key=randomUUID())=>app.execute({actor,action,input,key});
 const terms={title:'Introductions',feeCents:5000,maximumBonusCents:0,tasks:['Permitted business visits'],materials:['Samples'],area:'Tulsa',deadline:'2026-12-01'};
 const c=await run(f.owner,'campaign.create',{programId:f.programId,terms});await run(f.owner,'campaign.publish',{campaignId:c.id,expectedRevision:1});
 const gig=await run(f.owner,'gig.offer',{campaignId:c.id,partnerId:f.partnerId});await run(f.actor,'gig.accept',{gigId:gig.id,expectedRevision:1});
 if(payable){await run(f.actor,'gig.submit',{gigId:gig.id,expectedRevision:2});await run(f.owner,'gig.approve',{gigId:gig.id,expectedRevision:3});await run(f.owner,'gig.make_payable',{gigId:gig.id,expectedRevision:4});}
 const payableRecord=(await f.database.query`SELECT id FROM partner_payables WHERE gig_id=${gig.id}`)[0];
 return {...f,env,app,run,gigId:gig.id,payableId:payableRecord?.id??null};
}
const evidence=(payableId,extra={})=>({payableId,amountCents:5000,paymentReference:'BANK-SYN-01',method:'bank_transfer',occurredAt:TEST_NOW,verified:true,...extra});

test('manual settlement is verified, partial, proof-deduplicated and reversible without erasing evidence',async()=>{
 const f=await setup();
 try{
  let earnings=await f.app.read(f.actor,'earnings');assert.equal(earnings.totals.outstandingCents,5000);assert.equal(earnings.totals.paidCents,0);
  await assert.rejects(f.run(f.actor,'payment.record',evidence(f.payableId)),{status:403});
  await assert.rejects(f.run(f.owner,'payment.record',evidence(f.payableId,{verified:false})),{status:400});
  await assert.rejects(f.run(f.owner,'payment.record',evidence(f.payableId,{amountCents:5001})),{status:409});
  const key=randomUUID(),input=evidence(f.payableId,{amountCents:2000});
  const first=await f.run(f.owner,'payment.record',input,key);assert.equal(first.outstandingCents,3000);
  assert.deepEqual(await f.run(f.owner,'payment.record',input,key),first);
  await assert.rejects(f.run(f.owner,'payment.record',input),{status:409});
  await assert.rejects(f.run(f.owner,'payment.record',{...input,paymentReference:'bank-syn-01'}),{status:409});
  f.env.PARTNER_PROGRAM_ENABLED='0';await f.database.query`UPDATE partner_programs SET enabled=false WHERE id=${f.programId}`;
  const second=await f.run(f.owner,'payment.record',evidence(f.payableId,{amountCents:3000,paymentReference:'BANK-SYN-02'}));
  assert.equal(second.outstandingCents,0);
  earnings=await f.app.read(f.actor,'earnings');assert.equal(earnings.totals.paidCents,5000);
  const reversal=await f.run(f.owner,'payment.reverse',{paymentId:second.id,paymentReference:'BANK-SYN-02-RETURNED',occurredAt:TEST_NOW,verifiedNotSettled:true,reason:'Bank confirmed transfer did not settle'});
  assert.equal(reversal.outstandingCents,3000);
  await assert.rejects(f.run(f.owner,'payment.reverse',{paymentId:second.id,paymentReference:'DUP',occurredAt:TEST_NOW,verifiedNotSettled:true,reason:'Duplicate retry'}),{status:409});
  assert.equal((await f.database.query`SELECT count(*)::int AS n FROM partner_payment_events`)[0].n,3);
  assert.equal((await f.app.read(f.otherActor,'earnings')).items.length,0);
  await assert.rejects(f.app.read(f.actor,'earnings',{id:f.otherPartnerId}),{status:404});
  await assert.rejects(f.database.query`UPDATE partner_payment_events SET amount_cents=0`,/immutable/i);
 }finally{await f.close();}
});

test('reconciliation adds immutable adjustments, preserves accepted fees and ignores retrospective budget caps',async()=>{
 const f=await setup();
 try{
  await f.run(f.actor,'gig.dispute',{gigId:f.gigId,expectedRevision:5,reason:'Cancellation amount needs reconciliation'});
  const resolved=await f.run(f.owner,'gig.reconcile',{gigId:f.gigId,expectedRevision:6,agreedCents:2500,reason:'External resolution agreed by both parties',resolutionReference:'SYNTHETIC-RESOLUTION-01',partnerAcknowledged:true,verifiedResolution:true});
  assert.equal(resolved.amountDueCents,2500);
  assert.equal((await f.database.query`SELECT accepted_fee_cents FROM partner_gigs WHERE id=${f.gigId}`)[0].accepted_fee_cents,5000);
  assert.equal((await f.database.query`SELECT committed_cents FROM partner_program_weeks`)[0].committed_cents,5000);
  await f.run(f.owner,'payable.adjust',{payableId:f.payableId,amountCents:30000,reason:'Additional legally owed work documented outside initial authorization',resolutionReference:'SYNTHETIC-RESOLUTION-02',partnerAcknowledged:true,verifiedResolution:true});
  assert.equal((await f.app.read(f.actor,'earnings')).totals.outstandingCents,32500);
  assert.equal((await f.app.read(f.owner,'ledger')).totals.unfundedObligationCents,27500);
  await f.run(f.owner,'payment.record',evidence(f.payableId,{amountCents:10000}));
  await assert.rejects(f.run(f.owner,'payable.adjust',{payableId:f.payableId,amountCents:-30000,reason:'Would erase paid value',resolutionReference:'SYNTHETIC-RESOLUTION-03',partnerAcknowledged:true,verifiedResolution:true}),{status:409});
  await assert.rejects(f.database.query`DELETE FROM partner_payable_adjustments`,/immutable/i);
 }finally{await f.close();}
});

test('accounting exports freeze stable batches, prevent repeated incremental export and neutralize CSV formulas',async()=>{
 const f=await setup();
 try{
  await f.run(f.owner,'payment.record',evidence(f.payableId,{paymentReference:'=HYPERLINK("https://invalid.test")'}));
  const key=randomUUID(),input={programId:f.programId,basis:'cash',from:'2026-10-01',through:'2026-10-31'};
  const batch=await f.run(f.owner,'finance.export',input,key);
  assert.equal(batch.recordCount,1);assert.match(batch.csv,/record_id/);assert.match(batch.csv,/'=HYPERLINK/);assert.ok(!batch.csv.includes('contact@example'));
  assert.deepEqual(await f.run(f.owner,'finance.export',input,key),batch);
  const next=await f.run(f.owner,'finance.export',input);assert.equal(next.recordCount,0);
  assert.deepEqual(await f.app.read(f.owner,'export',{id:batch.batchId}),batch);
  await assert.rejects(f.app.read(f.actor,'export',{id:batch.batchId}),{status:404});
  const accrual=await f.run(f.owner,'finance.export',{programId:f.programId,basis:'accrual'});assert.equal(accrual.recordCount,1);
  await assert.rejects(f.run(f.owner,'payment.record',{...evidence(f.payableId),giftCents:20000}),{status:400});
 }finally{await f.close();}
});

test('unsafe cancellation before completion can be reconciled and paid after program pause',async()=>{
 const f=await setup({payable:false});
 try{
  await f.run(f.actor,'gig.report_unsafe',{gigId:f.gigId,expectedRevision:2,reason:'Unsafe access at the agreed location'});
  f.env.PARTNER_PROGRAM_ENABLED='0';await f.database.query`UPDATE partner_programs SET enabled=false WHERE id=${f.programId}`;
  const resolution=await f.run(f.owner,'gig.reconcile',{gigId:f.gigId,expectedRevision:3,agreedCents:2500,reason:'Partial authorized work recognized in external resolution',resolutionReference:'SYNTHETIC-SAFE-CANCEL',partnerAcknowledged:true,verifiedResolution:true});
  assert.equal(resolution.amountDueCents,2500);
  const original=(await f.database.query`SELECT amount_cents FROM partner_payables WHERE id=${resolution.payableId}`)[0];assert.equal(original.amount_cents,5000);
  await f.run(f.owner,'payment.record',evidence(resolution.payableId,{amountCents:2500}));
  assert.equal((await f.app.read(f.actor,'earnings')).totals.outstandingCents,0);
 }finally{await f.close();}
});
