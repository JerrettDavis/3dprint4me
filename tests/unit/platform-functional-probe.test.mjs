import test from 'node:test';
import assert from 'node:assert/strict';
import { initialFunctionalState, runFunctionalProbe } from '../../lib/platform/functional-probe.js';
import { hashCapability } from '../../lib/print-estimation/capability.js';
import {sendReceiptTransport} from '../../lib/notifications.js';
const now=1795670000000;
const env={REQUEST_FROM_EMAIL:'sender@example.invalid',REQUEST_TO_EMAIL:'owner@example.invalid',RESEND_API_KEY:'private-key'};
test('verification uses the production fixed Resend contract with private immutable envelope and no redirects',async()=>{
 const envelope={from:env.REQUEST_FROM_EMAIL,to:[env.REQUEST_TO_EMAIL],subject:'Verification',html:'<p>Check</p>',idempotencyKey:'status-receipt/2026-11-26'};
 let calls=0;const response=await sendReceiptTransport(envelope,{env,fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,'https://api.resend.com/emails');assert.equal(options.method,'POST');assert.equal(options.redirect,'manual');
  assert.equal(options.headers.Authorization,'Bearer private-key');assert.equal(options.headers['Idempotency-Key'],envelope.idempotencyKey);
  const body=JSON.parse(options.body);assert.deepEqual(body.to,[env.REQUEST_TO_EMAIL]);assert.ok(!('idempotencyKey' in body));
  return new Response('',{status:503});
 }});assert.equal(response.status,503);assert.equal(calls,1);
});
test('daily owner verification persists an immutable envelope before sending and does not repeat ambiguous attempts',async()=>{
 let state=initialFunctionalState(now);state.nextCheckAt=now+21600000;
 const saved=[];let sends=0;
 const options={now:()=>now,env,checkpoint:async s=>saved.push(structuredClone(s)),mailTransport:async envelope=>{sends++;assert.equal(saved.at(-1).mail.status,'pending');assert.deepEqual(envelope.to,['owner@example.invalid']);throw Error('network private error');}};
 await runFunctionalProbe(state,options);assert.equal(sends,1);assert.equal(state.mail.status,'ambiguous');
 await runFunctionalProbe(state,options);assert.equal(sends,1);
 assert.equal(state.public.emailStage,'ambiguous');assert.ok(!JSON.stringify(state.public).includes('private'));
});
test('no external mail or new probe is sent before cadence and a pending send is never retried blindly',async()=>{
 const state=initialFunctionalState(now);state.nextCheckAt=now+21600000;state.mail={status:'pending',attemptAt:now-1000,nextAt:now+86400000,envelope:{}};
 await runFunctionalProbe(state,{now:()=>now,env,checkpoint:async()=>{},mailTransport:async()=>assert.fail('must not resend'),fetchImpl:async()=>assert.fail('must not probe')});
 assert.equal(state.public.emailStage,'ambiguous');
});
test('a throttled public probe backs off and never renews functional verification',async()=>{
 const state=initialFunctionalState(now);state.mail={status:'accepted',id:'56761188-7520-42d8-8898-ff6fc54ce618',attemptAt:now,nextAt:now+86400000};
 await runFunctionalProbe(state,{now:()=>now,env,checkpoint:async()=>{},fetchImpl:async()=>new Response('',{status:429,headers:{'Retry-After':'1800'}})});
 assert.equal(state.public.failureCode,'throttled');assert.ok(state.nextCheckAt>=now+1800000);
 assert.equal(state.public.filesVerifiedAt,null);assert.equal(state.public.estimatesVerifiedAt,null);
});
test('owned cleanup refuses attached or mismatched sessions and retains cleanup debt',async()=>{
 const state=initialFunctionalState(now);state.nextCheckAt=now+21600000;state.mail={status:'accepted',attemptAt:now,nextAt:now+86400000};
 state.workflow={sessionId:'est_'+'a'.repeat(32),token:'b'.repeat(43),stage:'cleanup',startedAt:now,assetId:'asset_'+'c'.repeat(32)};
 await runFunctionalProbe(state,{now:()=>now,env,checkpoint:async()=>{},repository:{findSession:async()=>({requestId:'customer',ownershipHash:'x'.repeat(64)})},fileStore:{delete:async()=>assert.fail('customer deletion forbidden')}});
 assert.equal(state.public.cleanupPending,true);assert.ok(state.workflow);
});
test('realistic private upload resumes pending slicing and cleans only its owned synthetic session',async()=>{
 const state=initialFunctionalState(now),sessionId='est_'+'a'.repeat(32),assetId='asset_'+'c'.repeat(32),token='b'.repeat(43);
 state.mail={status:'accepted',attemptAt:now,nextAt:now+86400000};
 let uploaded,created=0,polled=0,deleted=0,removed=0;const checkpoints=[];
 const repository={findSession:async()=>({id:sessionId,requestId:null,ownershipHash:hashCapability(token)}),findAsset:async()=>({id:assetId,sessionId,requestId:null,blobPath:'private-status-model'}),listAssetJobs:async()=>[],deleteUnattachedSession:async id=>{assert.equal(id,sessionId);removed++;}};
 const fileStore={read:async()=>uploaded,signDownload:async()=> 'https://store.private.blob.vercel-storage.com/private-status-model?token=secret',delete:async path=>{assert.equal(path,'private-status-model');deleted++;}};
 const response=data=>Response.json(data);
 const fetchImpl=async(url,options)=>{
  if(url==='https://3dprint4.me/api/health')return response({ok:true,databaseProvider:'postgres'});
  if(url==='https://vercel.com/api/blob/?signed=private') {assert.equal(checkpoints.at(-1).workflow.assetId,assetId);uploaded=options.body;return new Response('');}
  if(url.startsWith('https://store.private.blob.vercel-storage.com/'))return new Response('',{status:403});
  if(url.includes('?id=')){polled++;return response({slice:{status:polled===1?'pending':'ready'}});}
  assert.equal(url,'https://3dprint4.me/api/print-estimate');const body=JSON.parse(options.body);
  if(body.action==='create'){created++;return response({sessionId,token});}
  if(body.action==='authorize-upload')return response({assetId,method:'PUT',uploadUrl:'https://vercel.com/api/blob/?signed=private'});
  assert.equal(body.action,'analyze');return response({status:'ready'});
 };
 const options={now:()=>now,env,repository,fileStore,fetchImpl,checkpoint:async s=>checkpoints.push(structuredClone(s))};
 await runFunctionalProbe(state,options);assert.equal(state.workflow.stage,'slicing');assert.equal(state.public.filesOk,true);
 assert.equal(state.public.estimatesVerifiedAt,null);assert.equal(removed,0);
 await runFunctionalProbe(state,{...options,now:()=>now+300000});
 assert.equal(created,1);assert.equal(state.workflow,null);assert.equal(deleted,1);assert.equal(removed,1);
 assert.equal(state.public.estimatesOk,true);assert.equal(state.public.cleanupPending,false);
 assert.ok(!JSON.stringify(state.public).includes(token));assert.ok(!JSON.stringify(state.public).includes('private-status-model'));
});
