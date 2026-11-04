import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createHmac,randomUUID} from 'node:crypto';
import {createPartnerHandlers,createOwnerAuthorizer} from '../../lib/partner-outreach/http.js';
import {createPlatformServer} from '../../lib/platform/api-server.js';
import {partnerCookie,createPartnerAuth} from '../../lib/partner-outreach/auth.js';
import {partnerFixture,TEST_NOW} from '../support/partner-fixture.mjs';
const env={PARTNER_WEB_ORIGIN:'https://partners.3dprint4.me',OPERATOR_WEB_ORIGIN:'https://work.3dprint4.me',OPERATOR_OWNER_SUBJECT:'2610199'};
test('QA routes use independent cookie and CSRF realms and reject runtime selectors',async()=>{
 const f=await partnerFixture({reviewed:false});let server;
 try{
 const auth=createPartnerAuth({database:f.database,realm:'qa',now:()=>new Date(TEST_NOW)});
 const token='q'.repeat(43),csrf=createHmac('sha256',token).update('3dprint4me-partner-qa-csrf-v1').digest('base64url');
 await f.database.query`UPDATE partner_sessions SET token_hash=${(await import('../../lib/partner-outreach/postgres-repository.js')).digest(token)},csrf_hash=${(await import('../../lib/partner-outreach/postgres-repository.js')).digest(csrf)} WHERE id=${f.sessionId}`;
 const handlers=createPartnerHandlers({realm:'qa',getRuntime:()=>({realm:'qa',database:f.database,auth,app:{read:async()=>({items:[]})}}),env});
 assert.ok(handlers.routes['/api/operator-partner-qa']);assert.ok(!handlers.routes['/api/operator-partners']);
 server=createPlatformServer({...handlers,env:{}});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port+'/api/partner-qa/v1/';
 let r=await fetch(base+'session',{headers:{Origin:env.PARTNER_WEB_ORIGIN,Cookie:'__Host-3dp-partner='+token}});assert.equal(r.status,401);
 r=await fetch(base+'session',{headers:{Origin:env.PARTNER_WEB_ORIGIN,Cookie:'__Host-3dp-partner-qa='+token}});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/^__Host-3dp-partner-qa=/);assert.equal((await r.json()).csrfToken,csrf);
 r=await fetch(base+'status?realm=live');assert.equal(r.status,400);
 r=await fetch(base+'status',{headers:{Origin:'https://evil.invalid'}});assert.equal(r.status,403);
 assert.match(partnerCookie(token,{realm:'qa'}),/^__Host-3dp-partner-qa=/);
 const req={headers:{cookie:'__Host-3dp-session='+token}},query=async()=>[{operator_id:'owner'}];
 const live=await createOwnerAuthorizer({query,env})(req),qa=await createOwnerAuthorizer({query,env,realm:'qa'})(req);assert.notEqual(live.csrfToken,qa.csrfToken);
 }finally{if(server)await new Promise(r=>server.close(r));await f.close();}
});
