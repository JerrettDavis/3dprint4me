import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { privateSnapshot,publicSnapshot,validateHeartbeat } from '../../status/lib/model.js';
import { operationsPage } from '../../status/lib/operations-page.js';
import { updateCapacity } from '../../status/lib/capacity.js';
import { StatusState } from '../../status/worker.js';

const now=Date.now();
const metric=(id='blob-transfer',extra={})=>({id,used:75,limit:100,observedAt:now,periodStart:null,periodEnd:now+86400000,source:'provider',scope:'account',...extra});
const signed=(kind,details,extra={})=>{
  const secret='s'.repeat(64),body=JSON.stringify({observedAt:now,nonce:'a'.repeat(32),details});
  return {kind,secret,body,signature:createHmac('sha256',secret).update('/heartbeat/'+kind+'\n'+body).digest('hex'),now,...extra};
};
test('legacy disk alerts cannot bypass fresh capacity sample confirmation',()=>{
const disk=metric('host-disk',{used:96,source:'local',scope:'host',periodEnd:null});
const platform={observedAt:now,details:{diskFreePercent:4}};
let capacity=updateCapacity({},[disk],now);
let view=privateSnapshot({capacity,platform},now);
assert.equal(view.capacity.metrics.find(x=>x.id==='host-disk').activeSeverity,'normal');
assert.ok(!view.blockers.some(x=>x.id==='disk'||x.id.startsWith('capacity-host-disk:')));
capacity=updateCapacity(capacity,[{...disk,observedAt:now+300000}],now+300000);
view=privateSnapshot({capacity,platform:{...platform,observedAt:now+300000}},now+300000);
assert.equal(view.blockers.filter(x=>x.id.startsWith('capacity-host-disk:')).length,1);
assert.ok(!view.blockers.some(x=>x.id==='disk'));
});
test('legacy disk evidence remains available without a current measurable capacity reading',()=>{
const platform={observedAt:now,details:{diskFreePercent:4}};
assert.ok(privateSnapshot({platform},now).blockers.some(x=>x.id==='disk'));
const disk=metric('host-disk',{used:96,source:'local',scope:'host',periodEnd:null,observedAt:now-13*60000});
const capacity=updateCapacity({},[disk],now-13*60000);
assert.ok(privateSnapshot({capacity,platform},now).blockers.some(x=>x.id==='disk'));
});
test('strict signed local capacity is accepted without exposing it in public projection',async()=>{
  const records=[metric('host-memory',{source:'local',scope:'host'})];
  await validateHeartbeat(signed('platform',{database:true,provider:'postgres',capacity:records}));
  await assert.rejects(()=>validateHeartbeat(signed('platform',{capacity:[metric()]})));
  await assert.rejects(()=>validateHeartbeat(signed('backup',{capacity:records})));
  await assert.rejects(()=>validateHeartbeat(signed('platform',{capacity:[{...records[0],url:'private'}]})));
  const state={capacity:updateCapacity({},[metric()],now),platform:{observedAt:now,details:{capacity:records}}};
  assert.ok(!JSON.stringify(publicSnapshot(state,now)).includes('capacity'));
  assert.ok(!JSON.stringify(publicSnapshot(state,now)).includes('blob-transfer'));
  const privateView=privateSnapshot(state,now);
  assert.equal(privateView.capacity.metrics.find(x=>x.id==='blob-transfer').status,'warning');
  assert.ok(privateView.blockers.some(x=>x.id.includes('capacity-blob-transfer')));
});
test('manual owner evidence has its own replay ordering and cannot renew control attestations',async()=>{
  const records=new Map([['state',{control:{observedAt:now-3600000,details:{ownerLoginVerified:true}}}]]);
  const ctx={storage:{get:async k=>records.get(k),put:async(k,v)=>records.set(k,v)},blockConcurrencyWhile:fn=>fn()};
  const secret='s'.repeat(64),actor=new StatusState(ctx,{STATUS_CONTROL_SECRET:secret});
  const args=signed('manual',{capacity:[metric('blob-transfer',{source:'manual',limitSource:'manual',limitVerifiedAt:now})]});
  const request=()=>new Request('https://status.internal/heartbeat/manual',{method:'POST',headers:{'x-status-signature':args.signature},body:args.body});
  assert.equal((await actor.fetch(request())).status,200);
  assert.equal(records.get('state').control.observedAt,now-3600000);
  assert.equal(records.get('state').capacity.readings[0].source,'manual');
  records.get('state').manual.receivedAt-=61000;
  assert.equal((await actor.fetch(request())).status,401);
  await assert.rejects(()=>validateHeartbeat(signed('manual',{capacity:[metric()]})));
  await assert.rejects(()=>validateHeartbeat(signed('manual',{ownerLoginVerified:true})));
});
test('capacity page escapes markup, stays bounded and displays private evidence semantics',async()=>{
  const state={capacity:updateCapacity({},[metric()],now)};
  const view=privateSnapshot(state,now);view.blockers.push({severity:'important',title:'<script>private</script>',next:'Review safely.'});
  for(const theme of ['light','dark','system']){
    const response=operationsPage(view,{theme});const html=await response.text();
    assert.match(html,/Capacity &amp; limits/);assert.match(html,/Blob transfer/);assert.match(html,/remaining/i);
    assert.match(html,/70%/);assert.match(html,/08:00/);assert.match(html,/unknown/i);
    assert.ok(!html.includes('<script>private</script>'));assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(new TextEncoder().encode(html).length<98304);
    assert.equal(response.headers.get('cache-control'),'no-store');
  }
});
test('actor persists capacity on signed heartbeat and public reads never trigger provider collection',async()=>{
  const records=new Map(),ctx={storage:{get:async k=>records.get(k),put:async(k,v)=>records.set(k,v)},blockConcurrencyWhile:fn=>fn()};
  const secret='s'.repeat(64),actor=new StatusState(ctx,{STATUS_PLATFORM_SECRET:secret});
  const args=signed('platform',{capacity:[metric('host-disk',{source:'local',scope:'host'})]});
  const request=new Request('https://status.internal/heartbeat/platform',{method:'POST',headers:{'x-status-signature':args.signature},body:args.body});
  assert.equal((await actor.fetch(request)).status,200);assert.equal(records.get('state').capacity.readings[0].id,'host-disk');
  const pub=await actor.fetch(new Request('https://status.internal/api/public'));
  assert.ok(!(await pub.text()).includes('host-disk'));
  assert.equal(records.get('state').providerCollectionAt,undefined);
});
test('scheduled actor caches provider reads hourly and failed refresh preserves measurement age',async t=>{
  let clock=now,providerReads=0,failed=false;
  t.mock.method(Date,'now',()=>clock);
  t.mock.method(globalThis,'fetch',async url=>{
    if(String(url).includes('api.resend.com/usage')){
      providerReads++;
      if(failed)return new Response('{}',{status:503});
      return Response.json({object:'usage',emails:{daily:{used:25,limit:100,resets_at:new Date(now+86400000).toISOString()}}});
    }
    if(String(url).endsWith('/api/health'))return Response.json({ok:true,service:'3dprint4.me',databaseProvider:'postgres'});
    if(String(url).includes('githubstatus'))return Response.json({page:{id:'kctbh9vrtdwd'},components:[{id:'brv1bkgrwx7q',status:'operational'}]});
    return new Response('<html id="auth-view">3dprint4.me</html>');
  });
  const records=new Map(),ctx={storage:{get:async k=>records.get(k),put:async(k,v)=>records.set(k,v)},blockConcurrencyWhile:fn=>fn()};
  const actor=new StatusState(ctx,{ALERT_RESEND_KEY:'fake-test-key'});
  const probe=()=>actor.fetch(new Request('https://status.internal/internal/probe',{method:'POST'}));
  assert.equal((await probe()).status,200);assert.equal(providerReads,1);
  const original=records.get('state').capacity.readings.find(x=>x.id==='resend-daily').observedAt;
  clock+=5*60000;await probe();assert.equal(providerReads,1);
  await actor.fetch(new Request('https://status.internal/operations'));assert.equal(providerReads,1);
  clock+=3600000;failed=true;await probe();assert.equal(providerReads,2);
  assert.equal(records.get('state').capacity.readings.find(x=>x.id==='resend-daily').observedAt,original);
  assert.equal(records.get('state').providerAvailability.resend.status,'unavailable');
  clock=now+3*3600000;
  assert.equal(privateSnapshot(records.get('state'),clock).capacity.metrics.find(x=>x.id==='resend-daily').status,'stale');
});
