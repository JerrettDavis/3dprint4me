import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicInquiryWorkflowHandler } from '../../lib/inquiry-workflow/public-api.js';
import { createOperatorInquiryWorkflowHandler } from '../../lib/inquiry-workflow/operator-api.js';
import { HttpError } from '../../lib/http.js';

function response(){return {headers:{'content-type':'application/json'},setHeader(key,value){this.headers[key.toLowerCase()]=value;},end(value){this.body=value?JSON.parse(value):null;this.writableEnded=true;}};}
const raw='a'.repeat(64),workId='work_example123',origin='https://work.3dprint4.me';

test('public handoff actions accept bounded POST JSON only and never authorize by inquiry ID alone',async()=>{
  const calls=[];
  const service={issueForCustomer:async input=>{calls.push(['issue',input]);return {token:raw};},
    read:async input=>{calls.push(['read',input]);return {inquiry:{message:'Owned text'}};},
    download:async input=>{calls.push(['download',input]);return {url:'https://private.example'};}};
  const handler=createPublicInquiryWorkflowHandler({getRuntime:()=>({configured:true,service,rate:async()=>{}})});
  for(const [body,expected] of [
    [{action:'issue',id:'INQ-example123',submissionKey:raw},200],
    [{action:'read',token:raw},200],[{action:'file',token:raw,index:0},200],
    [{action:'read',id:'INQ-example123'},400],
    [{action:'issue',id:'INQ-example123',submissionKey:raw,operator:{role:'owner'}},400],
    [{action:'read',token:raw,redirect:'https://evil.example'},400]
    ,[{action:'__proto__',token:raw},400]
  ]){
    const res=response();await handler({method:'POST',url:'/api/inquiry?kind=handoff',headers:{'content-type':'application/json'},body},res);
    assert.equal(res.statusCode,expected);assert.equal(res.headers['cache-control'],'no-store');
  }
  assert.deepEqual(calls.map(x=>x[0]),['issue','read','download']);
  const get=response();await handler({method:'GET',url:'/api/inquiry?kind=handoff',headers:{'content-type':'application/json'}},get);
  assert.equal(get.statusCode,405);
  const large=response();await handler({method:'POST',headers:{'content-type':'application/json'},body:{action:'read',token:raw,extra:'x'.repeat(33000)}},large);
  assert.equal(large.statusCode,413);
});

test('handoff failures are safe and unsupported databases do not attempt lookup or delivery',async()=>{
  for(const error of [new Error('postgres://private-password'),new HttpError(410,'Invitation expired.')]) {
    const handler=createPublicInquiryWorkflowHandler({getRuntime:()=>({configured:true,rate:async()=>{},service:{read:async()=>{throw error;}}})});
    const res=response();await handler({method:'POST',headers:{'content-type':'application/json'},body:{action:'read',token:raw}},res);
    assert.equal(res.statusCode,error instanceof HttpError?410:503);assert.doesNotMatch(JSON.stringify(res.body),/password|postgres:/);
  }
  const handler=createPublicInquiryWorkflowHandler({getRuntime:()=>({configured:false,rate:()=>assert.fail('must not query unsupported provider')})});
  const res=response();await handler({method:'POST',headers:{'content-type':'application/json'},body:{action:'read',token:raw}},res);assert.equal(res.statusCode,503);
});

test('operator inquiry actions require the existing session/origin and keep sharing manual',async()=>{
  const calls=[],operator={id:'op_owner123',role:'owner',enabled:true};
  const handler=createOperatorInquiryWorkflowHandler({authorize:async()=>operator,allowedOrigins:[origin],
    getRuntime:()=>({configured:true,service:{
      issueForOperator:async input=>{calls.push(input);return {url:'https://3dprint4.me/order/#inquiry='+raw};},
      prepareProject:async input=>{calls.push(input);return {workId,requestId:'3DP-20261021-EXAMPLE123'};}
    }})});
  for(const [method,headers,body,expected] of [
    ['POST',{origin},{action:'invite',workId},200],
    ['POST',{origin,'idempotency-key':'test-key-00000000'},{action:'prepare',command:{workId,revision:1,title:'A project',service:'design'}},200],
    ['POST',{origin:'https://evil.example'},{action:'invite',workId},403],
    ['GET',{origin},null,405],
    ['POST',{origin},{action:'send',workId},400],
    ['POST',{origin},{action:'invite',workId,recipient:'customer@example.com'},400]
  ]){
    const res=response();await handler({method,headers:{'content-type':'application/json',...headers},url:'/api/operator-work?resource=inquiries',body},res);assert.equal(res.statusCode,expected);
  }
  assert.equal(calls.length,2);assert.equal(calls[0].operator,operator);
  assert.equal(calls[1].idempotencyKey,'test-key-00000000');
});
