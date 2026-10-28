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
  const reference=await run(f.actor,'profile.export',{});assert.equal(reference.data,undefined);
  const data=await app.read(f.actor,'own-export',{id:reference.batchId});assert.equal(data.data.profile.display_name,'Preferred name');
  await assert.rejects(app.read(f.otherActor,'own-export',{id:reference.batchId}),{status:404});
  const serialized=JSON.stringify(data);for(const value of ['credential_hash','credential_version','token_hash','csrf_hash','ownerSessionHash',f.otherPartnerId])assert.ok(!serialized.includes(value),value);
  await assert.rejects(run(f.actor,'statement.export',{partnerId:f.otherPartnerId}),{status:404});
  const statement=await run(f.actor,'statement.export',{});assert.match(statement.csv,/amount_due_cents/);assert.equal(statement.partnerId,f.partnerId);
 }finally{await f.close();}
});

test('derived exports expire and profile corrections erase old export bytes without retaining PII in receipts',async()=>{
 const f=await partnerFixture();let time=Date.parse(TEST_NOW);
 try{
  const app=createPartnerApplication({database:f.database,env:ACTIVE_ENV,allowSyntheticOwner:true,now:()=>new Date(time)});
  const run=(action,input)=>app.execute({actor:f.actor,action,input,key:randomUUID()});
  await run('profile.update',{expectedRevision:1,email:'old-private@example.test',preferredContact:'email'});
  const first=await run('profile.export',{});
  assert.equal((await app.read(f.actor,'own-export',{id:first.batchId})).data.profile.profile.email,'old-private@example.test');
  await run('profile.update',{expectedRevision:2,email:'new-private@example.test'});
  await assert.rejects(app.read(f.actor,'own-export',{id:first.batchId}),{status:410});
  const retained=JSON.stringify(await f.database.query`SELECT response_json FROM partner_command_keys`)+JSON.stringify(await f.database.query`SELECT manifest FROM partner_export_batches`)+JSON.stringify(await f.database.query`SELECT payload FROM partner_export_payloads`);
  assert.ok(!retained.includes('old-private@example.test'));assert.ok(!retained.includes('new-private@example.test'));
  const second=await run('profile.export',{});time+=25*3600000;
  await assert.rejects(app.read(f.actor,'own-export',{id:second.batchId}),{status:410});
  assert.deepEqual((await f.database.query`SELECT payload FROM partner_export_payloads WHERE batch_id=${second.batchId}`)[0].payload,{});
 }finally{await f.close();}
});
