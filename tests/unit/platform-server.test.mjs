import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createPlatformServer } from '../../lib/platform/api-server.js';
import { signProxy } from '../../lib/platform/proxy.js';
import { readJson,sendJson } from '../../lib/http.js';
import { createHandoverGate } from '../../lib/platform/handover.js';

async function serve(server,fn) {
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections();await new Promise(r=>server.close(r)); }
}
test('API listener serves fixed handlers and never serves source, static files or SQL',async()=>{
  const secret='s'.repeat(64);
  const server=createPlatformServer({routes:{'/api/inquiry':async(req,res)=>sendJson(res,200,{body:await readJson(req),ip:req.headers['x-forwarded-for']??null})},env:{PLATFORM_PROXY_SECRET:secret},consumeNonce:async()=>true});
  await serve(server,async base=>{
    for(const path of ['/.env','/lib/database.js','/index.html','/sql','/api/unknown'])assert.equal((await fetch(base+path)).status,404);
    const body=Buffer.from('{"a":1}');
    assert.equal((await fetch(base+'/api/inquiry',{method:'POST',headers:{'content-type':'application/json'},body})).status,401);
    const headers=signProxy({method:'POST',url:'/api/inquiry',headers:{'content-type':'application/json'}},body,{secret});
    headers['x-forwarded-for']='192.0.2.1';
    const response=await fetch(base+'/api/inquiry',{method:'POST',headers,body});
    assert.deepEqual(await response.json(),{body:{a:1},ip:null});
  });
});
test('invalid proxy metadata is rejected before handlers and verified metadata is trusted only once',async()=>{
  const secret='s'.repeat(64);const seen=new Set();let calls=0;
  const consumeNonce=async n=>seen.has(n)?false:(seen.add(n),true);
  const server=createPlatformServer({routes:{'/api/request':async(req,res)=>{calls++;sendJson(res,200,{ip:req.headers['x-forwarded-for'],body:await readJson(req)});}},env:{PLATFORM_PROXY_SECRET:secret},consumeNonce});
  await serve(server,async base=>{
    assert.equal((await fetch(base+'/api/request',{method:'POST',headers:{'x-platform-signature':'bad'},body:'{}'})).status,401);assert.equal(calls,0);
    const body=Buffer.from('{"a":1}');const req={method:'POST',url:'/api/request',headers:{'content-type':'application/json'}};
    const headers=signProxy(req,body,{secret,clientIp:'192.0.2.9'});
    assert.deepEqual(await (await fetch(base+req.url,{method:'POST',headers,body})).json(),{ip:'192.0.2.9',body:{a:1}});
    assert.equal((await fetch(base+req.url,{method:'POST',headers,body})).status,401);assert.equal(calls,1);
  });
});
test('production listener refuses development identity or recursive forwarding',()=>{
  for(const env of [{LOCAL_DEV:'1'},{SELF_HOSTED_API_ORIGIN:'https://api.3dprint4.me'}])assert.throws(()=>createPlatformServer({env,routes:{}}));
});

test('readiness requires a private credential and actually checks the database',async()=>{
  let checks=0;
  const server=createPlatformServer({env:{PLATFORM_PROXY_SECRET:'s'.repeat(64)},routes:{},ready:async()=>{checks++;}});
  await serve(server,async base=>{
    assert.equal((await fetch(base+'/internal/ready')).status,401);assert.equal(checks,0);
    assert.equal((await fetch(base+'/internal/ready',{headers:{authorization:'Bearer '+'s'.repeat(64)}})).status,200);assert.equal(checks,1);
  });
});

test('local authenticated handover queues signed traffic before SQL and resumes it against the activated database',async()=>{
  const secret='s'.repeat(64),gate=createHandoverGate();let database='source',calls=0;
  const server=createPlatformServer({env:{PLATFORM_PROXY_SECRET:secret},gate,consumeNonce:async()=>{calls++;return true;},activate:async()=>{database='target';},routes:{'/api/request':async(req,res)=>sendJson(res,200,{database,body:await readJson(req)})}});
  await serve(server,async base=>{
    const control=action=>fetch(base+'/internal/handover/'+action,{method:'POST',headers:{authorization:'Bearer '+secret}});
    assert.equal((await fetch(base+'/internal/handover/pause',{method:'POST'})).status,401);
    assert.equal((await control('pause')).status,200);
    const body=Buffer.from('{}'),headers=signProxy({method:'POST',url:'/api/request',headers:{'content-type':'application/json'}},body,{secret});
    const pending=fetch(base+'/api/request',{method:'POST',headers,body});
    for(let i=0;i<100&&gate.status().queued===0;i++)await new Promise(r=>setImmediate(r));
    assert.equal(gate.status().queued,1);assert.equal(calls,0);
    assert.equal((await control('activate')).status,200);assert.equal((await control('resume')).status,200);
    assert.deepEqual(await (await pending).json(),{database:'target',body:{}});assert.equal(calls,1);
  });
});
