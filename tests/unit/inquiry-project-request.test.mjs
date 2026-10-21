import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectRequestUseCase } from '../../lib/project-request/create-project-request.js';
import { completeProjectRequestUseCase } from '../../lib/project-request/complete-project-request.js';
import { authorizeProjectUploadUseCase } from '../../lib/project-request/authorize-project-upload.js';
import { HttpError } from '../../lib/http.js';

const id='3DP-20261021-00000000000000000001',token='a'.repeat(64);
const request={service:'design',projectTitle:'Project',description:'A fitted part',contact:{name:'Customer',email:'test@example.com'},consent:true};

test('inquiry-bound create delegates to the canonical draft and never creates an unrelated request',async()=>{
  const create=createProjectRequestUseCase({normalizeRequest:()=>assert.fail('handoff service owns inherited-file validation'),newRequestId:()=>id,
    getRuntime:()=>({mode:'neon',requestRepository:{createDraft:()=>assert.fail('must reuse canonical inquiry draft')},
      inquiryWorkflow:{configured:true,service:{createDraft:async input=>{assert.equal(input.token,token);assert.equal(input.request,request);return {id};}}}})});
  assert.deepEqual(await create({handoffToken:token,request}),{id,mode:'neon',live:true});
});

test('omitting the inquiry capability cannot bypass scope on ordinary completion or upload routes',async()=>{
  const scope=async input=>{assert.equal(input.id,id);assert.equal(input.token,undefined);throw new HttpError(403,'Private invitation required.');};
  const runtime={mode:'neon',inquiryWorkflow:{configured:true,service:{assertRequestScope:scope}},
    workPublisher:{completeRequest:()=>assert.fail('scope must be checked first')},
    requestRepository:{acceptsUploads:()=>assert.fail('scope must be checked before signing')},
    privateFileStore:{authorizeUpload:()=>assert.fail('must not sign')}};
  const complete=completeProjectRequestUseCase({normalizeRequest:v=>v,normalizeFiles:()=>[],validateId:v=>v,getRuntime:()=>runtime,issueCheckoutProof:()=>null});
  await assert.rejects(complete({id,request}),{status:403});
  const upload=authorizeProjectUploadUseCase({validateId:v=>v,sanitizeName:v=>v,randomHex:()=> 'fixed',getRuntime:()=>runtime});
  await assert.rejects(upload({requestId:id,filename:'part.stl',size:12}),{status:403});
});

test('handoff completion sends normalized context once and never includes the private capability',async()=>{
  const observed=[],files=[];let replayed=false,proofs=0;
  const runtime={mode:'neon',workPublisher:{completeRequest:()=>assert.fail('must retain inquiry work identity')},
    inquiryWorkflow:{configured:true,service:{completeDraft:async input=>{
      assert.equal(input.token,token);return replayed?{id,workId:'work_example123',replayed:true}:
        {id,workId:'work_example123',replayed:false,request,files,outboxId:'1'};
    }}},
    recorder:{record:async value=>observed.push(value)},emailNotifier:{notify:async(...value)=>{observed.push(value);return {owner:true};}},
    webhookNotifier:{notify:async(...value)=>{observed.push(value);return {delivered:true};}},pushTrigger:{trigger:async value=>observed.push(value)}};
  const complete=completeProjectRequestUseCase({normalizeRequest:()=>assert.fail('service returns validated payload'),normalizeFiles:()=>[],validateId:v=>v,
    getRuntime:()=>runtime,issueCheckoutProof:()=>{proofs++;return 'test-proof';}});
  const first=await complete({id,request,handoffToken:token});assert.equal(first.live,true);assert.equal(first.checkoutToken,'test-proof');
  assert.ok(!JSON.stringify(observed).includes(token));const count=observed.length;
  replayed=true;
  const again=await complete({id,handoffToken:token});assert.equal(again.live,true);assert.equal(again.replayed,true);
  assert.equal(again.checkoutToken,null);assert.equal(observed.length,count);assert.equal(proofs,1);
});
