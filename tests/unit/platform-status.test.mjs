import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observeJob, readJobHealth } from '../../lib/platform/job-health.js';
import { collectPlatformStatus } from '../../lib/platform/status.js';
import { generateWeeklyStatements } from '../../lib/partner-outreach/statements.js';
import { PGlite } from '@electric-sql/pglite';
test('idle recovery requires an authoritative check and preserves a failed check',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'3dp-recovery-'));const env={PLATFORM_JOB_HEALTH_DIR:dir};
 try{
  await assert.rejects(observeJob('push',async()=>{throw Error('old failure');},{env}));
  await observeJob('push',async()=>({claimed:0}),{env,verifyRecovery:async()=>false});
  assert.equal((await readJobHealth('push',{directory:dir,maxAge:10000})).ok,false);
  await observeJob('push',async()=>({claimed:0}),{env,verifyRecovery:async()=>{throw Error('private database error');}});
  assert.equal((await readJobHealth('push',{directory:dir,maxAge:10000})).ok,false);
  await observeJob('push',async()=>({claimed:0}),{env,verifyRecovery:async()=>true});
  assert.equal((await readJobHealth('push',{directory:dir,maxAge:10000})).ok,true);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('analysis availability retains real failures but distinguishes terminal unsupported ready assets',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`CREATE TABLE operators(id text); CREATE TABLE notification_outbox(state text,next_attempt_at timestamptz,lease_expires_at timestamptz);
   CREATE TABLE print_assets(id text,state text);CREATE TABLE print_analysis_jobs(asset_id text,state text,last_error_category text,next_attempt_at timestamptz,lease_expires_at timestamptz);
   INSERT INTO print_assets VALUES('model','ready');INSERT INTO print_analysis_jobs VALUES('model','failed','unsupported',now(),NULL);`);
  const collect=()=>collectPlatformStatus({query:async(strings)=> (await db.query(strings.join(''))).rows,health:async()=>({ok:true})});
  assert.equal((await collect()).jobs,true,'An unsupported slice of a ready asset is not a worker outage');
  await db.exec(`UPDATE print_assets SET state='uploaded'`);assert.equal((await collect()).jobs,false);
  await db.exec(`UPDATE print_assets SET state='ready';UPDATE print_analysis_jobs SET last_error_category='temporary'`);assert.equal((await collect()).jobs,false);
  await db.exec(`UPDATE print_analysis_jobs SET last_error_category=NULL`);assert.equal((await collect()).jobs,false,'Unknown terminal failures remain visible');
  await db.exec(`UPDATE print_analysis_jobs SET state='pending',next_attempt_at=now()-interval '16 minutes'`);assert.equal((await collect()).jobs,false);
  await db.exec(`UPDATE print_analysis_jobs SET state='processing',lease_expires_at=now()-interval '16 minutes'`);assert.equal((await collect()).jobs,false);
 }finally{await db.close();}
});

for(const jobName of ['slicer','statements'])test(`${jobName} success/failure evidence is atomic, bounded and expires`,async()=>{
  const dir=await mkdtemp(join(tmpdir(),'3dp-health-'));
  try{
    const env={PLATFORM_JOB_HEALTH_DIR:dir};
    assert.equal(await observeJob(jobName,async()=>42,{env,now:()=>1000000}),42);
    assert.equal((await readJobHealth(jobName,{directory:dir,now:1000001,maxAge:720000})).ok,true);
    assert.equal((await readJobHealth(jobName,{directory:dir,now:2000000,maxAge:720000})).ok,false);
    await assert.rejects(()=>observeJob(jobName,async()=>{throw Error('private-token');},{env,now:()=>1000002}));
    assert.ok(!(await readFile(join(dir,jobName+'.json'),'utf8')).includes('private-token'));
    assert.equal((await readJobHealth(jobName,{directory:dir,now:1000003,maxAge:720000})).ok,false);
    await observeJob(jobName,async()=>({claimed:1,failed:1}),{env,now:()=>1000004});
    assert.equal((await readJobHealth(jobName,{directory:dir,now:1000005,maxAge:720000})).ok,false);
    await observeJob(jobName,async()=>({claimed:0,failed:0}),{env,now:()=>1000006});
    assert.equal((await readJobHealth(jobName,{directory:dir,now:1000007,maxAge:720000})).ok,false);
    await observeJob(jobName,async()=>({claimed:1,ready:1,failed:0,generated:1,skipped:1}),{env,now:()=>1000008});
    assert.equal((await readJobHealth(jobName,{directory:dir,now:1000009,maxAge:720000})).ok,true);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('platform telemetry projects aggregate evidence and never serializes configuration secrets',async()=>{
  const result=await collectPlatformStatus({query:async()=>[{id:'private-operator-id',healthy:true}],env:{DATABASE_DRIVER:'postgres',DATABASE_URL:'private-password',RESEND_API_KEY:'private-email-key',REQUEST_TO_EMAIL:'private@customer.example',REQUEST_FROM_EMAIL:'private@sender.example',BLOB_READ_WRITE_TOKEN:'private-blob'},health:async()=>({ok:true})});
  assert.equal(result.database,true);assert.equal(result.provider,'postgres');assert.equal(result.jobs,true);
  assert.equal(result.files,null);assert.equal(result.email,null);assert.equal(result.estimates,false);
  assert.ok(!JSON.stringify(result).includes('private'));
  const failed=await collectPlatformStatus({query:async()=>{throw Error('private-token');},env:{},health:async()=>({ok:false})});
  assert.equal(failed.database,false);assert.equal(failed.jobs,false);
  const stalled=await collectPlatformStatus({query:async()=>[{healthy:false}],env:{},health:async()=>({ok:true})});
  assert.equal(stalled.jobs,false);
});

test('overall jobs health includes missing, failed, idle-after-failure and stale statement evidence',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'3dp-statement-status-'));
  let now=1000000;
  const env={PLATFORM_JOB_HEALTH_DIR:dir};
  const otherJobs=['push','expiry','cleanup','slicer'];
  const refreshOthers=async()=>{for(const name of otherJobs)await observeJob(name,async()=>({claimed:1,ready:1}),{env,now:()=>now});};
  const collect=()=>collectPlatformStatus({query:async()=>[{healthy:true}],env:{DATABASE_DRIVER:'postgres'},health:(name,options)=>readJobHealth(name,{...options,directory:dir,now})});
  try{
    await refreshOthers();
    assert.equal((await collect()).jobs,false,'Missing statement evidence must not report all jobs healthy');
    await observeJob('statements',()=>generateWeeklyStatements({database:{query:async()=>[{ready:false}],withTransaction:async()=>{throw Error('Pre-migration idle must not write');}}}),{env,now:()=>now});
    assert.equal((await collect()).jobs,true,'A fresh successful pre-migration idle poll preserves unconfigured operation');
    await assert.rejects(observeJob('statements',async()=>{throw Error('PRIVATE-STATEMENT-ERROR');},{env,now:()=>now}));
    assert.equal((await collect()).jobs,false);
    await observeJob('statements',async()=>({claimed:0,generated:0}),{env,now:()=>now});
    assert.equal((await collect()).jobs,false,'An idle poll cannot demonstrate recovery');
    await observeJob('statements',async()=>({claimed:1,generated:1}),{env,now:()=>now});
    assert.equal((await collect()).jobs,true);
    now+=180001;await refreshOthers();
    const stale=await collect();
    assert.equal(stale.jobs,false,'Only statement evidence is stale');
    assert.ok(!JSON.stringify(stale).includes('PRIVATE'));
  }finally{await rm(dir,{recursive:true,force:true});}
});
