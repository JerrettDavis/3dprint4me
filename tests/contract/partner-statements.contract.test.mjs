import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPartnerApplication} from '../../lib/partner-outreach/application.js';
import {generateWeeklyStatements} from '../../lib/partner-outreach/statements.js';
import {partnerFixture,ACTIVE_ENV,TEST_NOW} from '../support/partner-fixture.mjs';

test('owner schedules immutable private weekly balances; retries do not rewrite after payment',async()=>{
 const f=await partnerFixture();let instant=new Date(TEST_NOW);
 try{
  const app=createPartnerApplication({database:f.database,env:ACTIVE_ENV,allowSyntheticOwner:true,now:()=>instant});
  const run=(actor,action,input)=>app.execute({actor,action,input,key:randomUUID()});
  await f.database.query`UPDATE partner_accounts SET credential_hash=${'a'.repeat(64)} WHERE program_id=${f.programId}`;
  const terms={title:'Synthetic statements',feeCents:5000,maximumBonusCents:0,tasks:['Permitted voluntary visits'],materials:[],area:'Tulsa',deadline:'2026-12-31'};
  const c=await run(f.owner,'campaign.create',{programId:f.programId,terms});await run(f.owner,'campaign.publish',{campaignId:c.id,expectedRevision:1});
  const g=await run(f.owner,'gig.offer',{campaignId:c.id,partnerId:f.partnerId});await run(f.actor,'gig.accept',{gigId:g.id,expectedRevision:1});await run(f.actor,'gig.submit',{gigId:g.id,expectedRevision:2});await run(f.owner,'gig.approve',{gigId:g.id,expectedRevision:3});await run(f.owner,'gig.make_payable',{gigId:g.id,expectedRevision:4});const [payable]=await f.database.query`SELECT id FROM partner_payables WHERE gig_id=${g.id}`;
  await run(f.owner,'payment.record',{payableId:payable.id,amountCents:2000,paymentReference:'PRIVATE-SETTLEMENT-REFERENCE',method:'cash',occurredAt:instant.toISOString(),verified:true});
  await assert.rejects(run(f.actor,'statement.schedule',{programId:f.programId,expectedRevision:1,enabled:true}),{status:403});
  await assert.rejects(run(f.owner,'statement.schedule',{programId:f.programId,expectedRevision:1,enabled:'yes'}),{status:400});
  const scheduled=await run(f.owner,'statement.schedule',{programId:f.programId,expectedRevision:1,enabled:true});assert.equal(scheduled.firstDueWeek,'2026-10-26');assert.equal(scheduled.revision,2);
  const [program]=await f.database.query`SELECT settings FROM partner_programs WHERE id=${f.programId}`;assert.equal(program.settings.contractVersionId,f.versionId);
  assert.equal((await generateWeeklyStatements({database:f.database,now:()=>instant})).generated,0);
  instant=new Date('2026-10-26T12:00:00Z');
  assert.equal((await generateWeeklyStatements({database:f.database,now:()=>instant})).generated,2);
  const own=await app.read(f.actor,'statements');assert.equal(own.items.length,1);assert.equal(own.items[0].weekStart,'2026-10-26');
  const file=await app.read(f.actor,'statements',{id:own.items[0].id});assert.match(file.csv,/,5000,2000,3000,/);assert.ok(!file.csv.includes('PRIVATE'));assert.equal(file.asOf,instant.toISOString());
  const other=await app.read(f.otherActor,'statements');assert.equal(other.items.length,1);await assert.rejects(app.read(f.actor,'statements',{id:other.items[0].id}),{status:404});
  await run(f.owner,'payment.record',{payableId:payable.id,amountCents:1000,paymentReference:'PRIVATE-LATER',method:'cash',occurredAt:instant.toISOString(),verified:true});
  assert.equal((await generateWeeklyStatements({database:f.database,now:()=>instant})).generated,0);
  assert.deepEqual(await app.read(f.actor,'statements',{id:file.id}),file);
  const [audit]=await f.database.query`SELECT count(*)::int AS count FROM partner_audit_events WHERE action='statement.generated'`;assert.equal(audit.count,2);
  await assert.rejects(f.database.query`UPDATE partner_weekly_statements SET csv='changed' WHERE id=${file.id}`);
  await assert.rejects(f.database.query`DELETE FROM partner_weekly_statements WHERE id=${file.id}`);
  const disabled=await run(f.owner,'statement.schedule',{programId:f.programId,expectedRevision:2,enabled:false});assert.equal(disabled.revision,3);
  assert.equal((await generateWeeklyStatements({database:f.database,now:()=>new Date('2026-11-02T12:00Z')})).generated,0);
  assert.equal((await app.read(f.owner,'statements',{programId:f.programId})).items.length,2);
 }finally{await f.close();}
});

