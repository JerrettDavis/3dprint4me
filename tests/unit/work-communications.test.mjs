import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalWorkRepository } from '../../lib/work-management/adapters/local-work-repository.js';
import { createLocalCommunicationRepository } from '../../lib/work-communications/local-repository.js';
import { createCommunicationService } from '../../lib/work-communications/service.js';
import {createCommunicationDelivery} from '../../lib/work-communications/delivery.js';

async function fixture(t, delivery = async () => ({state:'sent'})) {
  const dir=await mkdtemp(join(tmpdir(),'communications-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const work=createLocalWorkRepository({path:join(dir,'work.json')});
  const accepted=await work.completeRequestWithWork('req_message_test',{service:'print',projectTitle:'A model',contact:{email:'customer@example.test'}},[]);
  const detail=await work.getWork(accepted.workItem.id),operator={id:'op_local_owner',displayName:'Owner',role:'owner'};
  let clock=new Date('2026-10-28T10:00:00Z');
  const repository=createLocalCommunicationRepository({work});
  const env={REQUEST_FROM_EMAIL:'shop@example.test',REQUEST_TO_EMAIL:'reply@example.test'};
  const service=createCommunicationService({repository,delivery,env,now:()=>clock});
  return {work,detail,operator,repository,service,env,advance:ms=>{clock=new Date(clock.getTime()+ms);}};
}
const command=(kind='email',body='Hello\nYour model is ready.')=>({commandId:'command_12345678',kind,body});
test('private comments persist and never dispatch; identical replay returns the same message',async t=>{
  let calls=0;const f=await fixture(t,async()=>{calls++;return {state:'sent'};});
  const first=await f.service.create(f.detail,command('comment'),f.operator);
  const replay=await f.service.create(f.detail,command('comment'),f.operator);
  assert.equal(first.id,replay.id);assert.equal(first.state,'private');assert.equal(calls,0);
  assert.equal((await f.service.list(f.detail)).messages.length,1);
  await assert.rejects(()=>f.service.create(f.detail,command('comment','Changed'),f.operator),e=>e.status===409);
});
test('email recipient is server-owned and sent message cannot dispatch again',async t=>{
  const deliveries=[];const f=await fixture(t,async(message,key)=>{deliveries.push({message,key});return {state:'sent'};});
  const result=await f.service.create(f.detail,command(),f.operator);
  assert.equal(result.state,'sent');assert.equal(result.recipient,'customer@example.test');
  await f.service.retry(f.detail,result.id,f.operator);
  assert.equal(deliveries.length,1);assert.match(deliveries[0].message.subject,/A model/);
  await assert.rejects(()=>f.service.create(f.detail,{...command(),recipient:'attacker@example.test'},f.operator),e=>e.status===400);
});
test('concurrent replay has one dispatch claim and immutable provider payload',async t=>{
  let calls=0,release;const gate=new Promise(resolve=>release=resolve);
  const f=await fixture(t,async()=>{calls++;await gate;return {state:'sent'};});
  const pending=f.service.create(f.detail,command(),f.operator);
  while(!calls)await new Promise(resolve=>setTimeout(resolve,5));
  const replay=await f.service.create(f.detail,command(),f.operator);assert.equal(replay.state,'sending');release();await pending;
  assert.equal(calls,1);
});
test('uncertain delivery is retained, bounded retries reuse identity and expired retries reject',async t=>{
  const keys=[];const f=await fixture(t,async(_,key)=>{keys.push(key);return {state:'uncertain'};});
  const row=await f.service.create(f.detail,command(),f.operator);
  assert.equal(row.state,'uncertain');await f.service.retry(f.detail,row.id,f.operator);
  assert.equal(keys[0],keys[1]);f.advance(23*3600000+1);
  await assert.rejects(()=>f.service.retry(f.detail,row.id,f.operator),e=>e.status===409);
  const wrong={...f.detail,item:{...f.detail.item,id:'work_other_12345678'}};
  await assert.rejects(()=>f.service.retry(wrong,row.id,f.operator),e=>e.status===404);
});
test('invalid body/contact rejected; delivery exceptions are generic and retained',async t=>{
  const f=await fixture(t,async()=>{throw new Error('SECRET provider body');});
  await assert.rejects(()=>f.service.create(f.detail,command('email','  '),f.operator),e=>e.status===400);
  await assert.rejects(()=>f.service.create(f.detail,command('email','x'.repeat(8001)),f.operator),e=>e.status===400);
  await assert.rejects(()=>f.service.create({...f.detail,request:{contact:{}}},command(),f.operator),e=>e.status===400);
  const row=await f.service.create(f.detail,command(),f.operator);assert.equal(row.state,'uncertain');
  assert.doesNotMatch(JSON.stringify(await f.service.list(f.detail)),/SECRET/);
});
test('provider retries freeze sender and reply address and stale claims recover within retention',async t=>{
 const envelopes=[];const f=await fixture(t,async envelope=>{envelopes.push(envelope);return {state:'uncertain'};});
 const row=await f.service.create(f.detail,command(),f.operator);
 f.env.REQUEST_FROM_EMAIL='changed@example.test';f.env.REQUEST_TO_EMAIL='changed-reply@example.test';
 await f.service.retry(f.detail,row.id,f.operator);assert.deepEqual(envelopes[0],envelopes[1]);
 const saved=await f.repository.find(f.detail.item.id,row.id);
 const claim=await f.repository.claim(f.detail.item.id,row.id,{stamp:'2026-10-28T10:00:00Z',claimId:'crashed',envelope:saved.envelope,staleBefore:'2026-10-28T09:59:30Z'});assert.equal(claim.state,'sending');
 await f.service.retry(f.detail,row.id,f.operator);assert.equal(envelopes.length,2);
 f.advance(31000);await f.service.retry(f.detail,row.id,f.operator);assert.equal(envelopes.length,3);
});
test('unconfigured messages can dispatch after configuration, then freeze actual payload',async t=>{
 let configured=false;const deliveries=[];const f=await fixture(t,async envelope=>{deliveries.push(envelope);return {state:configured?'sent':'unconfigured'};});
 f.env.REQUEST_FROM_EMAIL='';f.env.REQUEST_TO_EMAIL='';
 const row=await f.service.create(f.detail,command(),f.operator);assert.equal(row.state,'unconfigured');assert.equal(row.firstAttemptAt,null);
 f.advance(48*3600000);f.env.REQUEST_FROM_EMAIL='enabled@example.test';f.env.REQUEST_TO_EMAIL='shop@example.test';configured=true;
 const sent=await f.service.retry(f.detail,row.id,f.operator);assert.equal(sent.state,'sent');assert.equal(deliveries[1].from,'enabled@example.test');
});
test('removing provider configuration after an uncertain send never resets retry retention',async t=>{
 let configured=true;const f=await fixture(t,async()=>({state:configured?'uncertain':'unconfigured'}));
 const row=await f.service.create(f.detail,command(),f.operator);configured=false;
 await f.service.retry(f.detail,row.id,f.operator);f.advance(24*3600000);
 await assert.rejects(()=>f.service.retry(f.detail,row.id,f.operator),e=>e.status===409);
});
test('email provider contract uses exact POST, headers, frozen payload and bounded sanitized failures',async()=>{
 const env={RESEND_API_KEY:'private-test-key'},envelope={from:'shop@example.test',to:['client@example.test'],reply_to:'reply@example.test',subject:'Project update',text:'Hello',html:'<p>Hello</p>'};
 for(const [status,expected] of [[200,'sent'],[422,'failed'],[500,'uncertain'],[409,'uncertain']]){
  let call;const send=createCommunicationDelivery({env,fetchImpl:async(url,init)=>{call={url,init};return {ok:status===200,status};}});
  assert.deepEqual(await send(envelope,'work-message/example'),{state:expected});assert.equal(call.url,'https://api.resend.com/emails');assert.equal(call.init.method,'POST');assert.equal(call.init.headers.Authorization,'Bearer private-test-key');assert.equal(call.init.headers['Idempotency-Key'],'work-message/example');assert.deepEqual(JSON.parse(call.init.body),envelope);assert.ok(call.init.signal instanceof AbortSignal);
 }
 assert.deepEqual(await createCommunicationDelivery({env:{},fetchImpl:()=>{throw Error('must not dispatch');}})(envelope,'key'),{state:'unconfigured'});
 assert.deepEqual(await createCommunicationDelivery({env,fetchImpl:()=>{throw Error('private error');}})(envelope,'key'),{state:'uncertain'});
});
