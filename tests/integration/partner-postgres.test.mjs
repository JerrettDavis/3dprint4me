import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { splitStatements } from '../../scripts/migrate-neon.mjs';
import { createNativeDatabase, nativePoolOptions } from '../../lib/database.js';
import { createPostgresPartnerRepository } from '../../lib/partner-outreach/postgres-repository.js';

const IMAGE='postgres:18@sha256:edb0c08dc33befd0262ab3b5cf1c4f3f8cfd8b09e88c05b45adee29d6761ddb6';
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:90000,stdio:['pipe','pipe','pipe']}).trim();

test('native PostgreSQL 18 enforces permissions, concurrent ceilings, replay and additive restore', {timeout:120000}, async()=>{
 const name='3dprint4me-partner-test-'+randomUUID().slice(0,8);
 let admin, database, started=false;
 try {
  docker('run','--detach','--rm','--name',name,'--label','3dprint4me.purpose=partner-integration','--publish','127.0.0.1::5432','--env','POSTGRES_HOST_AUTH_METHOD=trust',IMAGE);
  started=true;
  const inspect=JSON.parse(docker('inspect',name))[0];
  const port=inspect.NetworkSettings.Ports['5432/tcp'][0].HostPort;
  const url=`postgresql://postgres@127.0.0.1:${port}/postgres`;
  admin=new pg.Pool(nativePoolOptions(url));
  let ready=false;
  for(let i=0;i<80;i++){try {await admin.query('SELECT 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}
  assert.equal(ready,true,'isolated database becomes ready');
  await admin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC; CREATE ROLE platform_backend NOLOGIN; CREATE ROLE platform_app LOGIN IN ROLE platform_backend; CREATE ROLE partner_visitor LOGIN; GRANT USAGE ON SCHEMA public TO platform_backend');
  const sql=await readFile(new URL('../../neon/migrations/012_partner_outreach.sql',import.meta.url),'utf8');
  for(let i=0;i<2;i++)for(const statement of splitStatements(sql))await admin.query(statement);
  const programId=randomUUID(),campaignId=randomUUID(),partners=[randomUUID(),randomUUID()],gigs=[randomUUID(),randomUUID()];
  await admin.query("INSERT INTO partner_programs(id,label,starts_on,enabled,synthetic) VALUES($1,'Synthetic','2026-10-01',true,true)",[programId]);
  await admin.query("INSERT INTO partner_campaigns(id,program_id,title,terms,status) VALUES($1,$2,'Visits','{}','published')",[campaignId,programId]);
  const terms={title:'Visits',feeCents:15000,maximumBonusCents:0,tasks:['Visits'],materials:[],area:'Tulsa',deadline:'2026-12-01'};
  for(let i=0;i<2;i++){
   await admin.query("INSERT INTO partner_accounts(id,program_id,display_name,status) VALUES($1,$2,'Synthetic','active')",[partners[i],programId]);
   await admin.query("INSERT INTO partner_gigs(id,program_id,partner_id,campaign_id,terms_snapshot,status) VALUES($1,$2,$3,$4,$5,'offered')",[gigs[i],programId,partners[i],campaignId,JSON.stringify(terms)]);
  }
  const pool=new pg.Pool(nativePoolOptions(url.replace('postgres@','platform_app@')));
  database=createNativeDatabase({pool});
  const repo=createPostgresPartnerRepository({database});
  const accept=(index,key=randomUUID())=>{
   const actor={role:'PARTNER',id:partners[index]};
   return repo.withCommand({actor,operation:'accept',key,payload:{gigId:gigs[index],revision:1}},tx=>repo.reserveGig(tx,{actor,gigId:gigs[index],expectedRevision:1,instant:'2026-10-23T12:00:00Z',authorizationApproved:true}));
  };
  const outcomes=await Promise.allSettled([accept(0),accept(1)]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(outcomes.find(x=>x.status==='rejected').reason.status,409);
  assert.equal((await admin.query('SELECT committed_cents FROM partner_program_weeks')).rows[0].committed_cents,15000);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM partner_budget_reservations')).rows[0].n,1);
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM partner_gigs WHERE status='offered'")).rows[0].n,1);
  const winner=outcomes.findIndex(x=>x.status==='fulfilled'),loser=1-winner;
  // A separate week lets the second offer test simultaneous identical commands.
  await admin.query('UPDATE partner_program_weeks SET cap_cents=40000');
  const replayKey=randomUUID();
  const [one,two]=await Promise.all([accept(loser,replayKey),accept(loser,replayKey)]);
  assert.deepEqual(one,two);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM partner_budget_reservations')).rows[0].n,2);
  assert.equal((await admin.query('SELECT committed_cents FROM partner_program_weeks')).rows[0].committed_cents,30000);
  await assert.rejects(pool.query('DELETE FROM partner_accounts'),e=>e.code==='42501');
  await assert.rejects(pool.query('UPDATE partner_budget_reservations SET amount_cents=0'),e=>e.code==='42501');
  const visitor=new pg.Pool(nativePoolOptions(url.replace('postgres@','partner_visitor@')));
  try{for(const table of ['partner_accounts','partner_legal_versions','partner_payment_events'])await assert.rejects(visitor.query('SELECT * FROM '+table),e=>e.code==='42501');}finally{await visitor.end();}
  await admin.query('CREATE DATABASE partner_restore');
  // Only this synthetic disposable container is touched. Stream the dump as
  // bytes, never a filesystem export or a production connection.
  const dump=execFileSync('docker',['exec',name,'pg_dump','-U','postgres','-Fc','postgres'],{timeout:30000,maxBuffer:20*1024*1024});
  execFileSync('docker',['exec','-i',name,'pg_restore','-U','postgres','-d','partner_restore','--exit-on-error'],{input:dump,timeout:30000});
  const restoreUrl=new URL(url);restoreUrl.pathname='/partner_restore';
  const restored=new pg.Pool(nativePoolOptions(restoreUrl.toString()));
  try{
   assert.equal((await restored.query('SELECT committed_cents FROM partner_program_weeks')).rows[0].committed_cents,30000);
   assert.equal((await restored.query('SELECT count(*)::int AS n FROM partner_command_keys')).rows[0].n,2);
   assert.equal((await restored.query('SELECT count(*)::int AS n FROM partner_audit_events')).rows[0].n,2);
   await assert.rejects(restored.query('UPDATE partner_budget_reservations SET amount_cents=0'),/immutable/i);
  }finally{await restored.end();}
 }finally{
  await database?.close();await admin?.end();
  // Fixed prefix, fresh UUID and ownership label prevent touching other stacks.
  const owned=started?JSON.parse(docker('inspect',name))[0]:null;
  if(owned?.Config.Labels['3dprint4me.purpose']==='partner-integration')docker('stop',name);
 }
});
