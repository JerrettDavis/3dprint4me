import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observeJob, readJobHealth } from '../../lib/platform/job-health.js';
import { collectPlatformStatus } from '../../lib/platform/status.js';

test('job success/failure evidence is atomic, bounded and expires',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'3dp-health-'));
  try{
    const env={PLATFORM_JOB_HEALTH_DIR:dir};
    assert.equal(await observeJob('slicer',async()=>42,{env,now:()=>1000000}),42);
    assert.equal((await readJobHealth('slicer',{directory:dir,now:1000001,maxAge:720000})).ok,true);
    assert.equal((await readJobHealth('slicer',{directory:dir,now:2000000,maxAge:720000})).ok,false);
    await assert.rejects(()=>observeJob('slicer',async()=>{throw Error('private-token');},{env,now:()=>1000002}));
    assert.ok(!(await readFile(join(dir,'slicer.json'),'utf8')).includes('private-token'));
    assert.equal((await readJobHealth('slicer',{directory:dir,now:1000003,maxAge:720000})).ok,false);
    await observeJob('slicer',async()=>({claimed:1,failed:1}),{env,now:()=>1000004});
    assert.equal((await readJobHealth('slicer',{directory:dir,now:1000005,maxAge:720000})).ok,false);
    await observeJob('slicer',async()=>({claimed:0,failed:0}),{env,now:()=>1000006});
    assert.equal((await readJobHealth('slicer',{directory:dir,now:1000007,maxAge:720000})).ok,false);
    await observeJob('slicer',async()=>({claimed:1,ready:1,failed:0}),{env,now:()=>1000008});
    assert.equal((await readJobHealth('slicer',{directory:dir,now:1000009,maxAge:720000})).ok,true);
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
