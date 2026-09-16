import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { requireDisabledRemoteDelivery } from '../../scripts/lib/verification-safety.mjs';

test('remote verification guard requires explicit disabled delivery and fails closed',async()=>{
  for(const health of [{integrations:{email:true,webhook:false}},{integrations:{email:false,webhook:true}},{integrations:{email:false}},{integrations:{email:'false',webhook:false}},null]) {
    await assert.rejects(requireDisabledRemoteDelivery('http://127.0.0.1',async()=>({ok:true,json:async()=>health})),/disabled/);
  }
  await assert.rejects(requireDisabledRemoteDelivery('http://127.0.0.1',async()=>({ok:false,status:503})),/disabled/);
  await assert.rejects(requireDisabledRemoteDelivery('http://127.0.0.1',async()=>{throw Error('private network error');}),/disabled/);
  await assert.rejects(requireDisabledRemoteDelivery('http://127.0.0.1',async()=>({ok:true,json:async()=>{throw Error('bad JSON');}})),/disabled/);
  await requireDisabledRemoteDelivery('http://127.0.0.1',async(url,options)=>{
    assert.equal(String(url),'http://127.0.0.1/api/health');
    assert.equal(options.method,'GET'); assert.equal(options.redirect,'error');
    return {ok:true,json:async()=>({integrations:{email:false,webhook:false}})};
  });
});

test('both real verification CLIs refuse remote delivery before any write despite blank local delivery env',async()=>{
  const requests=[];
  let health;
  const server=createServer((req,res)=>{requests.push({method:req.method,url:req.url});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(health));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    for(const script of ['verify-live-inquiry.mjs','verify-live-intake.mjs']) {
      for(const integrations of [{email:true,webhook:false},{email:false,webhook:true},{email:false}]) {
        health={integrations}; requests.length=0;
        const path=fileURLToPath(new URL(`../../scripts/${script}`,import.meta.url));
        await assert.rejects(promisify(execFile)(process.execPath,[path,`http://127.0.0.1:${server.address().port}`],{
          timeout:10000,env:{...process.env,DATABASE_URL:'postgresql://fake:fake@localhost/fake',RESEND_API_KEY:'',REQUEST_FROM_EMAIL:'',REQUEST_TO_EMAIL:'',REQUEST_WEBHOOK_URL:''}
        }),error=>{assert.match(error.stderr,/disabled/);return true;});
        assert.deepEqual(requests,[{method:'GET',url:'/api/health'}]);
      }
    }
  } finally {await new Promise(resolve=>server.close(resolve));}
});
