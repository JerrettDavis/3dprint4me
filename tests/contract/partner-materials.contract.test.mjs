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
