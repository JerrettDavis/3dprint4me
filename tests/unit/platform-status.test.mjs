import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observeJob, readJobHealth } from '../../lib/platform/job-health.js';
import { collectPlatformStatus } from '../../lib/platform/status.js';
import { generateWeeklyStatements } from '../../lib/partner-outreach/statements.js';

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
