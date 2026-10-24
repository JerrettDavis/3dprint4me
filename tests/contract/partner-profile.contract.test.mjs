import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPartnerApplication } from '../../lib/partner-outreach/application.js';
import { partnerFixture,ACTIVE_ENV,TEST_NOW } from '../support/partner-fixture.mjs';

test('profile, own data and statement exports are scoped and exclude identity secrets',async()=>{
 const f=await partnerFixture();
 try{
  const env={...ACTIVE_ENV},app=createPartnerApplication({database:f.database,env,allowSyntheticOwner:true,now:()=>new Date(TEST_NOW)});
  const run=(actor,action,input)=>app.execute({actor,action,input,key:randomUUID()});
  await assert.rejects(run(f.actor,'profile.update',{expectedRevision:1,displayName:'Synthetic',role:'OWNER'}),{status:400});
  const updated=await run(f.actor,'profile.update',{expectedRevision:1,displayName:'Preferred name',preferredContact:'none',accessibility:'Large text helps',notificationOptOut:true});
  assert.equal(updated.revision,2);
  const profile=await app.read(f.actor,'profile');assert.equal(profile.program.newWorkAvailable,true);
  env.PARTNER_PROGRAM_ENABLED='0';assert.equal((await app.read(f.actor,'profile')).program.newWorkAvailable,false);
  const data=await run(f.actor,'profile.export',{});assert.equal(data.data.profile.display_name,'Preferred name');
  const serialized=JSON.stringify(data);for(const value of ['credential_hash','credential_version','token_hash','csrf_hash','ownerSessionHash',f.otherPartnerId])assert.ok(!serialized.includes(value),value);
  await assert.rejects(run(f.actor,'statement.export',{partnerId:f.otherPartnerId}),{status:404});
  const statement=await run(f.actor,'statement.export',{});assert.match(statement.csv,/amount_due_cents/);assert.equal(statement.partnerId,f.partnerId);
 }finally{await f.close();}
});
