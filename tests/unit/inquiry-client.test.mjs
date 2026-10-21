import test from 'node:test';
import assert from 'node:assert/strict';
import { submitInquiry } from '../../public/assets/evolution/inquiry-client.js';

const input = { inquiry: { intent:'unknown',message:'Desk knob',replyEmail:'a@example.com' },submissionKey:'a'.repeat(64),files:[] };
const response = (body,status=200) => new Response(JSON.stringify(body),{status});
test('inquiry is received only after completion acknowledges persistence',async () => {
  const calls=[];
  const result=await submitInquiry(input,async (url,options) => {
    calls.push([url,options]);
    return response(options.method==='POST'?{id:'INQ-1',mode:'neon',live:false,uploads:[]}:{id:'INQ-1',live:true});
  });
  assert.equal(result.live,true);
  assert.deepEqual(calls.map(call=>call[1].method),['POST','PATCH']);
  assert.equal(JSON.parse(calls[1][1].body).submissionKey,input.submissionKey);
});
test('an upload failure never completes or claims receipt',async () => {
  const calls=[];
  await assert.rejects(submitInquiry({...input,files:[new File(['abc'],'part.txt')]},async (url,options)=>{
    calls.push(options.method);
    return options.method==='POST'?response({id:'INQ-1',mode:'neon',uploads:[{index:0,uploadUrl:'https://vercel.com/api/blob/?token=opaque',method:'PUT',contentType:'text/plain'}]}):response({},502);
  }),/upload/i);
  assert.deepEqual(calls,['POST','PUT']);
});
test('validation failure remains editable; initial network failure permits recovery',async()=>{
  await assert.rejects(submitInquiry(input,async()=>response({error:'unsafe internal detail'},400)),e=>!e.recoverable&&!e.message.includes('internal'));
  await assert.rejects(submitInquiry(input,async()=>{throw new TypeError('offline')}),e=>e.recoverable===true);
});
test('lost completion response requires retry instead of claiming not received',async()=>{
  let call=0;
  await assert.rejects(submitInquiry(input,async()=> ++call===1?response({id:'INQ-1',mode:'neon',uploads:[]}):Promise.reject(new TypeError('offline'))),e=>!e.recoverable&&/confirm|retry/i.test(e.message));
});
test('a failed retry after uncertain completion never claims not received',async()=>{
  await assert.rejects(submitInquiry({...input,receiptUncertain:true},async()=>{throw new TypeError('offline')}),e=>!e.recoverable);
});

test('explicit continuation issues a narrowly scoped fragment handoff', async()=>{
  const client = await import('../../public/assets/evolution/inquiry-client.js');
  assert.equal(typeof client.issueInquiryHandoff, 'function');
  const calls=[];
  const result=await client.issueInquiryHandoff('INQ-1',input.submissionKey,async(url,options)=>{
    calls.push([url,options]);
    return response({url:'/order.html#inquiry='+ 'b'.repeat(64),token:'b'.repeat(64),expiresAt:'2026-10-28'});
  });
  assert.equal(result,'/order.html#inquiry='+ 'b'.repeat(64));
  assert.equal(calls[0][0],'/api/inquiry?kind=handoff');
  assert.equal(calls[0][1].method,'POST');
  assert.deepEqual(JSON.parse(calls[0][1].body),{action:'issue',id:'INQ-1',submissionKey:input.submissionKey});
  await assert.rejects(client.issueInquiryHandoff('INQ-1',input.submissionKey,async()=>response({url:'https://evil.test/#inquiry='+ 'b'.repeat(64),token:'b'.repeat(64)})),/continue/i);
});

test('local continuation projects bounded text without files or capabilities',async()=>{
  const core=await import('../../public/assets/evolution/inquiry-core.js');
  assert.equal(typeof core.inquiryTextPrefill,'function');
  assert.deepEqual(core.inquiryTextPrefill({name:' x ',replyEmail:'a@example.com',message:'m'.repeat(5000),referenceUrl:'https://example.com',intent:'repair',submissionKey:'secret',attachments:[{name:'private.stl'}]}),{name:'x',email:'a@example.com',message:'m'.repeat(4000),referenceUrl:'https://example.com',intent:'repair'});
});

test('handoff accepts the trusted absolute storefront URL and navigates relatively',async()=>{
  const {issueInquiryHandoff}=await import('../../public/assets/evolution/inquiry-client.js');
  assert.equal(await issueInquiryHandoff('INQ-1',input.submissionKey,async()=>response({url:'https://3dprint4.me/order.html#inquiry='+ 'b'.repeat(64),token:'b'.repeat(64)})),'/order.html#inquiry='+ 'b'.repeat(64));
});
