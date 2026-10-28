import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPartnerApplication } from '../../lib/partner-outreach/application.js';
import { partnerFixture,ACTIVE_ENV,TEST_NOW } from '../support/partner-fixture.mjs';
test('supplied materials are auditable, returns cannot exceed issuance and never change compensation',async()=>{
 const f=await partnerFixture();
 try{
  const app=createPartnerApplication({database:f.database,env:ACTIVE_ENV,allowSyntheticOwner:true,now:()=>new Date(TEST_NOW)});
  const run=(actor,action,input)=>app.execute({actor,action,input,key:randomUUID()});
  const terms={title:'Visits',feeCents:5000,maximumBonusCents:0,tasks:['Permitted introductions'],materials:['Samples'],area:'Tulsa',deadline:'2026-12-01'};
  const c=await run(f.owner,'campaign.create',{programId:f.programId,terms});await run(f.owner,'campaign.publish',{campaignId:c.id,expectedRevision:1});
  const gig=await run(f.owner,'gig.offer',{campaignId:c.id,partnerId:f.partnerId});await run(f.actor,'gig.accept',{gigId:gig.id,expectedRevision:1});
  await assert.rejects(run(f.actor,'material.record',{gigId:gig.id,eventType:'issued',items:[{label:'Sample signs',count:5}]}),{status:403});
  await run(f.owner,'material.record',{gigId:gig.id,eventType:'issued',items:[{label:'Sample signs',count:5}]});
  await run(f.owner,'material.record',{gigId:gig.id,eventType:'returned',items:[{label:'Sample signs',count:3}]});
  await assert.rejects(run(f.owner,'material.record',{gigId:gig.id,eventType:'returned',items:[{label:'Sample signs',count:3}]}),{status:409});
  const detail=await app.read(f.actor,'gig',{id:gig.id});assert.equal(detail.materials.length,2);assert.equal(detail.item.feeCents,5000);
 }finally{await f.close();}
});

test('material history returns newest 200 with an explicit partial-history flag and private scope',async()=>{
 const f=await partnerFixture();try{
  const app=createPartnerApplication({database:f.database,env:ACTIVE_ENV,allowSyntheticOwner:true,now:()=>new Date(TEST_NOW)}),run=(actor,action,input)=>app.execute({actor,action,input,key:randomUUID()});
  const c=await run(f.owner,'campaign.create',{programId:f.programId,terms:{title:'History',feeCents:5000,maximumBonusCents:0,tasks:['Permitted visits'],materials:[],area:'Tulsa',deadline:'2026-12-01'}});await run(f.owner,'campaign.publish',{campaignId:c.id,expectedRevision:1});
  const gig=await run(f.owner,'gig.offer',{campaignId:c.id,partnerId:f.partnerId});
  await f.database.query`INSERT INTO partner_material_events(id,gig_id,event_type,items,actor_id,created_at) SELECT gen_random_uuid(),${gig.id},'issued','[{"label":"Synthetic samples","count":1}]'::jsonb,'synthetic-owner','2026-10-23T12:00Z'::timestamptz + n*interval '1 second' FROM generate_series(1,201) n`;
  const detail=await app.read(f.actor,'gig',{id:gig.id});assert.equal(detail.materials.length,200);assert.equal(detail.materialsHasMore,true);assert.equal(new Date(detail.materials[0].created_at).toISOString(),'2026-10-23T12:03:21.000Z');
  assert.deepEqual((await app.read(f.owner,'gig',{id:gig.id})).materials,detail.materials);
  await assert.rejects(app.read(f.otherActor,'gig',{id:gig.id}),{status:404});
 }finally{await f.close();}
});
