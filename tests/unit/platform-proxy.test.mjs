import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createProxy, signProxy, verifyProxy } from '../../lib/platform/proxy.js';

const secret = 'a'.repeat(64);
function request(body = { title: 'private $ payload' }) {
  return { method: 'POST', url: '/api/request?mode=complete', body,
    headers: { origin: 'https://3dprint4.me', 'content-type': 'application/json',
      'x-forwarded-for': '192.0.2.5, 10.0.0.1', 'x-print-estimate-token': 'capability', cookie: 'ignored',
      'x-platform-signature': 'untrusted' } };
}
function response() { return { headers: {}, setHeader(k,v) { this.headers[k.toLowerCase()] = v; }, end(v) { this.body = v; } }; }
test('forwarder signs exact serialized bytes and forwards only the API contract', async () => {
  const req = request(), res = response(); let calls = 0;
  const proxy = createProxy({ env: { SELF_HOSTED_API_ORIGIN: 'https://api.3dprint4.me', PLATFORM_PROXY_SECRET: secret },
    fetchImpl: async (url, options) => {
      calls++; assert.equal(url, 'https://api.3dprint4.me/api/request?mode=complete');
      assert.equal(options.redirect, 'manual'); assert.equal(options.method, 'POST');
      assert.equal(options.body.toString(), JSON.stringify(req.body));
      assert.equal(options.headers.cookie, undefined);
      assert.equal(options.headers['x-print-estimate-token'], 'capability');
      const forwarded = { method: options.method, url: req.url, headers: options.headers };
      assert.equal(await verifyProxy(forwarded, options.body, { secret, consumeNonce: async () => true }), true);
      return new Response('{"ok":true}', { status: 201, headers: { 'content-type': 'application/json', 'retry-after': '4', 'set-cookie': 'forbidden' } });
    } });
  assert.equal(await proxy(req,res), true); assert.equal(calls,1); assert.equal(res.statusCode,201);
  assert.equal(res.headers['retry-after'],'4'); assert.equal(res.headers['set-cookie'],undefined);
});
test('signature binds path, method, body, origin and client IP and consumes a bounded nonce', async () => {
  const req=request(); req.body=undefined; const body=Buffer.from('{}');
  req.headers=signProxy(req,body,{secret,now:100000,nonce:'n'.repeat(32),clientIp:'192.0.2.5'});
  const seen=new Set();const consumeNonce=async n=>seen.has(n)?false:(seen.add(n),true);
  assert.equal(await verifyProxy(req,body,{secret,now:100000,consumeNonce}),true);
  assert.equal(await verifyProxy(req,body,{secret,now:100000,consumeNonce}),false);
  for(const changed of [{...req,url:'/api/checkout'}, {...req,method:'GET'}, {...req,headers:{...req.headers,origin:'https://evil.example'}}, {...req,headers:{...req.headers,'x-platform-client-ip':'192.0.2.6'}}])
    assert.equal(await verifyProxy(changed,body,{secret,now:100000,consumeNonce:async()=>true}),false);
  assert.equal(await verifyProxy(req,Buffer.from('{"x":1}'),{secret,now:100000,consumeNonce:async()=>true}),false);
  assert.equal(await verifyProxy(req,body,{secret,now:200000,consumeNonce:async()=>true}),false);
});
test('disabled forwarding stays local; unsafe config, redirects and network failures fail closed without retry', async () => {
  assert.equal(await createProxy({env:{}})(request(),response()),false);
  for (const origin of ['http://api.3dprint4.me','https://evil.example','https://api.3dprint4.me/path']) {
    const res=response();let calls=0;
    await createProxy({env:{SELF_HOSTED_API_ORIGIN:origin,PLATFORM_PROXY_SECRET:secret},fetchImpl:async()=>{calls++;}})(request(),res);
    assert.equal(res.statusCode,503);assert.equal(calls,0);
  }
  for(const result of ['error','redirect']) {
    let calls=0;const res=response();
    await createProxy({env:{SELF_HOSTED_API_ORIGIN:'https://api.3dprint4.me',PLATFORM_PROXY_SECRET:secret},fetchImpl:async()=>{calls++;if(result==='error')throw new Error(secret);return new Response(null,{status:302,headers:{location:'https://evil.example'}});}})(request(),res);
    assert.equal(calls,1);assert.equal(res.statusCode,503);assert.ok(!res.body.includes(secret));
  }
});
test('request and response streams have byte bounds', async () => {
  const env={SELF_HOSTED_API_ORIGIN:'https://api.3dprint4.me',PLATFORM_PROXY_SECRET:secret};
  const req=Readable.from([Buffer.alloc(1024*1024+1)]);Object.assign(req,{method:'POST',url:'/api/request',headers:{}});
  let calls=0;const res=response();await createProxy({env,fetchImpl:async()=>{calls++;}})(req,res);
  assert.equal(calls,0);assert.equal(res.statusCode,413);
  const large=response();await createProxy({env,fetchImpl:async()=>new Response(Buffer.alloc(2*1024*1024+1))})(request(),large);
  assert.equal(large.statusCode,503);
});
