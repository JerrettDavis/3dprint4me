import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { publicSnapshot, privateSnapshot, validateHeartbeat, probeServices, updateProbeState } from '../../status/lib/model.js';
import worker, { StatusState } from '../../status/worker.js';

const now=1800000000000;
test('restore evidence survives daily control expiry without refreshing billing or manual checks',async()=>{
  const secret='a'.repeat(64);
  const body=JSON.stringify({observedAt:now,nonce:'b'.repeat(32),details:{restoreVerifiedAt:now,neonPlan:'free',neonVerifiedAt:now,neonOffloaded:true,sourceQuiet:true,backupUnattended:true,offsiteVerified:true,credentialsReady:true,ownerLoginVerified:true,cutoverVerified:true}});
  const signature=createHmac('sha256',secret).update('/heartbeat/control\n'+body).digest('hex');
  const control=await validateHeartbeat({kind:'control',body,signature,secret,now});
  const blockersAt=time=>privateSnapshot({control,platform:{observedAt:time,details:{provider:'postgres',jobs:true}}},time).blockers.map(x=>x.id);
  assert.ok(!blockersAt(now).includes('restore-drill'));
  const dayTwo=blockersAt(now+2*86400000);
  assert.ok(!dayTwo.includes('restore-drill'),'a two-day-old restore is still within the 30-day window');
  for(const id of ['neon-billing','backup-scheduler','offsite','neon-exit','credentials','owner-login','cutover'])assert.ok(dayTwo.includes(id),id+' still requires daily evidence');
  assert.ok(!blockersAt(now+30*86400000).includes('restore-drill'));
  assert.ok(blockersAt(now+30*86400000+1).includes('restore-drill'));
});
test('restore evidence rejects invalid timestamps and future control containers',()=>{
  const warns=(observedAt,restoreVerifiedAt)=>privateSnapshot({control:{observedAt,details:{restoreVerifiedAt}}},now).blockers.some(x=>x.id==='restore-drill');
  for(const timestamp of [undefined,NaN,Infinity,now+31000,now-30*86400000-1])assert.equal(warns(now,timestamp),true);
  assert.equal(warns(now+31000,now),true,'a future container cannot supply valid restore evidence');
  assert.equal(warns(NaN,now),true);
  assert.equal(warns(now-30*86400000-1,now),true,'expired containers cannot supply newer restore claims');
});
test('status expires evidence and public output projects only safe capability fields',()=>{
  const state={checkedAt:now,probes:{storefront:{ok:true,checkedAt:now},operator:{ok:true,checkedAt:now},api:{ok:true,provider:'postgres',checkedAt:now},auth:{ok:true,checkedAt:now}},platform:{observedAt:now,details:{database:true,provider:'postgres',email:true,files:true,estimates:true,jobs:true,diskFreePercent:50}},control:{observedAt:now,details:{neonPlan:'paid',neonOffloaded:false}},secret:'do-not-publish',blockers:[{title:'private-secret'}]};
  const snapshot=publicSnapshot(state,now);
  assert.equal(snapshot.components.find(x=>x.id==='requests').status,'operational');
  assert.ok(!JSON.stringify(snapshot).includes('private-secret'));
  assert.ok(!JSON.stringify(snapshot).includes('do-not-publish'));
  assert.ok(!JSON.stringify(snapshot).includes('neonPlan'));
  assert.equal(publicSnapshot(state,now+13*60000).components.find(x=>x.id==='requests').status,'unknown');
  assert.ok(privateSnapshot(state,now).blockers.some(x=>x.id==='neon-exit'));
  assert.ok(privateSnapshot(state,now).blockers.some(x=>x.id==='backup-missing'));
});
test('signed heartbeat binds path, rejects stale/future/replayed and unknown data',async()=>{
  const secret='a'.repeat(64),data={observedAt:now,nonce:'b'.repeat(32),details:{database:true,provider:'postgres',email:false,files:true,estimates:true,jobs:false,diskFreePercent:50}};
  const sign=(path,body)=>createHmac('sha256',secret).update(path+'\n'+body).digest('hex');
  const body=JSON.stringify(data),signature=sign('/heartbeat/platform',body);
  assert.equal((await validateHeartbeat({kind:'platform',body,signature,secret,now})).observedAt,now);
  for(const args of [{body:body+' '},{kind:'backup'},{lastObservedAt:now},{now:now+91000},{now:now-31000},{secret:''},{body:'x'.repeat(16385)}])await assert.rejects(()=>validateHeartbeat({kind:'platform',body,signature,secret,now,...args}));
  const bad=JSON.stringify({...data,details:{...data.details,databaseUrl:'private'}});
  await assert.rejects(()=>validateHeartbeat({kind:'platform',body:bad,signature:sign('/heartbeat/platform',bad),secret,now}));
});
test('probes use fixed bounded URLs, never query Neon, and visitors cannot trigger probes',async()=>{
  const seen=[];
  const result=await probeServices({now,fetchImpl:async(url,options)=>{seen.push([url,options]);return new Response('<!doctype html><title>3dprint4.me</title>',{status:200});}});
  assert.equal(seen.length,4);
  assert.ok(seen.every(([url,opt])=>!url.includes('neon')&&opt.redirect==='manual'&&opt.signal));
  assert.equal(result.storefront.ok,true);
  assert.equal(result.auth.ok,false,'HTML is not valid GitHub status evidence');
  const state=updateProbeState({},result,now);
  assert.equal(state.probes.auth.status,'degraded');
  const twice=updateProbeState(state,result,now+300000);
  assert.equal(twice.probes.auth.status,'unavailable');
});
test('status transport denies private and internal routes; actor persists replay ordering',async()=>{
  let calls=0;
  const env={STATUS_STATE:{idFromName:x=>x,get:()=>({fetch:async()=>{calls++;return Response.json({ok:true});}})}};
  assert.equal((await worker.fetch(new Request('https://status.example/operations'),env)).status,403);
  assert.equal((await worker.fetch(new Request('https://status.example/internal/probe',{method:'POST'}),env)).status,404);
  assert.equal(calls,0);
  assert.equal((await worker.fetch(new Request('https://status.example/operations-reader'),env)).status,403);
  const readerSecret='e'.repeat(64),readerTime=String(Date.now());
  const signedRead=new Request('https://status.example/operations-reader',{headers:{'x-status-read-time':readerTime,'x-status-read-signature':createHmac('sha256',readerSecret).update('/operations-reader\n'+readerTime).digest('hex')}});
  assert.equal((await worker.fetch(signedRead,{...env,STATUS_READER_SECRET:readerSecret})).status,200);
  assert.equal(calls,1);calls=0;
  const publicResponse=await worker.fetch(new Request('https://status.example/api/public',{headers:{origin:'https://evil.example'}}),env);
  assert.equal(publicResponse.headers.get('access-control-allow-origin'),null);assert.equal(calls,1);
  const records=new Map();const ctx={storage:{get:async k=>records.get(k),put:async(k,v)=>records.set(k,v)},blockConcurrencyWhile:fn=>fn()};
  const secret='c'.repeat(64),time=Date.now();
  const actor=new StatusState(ctx,{STATUS_PLATFORM_SECRET:secret});
  const body=JSON.stringify({observedAt:time,nonce:'a'.repeat(32),details:{database:true,provider:'postgres'}});
  const request=()=>new Request('https://status.example/heartbeat/platform',{method:'POST',headers:{'x-status-signature':createHmac('sha256',secret).update('/heartbeat/platform\n'+body).digest('hex')},body});
  assert.equal((await actor.fetch(request())).status,200);
  records.get('state').platform.receivedAt-=61000;
  assert.equal((await new StatusState(ctx,{STATUS_PLATFORM_SECRET:secret}).fetch(request())).status,401);
  assert.equal((await actor.fetch(new Request('https://internal/api/public'))).status,200);
});

test('GitHub monitoring uses provider status without shared-IP REST credentials or unrelated incidents',async()=>{
  const payload=(status='operational',id='brv1bkgrwx7q')=>({page:{id:'kctbh9vrtdwd'},components:[{id,status},{id:'br0l2tvcx85d',status:'major_outage'}]});
  const run=async(data,status=200)=>probeServices({now,fetchImpl:async(url,opt)=>{
    if(url.includes('github')){
      assert.equal(url,'https://www.githubstatus.com/api/v2/components.json');
      assert.equal(opt.method,'GET');assert.equal(opt.redirect,'manual');
      assert.equal(opt.headers.Authorization,undefined);
      return Response.json(data,{status});
    }
    return new Response('3dprint4.me');
  }});
  assert.equal((await run(payload())).auth.ok,true);
  assert.equal((await run(payload('partial_outage'))).auth.ok,false);
  assert.equal((await run(payload('operational','unknown'))).auth.ok,false);
  assert.equal((await run({...payload(),page:{id:'wrong'}})).auth.ok,false);
  assert.equal((await run(payload(),403)).auth.ok,false);
  assert.equal(publicSnapshot({},now).components.find(x=>x.id==='auth').scope,'GitHub-reported API service status; owner sign-in verified separately');
});
