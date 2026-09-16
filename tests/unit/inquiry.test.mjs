import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInquiry, submissionHash } from '../../lib/inquiry-validation.js';
import { createInquiryHandler } from '../../api/inquiry.js';
import { sendInquiryEmail } from '../../lib/inquiry-notifications.js';
import { submitInquiry } from '../../public/assets/evolution/inquiry-client.js';
import { createServer } from 'node:http';
import { HttpError } from '../../lib/http.js';
const key = 'a'.repeat(64);
const body = () => ({ submissionKey: key, inquiry: { replyEmail: 'person@example.com', message: 'A replacement part', intent: 'not-sure' }, files: [] });
async function call(handler, method, value) {
  const res = { setHeader() {}, end(text) { this.body = JSON.parse(text); } };
  await handler({ method, headers: {'content-type':'application/json'}, body: value }, res);
  return res;
}
test('inquiry requires email plus message, URL or bounded file; neutral intent preserved', () => {
  assert.equal(normalizeInquiry(body()).inquiry.intent, 'unknown');
  for (const value of [{...body(), inquiry:{replyEmail:'bad',message:'x'}}, {...body(), inquiry:{replyEmail:'a@b.co'}}, {...body(),files:[{name:'a.exe',size:1}]}, {...body(),submissionKey:'short'}, {...body(),inquiry:{replyEmail:'a@b.co',referenceUrl:'javascript:alert(1)'}}]) assert.throws(()=>normalizeInquiry(value));
  assert.equal(submissionHash(key).length,64);
});
test('API local mode does not claim receipt and oversized parsed payload is rejected', async () => {
  const handler=createInquiryHandler({configured:()=>false});
  assert.equal((await call(handler,'POST',body())).body.live,false);
  assert.equal((await call(handler,'POST',{...body(),padding:'x'.repeat(40000)})).statusCode,413);
});
test('draft replay, key ownership, failed verification, and completion replay', async () => {
  let row, completed=0, failHead=true;
  const store={rate:async()=>{},find:async hash=>row?.key_hash===hash?row:null,
    create:async r=>(row??=r),complete:async r=>{completed++; row={...r,status:'submitted'}; return row;}, notify:async()=>{}};
  const handler=createInquiryHandler({configured:()=>true,blobConfigured:()=>true,store,sign:async()=>({uploadUrl:'https://vercel.com/api/blob/?signed'}),head:async path=>{if(failHead) throw Error('secret'); return {pathname:path,size:12};}});
  const value={...body(),files:[{name:'a.stl',size:12,type:''}]};
  const first=await call(handler,'POST',value);
  assert.equal(first.body.live,false);
  assert.equal((await call(handler,'POST',value)).body.id,first.body.id);
  assert.equal((await call(handler,'PATCH',{id:first.body.id,submissionKey:'b'.repeat(64)})).statusCode,404);
  assert.equal((await call(handler,'PATCH',{id:first.body.id,submissionKey:key})).statusCode,409);
  assert.equal(completed,0); failHead=false;
  assert.equal((await call(handler,'PATCH',{id:first.body.id,submissionKey:key})).body.live,true);
  assert.equal((await call(handler,'PATCH',{id:first.body.id,submissionKey:key})).body.live,true);
  assert.equal(completed,1);
  assert.equal((await call(handler,'POST',{...value,inquiry:{...value.inquiry,message:'changed'}})).statusCode,409);
});
test('file count, aggregate size, unsafe names and long fields are rejected',()=>{
  const file={name:'part.stl',size:10*1024*1024};
  for(const patch of [{files:Array(7).fill({...file,size:1})},{files:Array(3).fill(file)},{files:[{...file,name:'../part.stl'}]},{files:[{...file,size:0}]},{files:[{...file,size:10*1024*1024+1}]},{inquiry:{...body().inquiry,message:'x'.repeat(6001)}},{inquiry:{...body().inquiry,referenceUrl:'https://user:secret@example.com'}}]) assert.throws(()=>normalizeInquiry({...body(),...patch}));
  assert.equal(normalizeInquiry({...body(),inquiry:{replyEmail:'a@b.co'},files:[{name:'photo.jpg',size:100,type:'text/html'}]}).files[0].type,'image/jpeg');
});
test('provider failures are safe JSON; honeypot and wrong methods never write',async()=>{
  let writes=0;
  const handler=createInquiryHandler({configured:()=>true,store:{rate:async()=>{writes++;throw Error('secret credential');}}});
  const failed=await call(handler,'POST',body());
  assert.equal(failed.statusCode,502); assert.doesNotMatch(JSON.stringify(failed.body),/secret|credential/);
  assert.equal((await call(handler,'GET',body())).statusCode,405);
  assert.equal((await call(handler,'POST',{...body(),website:'spam'})).body.live,false);
  assert.equal(writes,1);
});
test('notifications use fixed endpoint, POST, exact persisted payload and stable provider key',async()=>{
  const payload={from:'owner@example.com',to:['owner@example.com'],text:'Inquiry'};
  let request;
  const transport=async(...args)=>{request=args;return {ok:true};};
  await sendInquiryEmail('INQ-test',payload,transport);
  assert.equal(request[0],'https://api.resend.com/emails');
  assert.equal(request[1].method,'POST');
  assert.equal(request[1].headers['Content-Type'],'application/json');
  assert.equal(request[1].headers['Idempotency-Key'],'quick-inquiry/INQ-test/owner');
  assert.match(request[1].headers.Authorization,/^Bearer /);
  assert.equal(request[1].body,JSON.stringify(payload));
  await assert.rejects(sendInquiryEmail('INQ-test',payload,async()=>({ok:false,status:401})),/unavailable/);
});
test('actual browser transport interoperates with structured context and neutral intent',async()=>{
  let row;
  const handler=createInquiryHandler({configured:()=>true,store:{rate:async()=>{},find:async()=>row,create:async value=>(row=value),complete:async value=>(row={...value,status:'submitted'}),notify:async()=>{throw Error('delivery failed');}}});
  const input={...body(),inquiry:{...body().inquiry,intent:'unknown',context:{entryPoint:'project-detail',exampleSlug:'ioniq-console-organizer'}}};
  const result=await submitInquiry(input,async(url,options)=>{
    assert.equal(url,'/api/inquiry');
    const result=await call(handler,options.method,JSON.parse(options.body));
    return {ok:result.statusCode<400,status:result.statusCode,json:async()=>result.body};
  });
  assert.equal(result.live,true);
  assert.equal(row.inquiry.intent,'unknown');
  assert.deepEqual(row.inquiry.context,input.inquiry.context);
  assert.equal((await call(handler,'POST',input)).body.live,true);
});
test('context and intent are bounded allowlists; malicious extra context is not retained',()=>{
  const normalized=normalizeInquiry({...body(),inquiry:{...body().inquiry,intent:'consulting',context:{entryPoint:'arbitrary',exampleSlug:'secret',injected:'text'}}});
  assert.equal(normalized.inquiry.intent,'unknown');
  assert.deepEqual(normalized.inquiry.context,{entryPoint:'unknown',exampleSlug:null});
});
test('real HTTP JSON parsing, bounded input and no-integration fallback',async()=>{
  const server=createServer(createInquiryHandler({configured:()=>false}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const url=`http://127.0.0.1:${server.address().port}/api/inquiry`;
    const post=data=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:data});
    const local=await post(JSON.stringify(body()));
    assert.equal(local.status,200); assert.equal((await local.json()).live,false);
    assert.equal((await post('{bad')).status,400);
    assert.equal((await post(JSON.stringify({...body(),padding:'x'.repeat(40000)}))).status,413);
    assert.equal((await fetch(url,{method:'POST',body:'text'})).status,415);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
test('durable rate rejection and notification failure cannot falsely change acceptance',async()=>{
  const handler=createInquiryHandler({configured:()=>true,store:{rate:async()=>{throw new HttpError(429,'Too many attempts.');}}});
  assert.equal((await call(handler,'POST',body())).statusCode,429);
});
