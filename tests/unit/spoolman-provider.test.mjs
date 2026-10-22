import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpoolmanProvider } from '../../lib/spoolman/adapters/http-spoolman.js';
import { createServer } from 'node:http';

const response = (value, headers = {}) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', ...headers } });
test('complete archived-inclusive snapshot uses GET, explicit Host, total count and decoded currency', async () => {
  const calls = [];
  const provider = createSpoolmanProvider({ baseUrl: 'http://spoolman:8000', hostHeader: 'spoolman.example.test', fetchImpl: async (url, init) => {
    calls.push({ url: String(url), init });
    return String(url).includes('/setting/') ? response({ value: '"USD"' }) : response([{ id: 1 }], { 'x-total-count': '1' });
  } });
  assert.deepEqual(await provider.snapshot(), { currency: 'USD', spools: [{ id: 1 }] });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'http://spoolman:8000/api/v1/spool?allow_archived=true');
  for (const { init } of calls) {
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Host, 'spoolman.example.test'); assert.equal(init.headers.Accept, 'application/json');
    assert.ok(init.signal);
  }
});
test('provider is unconfigured without a URL and rejects unsafe configuration', async () => {
  assert.equal(createSpoolmanProvider({}).configured, false);
  for (const baseUrl of ['file:///secret', 'http://user:password@host', 'http://host/api?key=secret']) assert.throws(() => createSpoolmanProvider({ baseUrl }));
});
test('partial, malformed, oversized and failed responses yield safe errors', async () => {
  for (const bad of [response([], { 'x-total-count': '2' }), response([]), response({ items: [] }), new Response('private upstream error', { status: 500 }), response(new Array(5001).fill({ id: 1 }), { 'x-total-count': '5001' }), new Response('x', { headers: { 'content-type': 'text/html' } })]) {
    const provider = createSpoolmanProvider({ baseUrl: 'http://spoolman:8000', fetchImpl: async url => String(url).includes('/setting/') ? response({ value: '"USD"' }) : bad });
    await assert.rejects(provider.snapshot(), e => e.code === 'spoolman_unavailable' && !e.message.includes('private'));
  }
});
test('network errors and caller cancellation never expose URLs or provider bodies', async () => {
  const provider = createSpoolmanProvider({ baseUrl: 'http://spoolman:8000', fetchImpl: async () => { throw new Error('secret'); } });
  await assert.rejects(provider.snapshot(), e => e.code === 'spoolman_unavailable' && !e.message.includes('secret'));
});

test('real HTTP redirects, overflowing response bytes, timeout and caller abort are rejected', async () => {
  let mode='redirect',requests=[];
  const server=createServer((req,res)=>{
    requests.push(req.url);
    if(mode==='timeout'){res.writeHead(200,{'content-type':'application/json'});res.write('{');return;}
    if(req.url.includes('/setting/')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({value:'"USD"'}));return;}
    if(mode==='redirect'){res.writeHead(302,{location:'/private'});res.end();return;}
    res.writeHead(200,{'content-type':'application/json','x-total-count':'0'});res.end('"'+'x'.repeat(16*1024*1024)+'"');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const baseUrl=`http://127.0.0.1:${server.address().port}`;
  const watchdog=setTimeout(()=>server.closeAllConnections(),2500);
  try {
    await assert.rejects(createSpoolmanProvider({baseUrl}).snapshot(),{code:'spoolman_unavailable'});
    assert.equal(requests.includes('/private'),false);
    mode='bytes';await assert.rejects(createSpoolmanProvider({baseUrl}).snapshot(),{code:'spoolman_unavailable'});
    mode='timeout';const started=Date.now();
    await assert.rejects(createSpoolmanProvider({baseUrl,timeoutMs:25}).snapshot(),{code:'spoolman_unavailable'});
    assert.ok(Date.now()-started<2000);
    await assert.rejects(createSpoolmanProvider({baseUrl}).snapshot({signal:AbortSignal.timeout(25)}),{code:'spoolman_unavailable'});
  } finally { clearTimeout(watchdog);server.closeAllConnections();await new Promise(resolve=>server.close(resolve)); }
});
