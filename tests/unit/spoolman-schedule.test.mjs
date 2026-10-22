import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalPrintRepository } from '../../lib/print-estimation/adapters/local-print-repository.js';
import { createSpoolmanScheduledTask } from '../../lib/spoolman/runtime.js';
import { observeJob,readJobHealth } from '../../lib/platform/job-health.js';
test('an idle Spoolman poll retains unhealthy evidence until a complete successful sync',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'spool-health-'));
 try {
  let time=new Date('2026-10-22T12:00:00Z'),fail=true,calls=0;
  const repo=createLocalPrintRepository({path:join(dir,'print.json'),now:()=>time});
  const tick=createSpoolmanScheduledTask({repository:repo,env:{SPOOLMAN_INSTANCE_ID:'home'},now:()=>time,provider:{configured:true,snapshot:async()=>{calls++;if(fail)throw Error('private');return {currency:'USD',spools:[]};}}});
  const run=()=>observeJob('spoolman',tick,{env:{PLATFORM_JOB_HEALTH_DIR:dir},now:()=>time.getTime()});
  const healthy=async()=>(await readJobHealth('spoolman',{directory:dir,now:time.getTime(),maxAge:60000})).ok;
  await run();assert.equal(await healthy(),false);
  time=new Date(time.getTime()+5000);await run();assert.equal(calls,1);assert.equal(await healthy(),false);
  time=new Date(time.getTime()+60000);fail=false;await run();assert.equal(calls,2);assert.equal(await healthy(),true);
  const disabled=createSpoolmanScheduledTask({repository:repo,env:{},provider:{configured:false}});
  await disabled();assert.equal((await repo.getSpoolmanStatus()).configured,false);
 } finally {await rm(dir,{recursive:true,force:true});}
});