test('failed snapshot transaction rolls back only its account; retry finishes remaining work without duplicates',async()=>{
 const f=await partnerFixture({reviewed:false});try{
  await f.database.query`UPDATE partner_accounts SET credential_hash=${'a'.repeat(64)} WHERE program_id=${f.programId}`;
  const app=createPartnerApplication({database:f.database,allowSyntheticOwner:true,now:()=>new Date(TEST_NOW)});
  await app.execute({actor:f.owner,action:'statement.schedule',input:{programId:f.programId,expectedRevision:1,enabled:true},key:randomUUID()});
  let fail=true;
  const interrupted={query:f.database.query,withTransaction:fn=>f.database.withTransaction(async tx=>{const result=await fn(tx);if(fail){fail=false;throw Error('PRIVATE-TRANSACTION-DETAIL');}return result;})};
  await assert.rejects(generateWeeklyStatements({database:interrupted,now:()=>new Date('2026-10-26T12:00Z')}),e=>e.message==='Weekly statement generation unavailable.');
  let [count]=await f.database.query`SELECT count(*)::int AS count FROM partner_weekly_statements`;assert.equal(count.count,1);
  let [audit]=await f.database.query`SELECT count(*)::int AS count FROM partner_audit_events WHERE action='statement.generated'`;assert.equal(audit.count,1);
  assert.equal((await generateWeeklyStatements({database:f.database,now:()=>new Date('2026-10-26T12:00Z')})).generated,1);
  [count]=await f.database.query`SELECT count(*)::int AS count FROM partner_weekly_statements`;assert.equal(count.count,2);
  [audit]=await f.database.query`SELECT count(*)::int AS count FROM partner_audit_events WHERE action='statement.generated'`;assert.equal(audit.count,2);
 }finally{await f.close();}
});
test('a batch crossing a Central Monday never generates an earlier-week balance after its lock wait',async()=>{
 const f=await partnerFixture({reviewed:false});try{
  await f.database.query`UPDATE partner_accounts SET credential_hash=${'a'.repeat(64)} WHERE program_id=${f.programId}`;
  await f.database.query`UPDATE partner_programs SET settings='{"weeklyStatements":{"enabled":true,"firstDueWeek":"2026-10-26"}}'::jsonb WHERE id=${f.programId}`;
  let calls=0;const result=await generateWeeklyStatements({database:f.database,now:()=>new Date(calls++===0?'2026-11-02T05:59:59Z':'2026-11-02T06:00:00Z')});assert.equal(result.generated,0);assert.equal(result.skipped,2);
  assert.equal((await generateWeeklyStatements({database:f.database,now:()=>new Date('2026-11-02T06:00:00Z')})).generated,2);
  const rows=await f.database.query`SELECT week_start_local::text AS week_start_local,generated_at FROM partner_weekly_statements`;for(const row of rows){assert.equal(String(row.week_start_local).slice(0,10),'2026-11-02');assert.equal(new Date(row.generated_at).toISOString(),'2026-11-02T06:00:00.000Z');}
 }finally{await f.close();}
});

test('more than 500 saved statements remain pageable without blocking owner schedule controls',async()=>{
 const f=await partnerFixture({reviewed:false});try{
  await f.database.query`WITH accounts AS (INSERT INTO partner_accounts(id,program_id,display_name,status) SELECT gen_random_uuid(),${f.programId},'Synthetic history','active' FROM generate_series(1,501) RETURNING id) INSERT INTO partner_weekly_statements(id,program_id,partner_id,week_start_local,generated_at,record_count,csv,sha256) SELECT gen_random_uuid(),${f.programId},id,'2026-10-26','2026-10-26T12:00Z',0,'header',${'a'.repeat(64)} FROM accounts`;
  const app=createPartnerApplication({database:f.database,allowSyntheticOwner:true,now:()=>new Date(TEST_NOW)});
  let page=await app.read(f.owner,'statements'),seen=new Set();assert.equal(page.items.length,100);assert.equal(page.schedules.length,1);
  for(;;){for(const item of page.items){assert.ok(!seen.has(item.id));seen.add(item.id);}if(!page.nextCursor)break;page=await app.read(f.owner,'statements',{before:page.nextCursor});}
  assert.equal(seen.size,501);
  const disabled=await app.execute({actor:f.owner,action:'statement.schedule',input:{programId:f.programId,expectedRevision:1,enabled:false},key:randomUUID()});assert.equal(disabled.enabled,false);
  await assert.rejects(app.read(f.actor,'statements',{before:seen.values().next().value}),{status:404});
 }finally{await f.close();}
});
