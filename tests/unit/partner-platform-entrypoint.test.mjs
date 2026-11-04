import test from 'node:test';
import assert from 'node:assert/strict';
import {startPlatformApi} from '../../scripts/platform-server.mjs';
test('real API entrypoint wires live and QA routes with QA disabled or enabled and closes both stores',async()=>{
 for(const enabled of [false,true]){
 let options,closed=0,listened=false;const database={query:async()=>[]};
 const result=await startPlatformApi({env:{PORT:'8080'},loadRoute:async()=>()=>{},control:{getSelection:async()=>null,consumeNonce:async()=>true,close:async()=>closed++},activate:{bootstrap:async()=>{}},getBusinessDatabase:()=>database,loadQa:async({getSelectedDatabase,getSelection})=>{assert.equal(getSelectedDatabase(),database);assert.equal(await getSelection(),null);return {getRuntime:()=>{if(!enabled)throw Error('unavailable');return {realm:'qa'};},close:async()=>closed++};},serverFactory:value=>{options=value;return {listen:(_port,_host,callback)=>{listened=true;callback();},close:callback=>callback(),closeAllConnections:()=>{}};},closeBusiness:async()=>closed++,installSignalHandlers:false});
 assert.equal(listened,true);for(const path of ['/api/partner/v1/status','/api/partner-qa/v1/status','/api/operator-partners','/api/operator-partner-qa'])assert.equal(typeof options.routes[path],'function');
 assert.ok(options.directPaths.includes('/api/partner-qa/v1/session'));await result.close();assert.equal(closed,3);
 }
});
