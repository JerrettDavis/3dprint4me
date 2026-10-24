import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID,createHmac } from 'node:crypto';
import { createPlatformServer } from '../../lib/platform/api-server.js';
import { createPartnerHandlers,createOwnerAuthorizer } from '../../lib/partner-outreach/http.js';
import { createPartnerAuth } from '../../lib/partner-outreach/auth.js';
import { createPartnerApplication } from '../../lib/partner-outreach/application.js';
import { digest } from '../../lib/partner-outreach/postgres-repository.js';
import { partnerFixture,ACTIVE_ENV,TEST_NOW } from '../support/partner-fixture.mjs';
const origin='https://partners.3dprint4.me',ownerOrigin='https://work.3dprint4.me';

test('native routes enforce independent cookies, exact origins, CSRF, shape, role and sanitized failures',async()=>{
 const f=await partnerFixture();let server;
 try{
  const token='p'.repeat(43);
  const csrf=createHmac('sha256',token).update('3dprint4me-partner-csrf-v1').digest('base64url');
  await f.database.query`UPDATE partner_sessions SET token_hash=${digest(token)},csrf_hash=${digest(csrf)} WHERE id=${f.sessionId}`;
  const env={...ACTIVE_ENV,PARTNER_WEB_ORIGIN:origin,OPERATOR_WEB_ORIGIN:ownerOrigin,OPERATOR_OWNER_SUBJECT:'2610199'};
  const auth=createPartnerAuth({database:f.database,now:()=>new Date(TEST_NOW)}),app=createPartnerApplication({database:f.database,env,now:()=>new Date(TEST_NOW)});
  const runtime={database:f.database,auth,app};
  const {routes,directPaths}=createPartnerHandlers({getRuntime:()=>runtime,env});
  server=createPlatformServer({routes:{...routes,'/api/request':(req,res)=>{res.end('forbidden');}},directPaths,env:{}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  const cookie='__Host-3dp-partner='+token;
  let response=await fetch(base+'/api/partner/v1/session');assert.equal(response.status,401);
  response=await fetch(base+'/api/partner/v1/session',{headers:{Origin:origin,Cookie:cookie}});
  assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),origin);assert.equal(response.headers.get('cache-control'),'no-store');
  const session=await response.json();assert.equal(session.partner.id,f.partnerId);assert.ok(session.csrfToken);assert.ok(!JSON.stringify(session).includes('csrfHash'));
  response=await fetch(base+'/api/partner/v1/gigs',{headers:{Origin:'https://evil.3dprint4.me',Cookie:cookie}});assert.equal(response.status,403);assert.equal(response.headers.get('access-control-allow-origin'),null);
  const command={action:'campaign.create',input:{programId:f.programId,terms:{}},key:randomUUID()};
  response=await fetch(base+'/api/partner/v1/commands',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(command)});assert.equal(response.status,403);
  response=await fetch(base+'/api/partner/v1/commands',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},body:JSON.stringify(command)});assert.equal(response.status,403);
  response=await fetch(base+'/api/partner/v1/commands',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},body:JSON.stringify({...command,role:'OWNER'})});assert.equal(response.status,400);
  response=await fetch(base+'/api/operator-partners',{headers:{Origin:ownerOrigin,Cookie:cookie}});assert.equal(response.status,401);
  response=await fetch(base+'/api/partner/v1/session',{headers:{Origin:origin,Cookie:'__Host-3dp-session='+token}});assert.equal(response.status,401);
  response=await fetch(base+'/api/request');assert.equal(response.status,401);
  response=await fetch(base+'/api/partner/v1/unknown');assert.equal(response.status,404);
  response=await fetch(base+'/api/partner/v1/commands',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'x-csrf-token,content-type'}});assert.equal(response.status,204);assert.match(response.headers.get('access-control-allow-headers'),/X-CSRF-Token/);
  const fail=createPartnerHandlers({getRuntime:()=>{throw new Error('secret provider password');},env});
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=body;}};
  await fail.routes['/api/partner/v1/session']({url:'/api/partner/v1/session',method:'GET',headers:{origin}},res);
  assert.equal(res.statusCode,503);assert.ok(!res.body.includes('password'));
 }finally{server?.closeAllConnections();await new Promise(resolve=>server?server.close(resolve):resolve());await f.close();}
});

test('owner authorization requires exact numeric GitHub binding and an enabled owner role',async()=>{
 // Query returns only records matching the complete server-owned SQL predicate;
 // the native identity protocol/grant suites separately verify those tables.
 let supplied;
 const query=async(strings,...values)=>{supplied={sql:strings.join('?'),values};return [{operator_id:'op_verified'}];};
 const authorize=createOwnerAuthorizer({query,env:{OPERATOR_OWNER_SUBJECT:'2610199'},now:()=>new Date(TEST_NOW)});
 const current=await authorize({headers:{cookie:'__Host-3dp-session='+'o'.repeat(43)}});
 assert.equal(current.actor.role,'OWNER');assert.equal(current.actor.id,'op_verified');assert.ok(current.csrfToken);
 assert.ok(supplied.values.includes('2610199'));assert.ok(supplied.values.includes('https://github.com/'));assert.match(supplied.sql,/role='owner'/);assert.match(supplied.sql,/enabled=true/);
 await assert.rejects(authorize({headers:{cookie:'__Host-3dp-partner='+'o'.repeat(43)}}),{status:401});
 await assert.rejects(createOwnerAuthorizer({query,env:{OPERATOR_OWNER_SUBJECT:'username'}})({headers:{cookie:'__Host-3dp-session='+'o'.repeat(43)}}),{status:503});
});
