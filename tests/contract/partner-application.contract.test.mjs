import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { partnerFixture,ACTIVE_ENV,TEST_NOW } from '../support/partner-fixture.mjs';
import { createPartnerApplication } from '../../lib/partner-outreach/application.js';
import { createPartnerApprovals } from '../../lib/partner-outreach/approvals.js';
const terms={title:'Business introductions',feeCents:5000,maximumBonusCents:1000,tasks:['Ten permitted business visits'],materials:['Samples'],area:'Tulsa',deadline:'2026-12-01'};

test('launch needs exact published reviews and independent environment flags',async()=>{
 const f=await partnerFixture();
 try{
  const approvals=createPartnerApprovals({env:ACTIVE_ENV,now:()=>new Date(TEST_NOW)});
  assert.equal((await approvals.status(f.database,f.programId)).allowed,true);
  assert.equal((await createPartnerApprovals({env:{},now:()=>new Date(TEST_NOW)}).status(f.database,f.programId)).allowed,false);
  await f.database.query`UPDATE partner_legal_documents SET status='draft' WHERE id=${f.documentId}`;
  assert.ok((await approvals.status(f.database,f.programId)).missing.includes('published_agreement'));
  await f.database.query`UPDATE partner_legal_documents SET status='published' WHERE id=${f.documentId}`;
  await f.database.query`INSERT INTO partner_legal_reviews(id,version_id,scope,decision,reviewer_name,evidence_ref,actor_id,reviewed_at,recorded_at) VALUES(${randomUUID()},${f.versionId},'accounting','changes_requested','Synthetic','SYNTHETIC','owner',${TEST_NOW},'2099-01-01')`;
  assert.ok((await approvals.status(f.database,f.programId)).missing.includes('accounting'));
 }finally{await f.close();}
});

test('owner offers, partner negotiates and accepts once; pause preserves earned work and review',async()=>{
 const f=await partnerFixture();
 try{
  const app=createPartnerApplication({database:f.database,env:ACTIVE_ENV,allowSyntheticOwner:true,now:()=>new Date(TEST_NOW)});
  const run=(actor,action,input,key=randomUUID())=>app.execute({actor,action,input,key});
  const campaign=await run(f.owner,'campaign.create',{programId:f.programId,terms});
  await assert.rejects(run(f.actor,'campaign.publish',{campaignId:campaign.id,expectedRevision:1}),{status:403});
  await run(f.owner,'campaign.publish',{campaignId:campaign.id,expectedRevision:1});
  const gig=await run(f.owner,'gig.offer',{campaignId:campaign.id,partnerId:f.partnerId});
  const offerKey=randomUUID(),counter=await run(f.actor,'gig.counteroffer',{gigId:gig.id,expectedRevision:1,proposedFeeCents:5500,message:'Additional deliverable scope'},offerKey);
  assert.equal(counter.status,'offered');assert.equal(counter.revision,2);
  assert.equal((await f.database.query`SELECT count(*)::int AS n FROM partner_budget_reservations`)[0].n,0);
  const acceptKey=randomUUID(),accepted=await run(f.actor,'gig.accept',{gigId:gig.id,expectedRevision:2},acceptKey);
  assert.equal(accepted.feeCents,5000);
  assert.deepEqual(await run(f.actor,'gig.accept',{gigId:gig.id,expectedRevision:2},acceptKey),accepted);
  await assert.rejects(app.read(f.otherActor,'gig',{id:gig.id}),{status:404});
  await assert.rejects(app.read(f.otherActor,'gig',{id:randomUUID()}),{status:404});
  await assert.rejects(run(f.actor,'gig.submit',{gigId:gig.id,expectedRevision:3,feeCents:1}),{status:400});
  await run(f.owner,'program.configure',{programId:f.programId,expectedRevision:1,enabled:false,weeklyCapCents:1000});
  const submitted=await run(f.actor,'gig.submit',{gigId:gig.id,expectedRevision:3});
  assert.equal(submitted.status,'submitted');
  const approved=await run(f.owner,'gig.approve',{gigId:gig.id,expectedRevision:4});
  assert.equal(approved.status,'approved');
  const payable=await run(f.owner,'gig.make_payable',{gigId:gig.id,expectedRevision:5});
  assert.equal(payable.status,'payable');
  assert.equal((await f.database.query`SELECT amount_cents FROM partner_payables`)[0].amount_cents,5000);
  const list=await app.read(f.actor,'gigs',{});assert.equal(list.items.length,1);
  assert.ok(!JSON.stringify(list).includes('credential_hash'));
  await f.database.query`UPDATE partner_accounts SET credential_version=credential_version+1 WHERE id=${f.partnerId}`;
  await assert.rejects(run(f.actor,'gig.accept',{gigId:gig.id,expectedRevision:2},acceptKey),{status:401});
  await assert.rejects(run(f.actor,'gig.dispute',{gigId:gig.id,expectedRevision:6,reason:'Not paid'}),{status:401});
 }finally{await f.close();}
});

test('owner withdrawal locks account and program before gig to avoid acceptance lock inversion',async()=>{
 const f=await partnerFixture();
 try{
  const campaign=randomUUID(),gig=randomUUID(),trace=[];
  await f.database.query`INSERT INTO partner_campaigns(id,program_id,title,terms,status) VALUES(${campaign},${f.programId},'Synthetic',${JSON.stringify(terms)}::jsonb,'published')`;
  await f.database.query`INSERT INTO partner_gigs(id,program_id,partner_id,campaign_id,terms_snapshot,status) VALUES(${gig},${f.programId},${f.partnerId},${campaign},${JSON.stringify(terms)}::jsonb,'offered')`;
  const database={...f.database,withTransaction:fn=>f.database.withTransaction(tx=>fn({query:async(strings,...values)=>{trace.push(strings.join('?'));return tx.query(strings,...values);}}))};
  const app=createPartnerApplication({database,env:ACTIVE_ENV,allowSyntheticOwner:true,now:()=>new Date(TEST_NOW)});
  await app.execute({actor:f.owner,action:'gig.withdraw',input:{gigId:gig,expectedRevision:1},key:randomUUID()});
  const account=trace.findIndex(sql=>/SELECT.*FROM partner_accounts.*FOR UPDATE/s.test(sql));
  const program=trace.findIndex(sql=>/SELECT.*FROM partner_programs.*FOR UPDATE/s.test(sql));
  const lockedGig=trace.findIndex(sql=>/SELECT.*FROM partner_gigs.*FOR UPDATE/s.test(sql));
  assert.ok(account>=0&&account<program&&program<lockedGig,'account -> program -> gig lock ordering');
 }finally{await f.close();}
});
