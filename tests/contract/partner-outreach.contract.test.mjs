import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPartnerApplication } from '../../lib/partner-outreach/application.js';
import { partnerFixture,ACTIVE_ENV,TEST_NOW } from '../support/partner-fixture.mjs';

test('visits reject unconsented identity, duplicates and unsafe placement; contacts stay scoped and withdrawable',async()=>{
 const f=await partnerFixture();
 try{
  const app=createPartnerApplication({database:f.database,env:ACTIVE_ENV,allowSyntheticOwner:true,now:()=>new Date(TEST_NOW)});
  const run=(actor,action,input,key=randomUUID())=>app.execute({actor,action,input,key});
  const terms={title:'Business visits',feeCents:5000,maximumBonusCents:0,tasks:['Permitted business introductions'],materials:['Samples'],area:'Tulsa',deadline:'2026-12-01'};
  const c=await run(f.owner,'campaign.create',{programId:f.programId,terms});await run(f.owner,'campaign.publish',{campaignId:c.id,expectedRevision:1});
  const g=await run(f.owner,'gig.offer',{campaignId:c.id,partnerId:f.partnerId});await run(f.actor,'gig.accept',{gigId:g.id,expectedRevision:1});
  const base={gigId:g.id,expectedGigRevision:2,clientId:randomUUID(),businessName:'Sample Coffee',outcome:'accepted_material',placement:'permission_received',sampleCount:1,approximateArea:'Tulsa central business district',visitedAt:TEST_NOW,consent:false};
  await assert.rejects(run(f.actor,'visit.record',{...base,contact:{email:'contact@example.test'}}),{status:422});
  await assert.rejects(run(f.actor,'visit.record',{...base,placement:'no_soliciting'}),{status:422});
  const key=randomUUID(),v=await run(f.actor,'visit.record',base,key);
  assert.deepEqual(await run(f.actor,'visit.record',base,key),v);
  assert.equal((await app.read(f.actor,'leads')).items.length,0);
  await assert.rejects(run(f.actor,'visit.record',{...base,clientId:randomUUID()}),{status:409});
  const leadInput={...base,clientId:randomUUID(),businessName:'Sample Books',consent:true,consentPurpose:'Follow up about a printed sign',contact:{name:'Synthetic Contact',email:'contact@example.test',preferredContact:'email'}};
  const lead=await run(f.actor,'visit.record',leadInput);
  assert.equal((await app.read(f.otherActor,'leads')).items.length,0);
  await assert.rejects(run(f.otherActor,'lead.delete',{leadId:lead.leadId,expectedRevision:1}),{status:404});
  let rows=(await app.read(f.actor,'leads')).items;assert.equal(rows.length,1);assert.equal(rows[0].status,'needs_review');
  await assert.rejects(run(f.actor,'lead.correct',{leadId:lead.leadId,expectedRevision:1,contact:{email:'corrected@example.test',preferredContact:'email'}}),{status:422});
  await run(f.actor,'lead.correct',{leadId:lead.leadId,expectedRevision:1,contact:{email:'corrected@example.test',preferredContact:'email'},consent:true,consentPurpose:'Follow up about a printed sign at the corrected address'});
  const correction=(await f.database.query`SELECT evidence FROM partner_consent_events WHERE lead_id=${lead.leadId} AND event_type='corrected'`)[0].evidence;
  assert.equal(correction.version,'follow-up-permission-v1');assert.equal(correction.renewedPermission,true);assert.match(correction.consentText,/withdraw/);
  await run(f.owner,'lead.review',{leadId:lead.leadId,expectedRevision:2,decision:'qualified',reason:'Permission and business interest confirmed'});
  assert.equal((await app.read(f.owner,'leads')).items[0].followUpAllowed,true);
  const exportReference=await run(f.actor,'profile.export',{});
  assert.ok(JSON.stringify(await app.read(f.actor,'own-export',{id:exportReference.batchId})).includes('corrected@example.test'));
  await run(f.actor,'lead.withdraw',{leadId:lead.leadId,expectedRevision:3});
  rows=(await app.read(f.owner,'leads')).items;assert.equal(rows[0].followUpAllowed,false);
  await assert.rejects(app.read(f.actor,'own-export',{id:exportReference.batchId}),{status:410});
  await run(f.actor,'lead.delete',{leadId:lead.leadId,expectedRevision:4});
  assert.deepEqual((await app.read(f.owner,'leads')).items[0].contact,{});
  const audit=JSON.stringify(await f.database.query`SELECT minimal_diff FROM partner_audit_events`);assert.ok(!audit.includes('contact@example.test'));
 }finally{await f.close();}
});

test('activity is optional, pausable, revision-safe and deletable without changing pay eligibility',async()=>{
 const f=await partnerFixture();let time=Date.parse(TEST_NOW);
 try{
  const app=createPartnerApplication({database:f.database,env:ACTIVE_ENV,allowSyntheticOwner:true,now:()=>new Date(time)});
  const run=(action,input={})=>app.execute({actor:f.actor,action,input,key:randomUUID()});
  const timer=await run('activity.start');
  await assert.rejects(run('activity.start'),{status:409});
  time+=60000;const paused=await run('activity.pause',{activityId:timer.id,expectedRevision:1});assert.equal(paused.elapsedSeconds,60);
  time+=300000;await run('activity.resume',{activityId:timer.id,expectedRevision:2});
  time+=60000;const stopped=await run('activity.stop',{activityId:timer.id,expectedRevision:3});assert.equal(stopped.elapsedSeconds,120);
  await assert.rejects(run('activity.pause',{activityId:timer.id,expectedRevision:1}),{status:409});
  await run('activity.delete',{activityId:timer.id,expectedRevision:4});
  assert.equal((await app.read(f.actor,'activity')).items.length,0);
  assert.equal((await f.database.query`SELECT count(*)::int AS n FROM partner_payables`)[0].n,0);
 }finally{await f.close();}
});
