import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createPlatformServer } from '../../lib/platform/api-server.js';
import { signProxy } from '../../lib/platform/proxy.js';
import { readJson,sendJson } from '../../lib/http.js';

async function serve(server,fn) {
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections();await new Promise(r=>server.close(r)); }
}
test('API listener serves fixed handlers and never serves source, static files or SQL',async()=>{
  const server=createPlatformServer({routes:{'/api/inquiry':async(req,res)=>sendJson(res,200,{body:await readJson(req),ip:req.headers['x-forwarded-for']??null})},env:{}});
  await serve(server,async base=>{
    for(const path of ['/.env','/lib/database.js','/index.html','/sql','/api/unknown'])assert.equal((await fetch(base+path)).status,404);
    const response=await fetch(base+'/api/inquiry',{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':'192.0.2.1'},body:'{"a":1}'});
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
