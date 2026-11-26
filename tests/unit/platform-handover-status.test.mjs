import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformServer} from '../../lib/platform/api-server.js';
test('bounded recovery can read but cannot mutate handover state without local authentication',async()=>{
 let calls=0;const server=createPlatformServer({env:{PLATFORM_PROXY_SECRET:'private-test'},gate:{status:()=>({paused:false,active:0,queued:0,switching:false}),pause:()=>calls++}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 try{
  assert.equal((await fetch(origin+'/internal/handover/status')).status,401);
  const response=await fetch(origin+'/internal/handover/status',{headers:{authorization:'Bearer private-test'}});
  assert.equal(response.status,200);assert.equal((await response.json()).paused,false);assert.equal(calls,0);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
