import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { splitStatements } from '../../scripts/migrate-neon.mjs';
import { createPostgresPartnerRepository } from '../../lib/partner-outreach/postgres-repository.js';

const uuid = randomUUID;
function adapter(db) {
  const query = target => async (strings,...values) => (await target.query(strings.reduce((s,p,i)=>s+(i?'$'+i:'')+p,''),values)).rows;
  return { query: query(db), withTransaction: operation => db.transaction(tx => operation({query:query(tx)})) };
}

test('command receipt, reservation, gig, audit and outbox commit once or roll back together', async () => {
 const db = new PGlite();
 try {
  for(const s of splitStatements(await readFile(new URL('../../neon/migrations/001_service_requests.sql',import.meta.url),'utf8')))await db.query(s);
  for(const s of splitStatements(await readFile(new URL('../../neon/migrations/012_partner_outreach.sql',import.meta.url),'utf8'))) await db.query(s);
  const database = adapter(db), repo = createPostgresPartnerRepository({database});
  const programId=uuid(), partnerId=uuid(), campaignId=uuid(), gigId=uuid();
  await database.query`INSERT INTO partner_programs(id,label,starts_on,enabled,synthetic) VALUES(${programId},'Synthetic','2026-10-01',true,true)`;
  await database.query`INSERT INTO partner_accounts(id,program_id,display_name,status) VALUES(${partnerId},${programId},'Synthetic','active')`;
  await database.query`INSERT INTO partner_campaigns(id,program_id,title,terms,status) VALUES(${campaignId},${programId},'Visits','{}','published')`;
  const terms={title:'Visits',feeCents:15000,maximumBonusCents:1000,bonusRules:[{id:'qualified-lead',trigger:'qualified_lead',amountCents:1000,maximumAwards:1,criteria:'Unique consented qualified project introduction.',qualifiesBy:'2026-12-31'}],tasks:['Visits'],materials:[],area:'Tulsa',deadline:'2026-12-01'};
  await database.query`INSERT INTO partner_gigs(id,program_id,partner_id,campaign_id,terms_snapshot,status) VALUES(${gigId},${programId},${partnerId},${campaignId},${JSON.stringify(terms)}::jsonb,'offered')`;
  const otherPartnerId=uuid();
  await database.query`INSERT INTO partner_accounts(id,program_id,display_name,status) VALUES(${otherPartnerId},${programId},'Other synthetic','active')`;
  const actor={role:'PARTNER',id:partnerId}, key=uuid();
  const command={actor,operation:'accept',key,payload:{gigId,revision:1}};
  const accept=tx=>repo.reserveGig(tx,{actor,gigId,expectedRevision:1,instant:'2026-10-23T12:00:00Z',authorizationApproved:true});
  const first=await repo.withCommand(command,accept);
  const retry=await repo.withCommand(command,()=>{throw new Error('Must not execute twice');});
  assert.deepEqual(retry,first); assert.equal(first.status,'accepted');
  await assert.rejects(database.query`UPDATE partner_gigs SET accepted_fee_cents=1 WHERE id=${gigId}`,/immutable/i);
  assert.equal(first.authorizationWeek,'2026-10-19'); assert.equal(first.feeCents,15000);
  assert.equal((await database.query`SELECT committed_cents FROM partner_program_weeks`)[0].committed_cents,16000);
  for(const table of ['partner_budget_reservations','partner_audit_events','partner_outbox'])assert.equal((await db.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n,1);
  await assert.rejects(repo.withCommand({...command,payload:{gigId,revision:2}},accept), {status:409});
  const denied=uuid();
  await assert.rejects(repo.withCommand({...command,key:denied},async tx=>{await tx.query`SELECT 1`;throw new Error('Injected failure');}),/Injected failure/);
  assert.equal((await database.query`SELECT count(*)::int AS n FROM partner_command_keys WHERE idempotency_key=${denied}`)[0].n,0);
  await assert.rejects(repo.withCommand({...command,key:uuid()},tx=>repo.reserveGig(tx,{actor:{role:'PARTNER',id:otherPartnerId},gigId,expectedRevision:1,instant:'2026-10-23T12:00:00Z',authorizationApproved:true})),{status:404});
  const secondGig=uuid();
  await database.query`INSERT INTO partner_gigs(id,program_id,partner_id,campaign_id,terms_snapshot,status) VALUES(${secondGig},${programId},${partnerId},${campaignId},${JSON.stringify(terms)}::jsonb,'offered')`;
  await assert.rejects(repo.withCommand({...command,key:uuid(),payload:{gigId:secondGig}},tx=>repo.reserveGig(tx,{actor,gigId:secondGig,expectedRevision:1,instant:'2026-10-23T12:00:00Z',authorizationApproved:true})),{status:409});
  assert.equal((await database.query`SELECT status FROM partner_gigs WHERE id=${secondGig}`)[0].status,'offered');
  assert.equal((await database.query`SELECT count(*)::int AS n FROM partner_budget_reservations`)[0].n,1);
  const nullCommand={actor,operation:'test_null',key:uuid(),payload:{b:2,a:1}};
  assert.equal(await repo.withCommand(nullCommand,async()=>null),null);
  assert.equal(await repo.withCommand({...nullCommand,payload:{a:1,b:2}},async()=>{throw new Error('Null response must also replay');}),null);
 } finally {await db.close();}
});
