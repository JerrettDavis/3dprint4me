import test from 'node:test';
import assert from 'node:assert/strict';
import { createOidcService, createCookieIdentityProvider, tokenHash } from '../../lib/operator-identity/oidc.js';

const env={OIDC_ISSUER:'https://auth.example/application/o/3dprint4me/',OIDC_CLIENT_ID:'dedicated-client',OIDC_CLIENT_SECRET:'private-client-secret',OPERATOR_API_ORIGIN:'https://api.3dprint4.me',OPERATOR_WEB_ORIGIN:'https://work.3dprint4.me'};
function fixture() {
  const flows=new Map(),sessions=new Map();let grants=0,enabled=true;
  const store={saveFlow:async flow=>flows.set(flow.cookieHash,flow),consumeFlow:async(hash,stateHash)=>{const f=flows.get(hash);if(!f||f.stateHash!==stateHash)return null;flows.delete(hash);return f;},
    findBinding:async(issuer,subject)=>enabled&&issuer===env.OIDC_ISSUER&&subject==='approved-sub'?{operatorId:'op_existing',authUserId:'existing-neon-id'}:null,
    saveSession:async session=>sessions.set(session.tokenHash,session),deleteSession:async hash=>sessions.delete(hash),
    findSession:async hash=>enabled&&sessions.has(hash)?{authUserId:'existing-neon-id'}:null};
  const protocol={start:async()=>({state:'random-state',nonce:'random-nonce',verifier:'secret-verifier',url:'https://auth.example/authorize?code_challenge=pkce'}),
    finish:async(url,flow)=>{grants++;assert.equal(flow.verifier,'secret-verifier');assert.equal(flow.nonce,'random-nonce');return{iss:env.OIDC_ISSUER,sub:'approved-sub'};}};
  const service=createOidcService({env,store,protocol});
  return {service,store,flows,sessions,grants:()=>grants,disable:()=>{enabled=false;}};
}
function cookie(setCookie) {return setCookie.split(';')[0];}
test('OIDC uses a one-time state-bound flow, maps exact identity and stores only a session hash',async()=>{
  const f=fixture();const start=await f.service.login();
  assert.match(start.cookie,/^__Host-3dp-flow=/);assert.match(start.cookie,/Secure; HttpOnly; SameSite=Lax/);assert.ok(!start.cookie.includes('Domain='));
  assert.equal(f.flows.size,1);
  const req={url:'/api/auth/callback?code=code&state=random-state',headers:{cookie:cookie(start.cookie)}};
  const callback=await f.service.callback(req);
  assert.equal(callback.location,'https://work.3dprint4.me/');assert.match(callback.cookie,/^__Host-3dp-session=/);
  const token=cookie(callback.cookie).split('=')[1];assert.equal(f.sessions.has(token),false);assert.equal(f.sessions.has(tokenHash(token)),true);
  await assert.rejects(()=>f.service.callback(req),/Sign-in/);assert.equal(f.grants(),1);
  const identity=createCookieIdentityProvider({store:f.store});
  assert.deepEqual(await identity.getIdentity({headers:{cookie:cookie(callback.cookie)}}),{authUserId:'existing-neon-id',provider:'authentik'});
  f.disable();assert.equal(await identity.getIdentity({headers:{cookie:cookie(callback.cookie)}}),null);
});
test('missing, duplicated or mismatched flow cookies/state fail before the token exchange',async()=>{
  for(const bad of ['none','state','duplicate']) {
    const f=fixture();const start=await f.service.login();const c=cookie(start.cookie);
    await assert.rejects(()=>f.service.callback({url:'/api/auth/callback?code=x&state='+(bad==='state'?'wrong':'random-state'),headers:{cookie:bad==='none'?'':bad==='duplicate'?c+'; '+c:c}}),/Sign-in/);
    assert.equal(f.grants(),0);
  }
});
test('unapproved identity cannot obtain a session; logout requires the exact web origin',async()=>{
  const f=fixture();f.disable();const start=await f.service.login();
  await assert.rejects(()=>f.service.callback({url:'/api/auth/callback?code=x&state=random-state',headers:{cookie:cookie(start.cookie)}}),/authorized/);
  assert.equal(f.sessions.size,0);
  await assert.rejects(()=>f.service.logout({headers:{origin:'https://evil.example'}}),/Origin/);
  assert.match((await f.service.logout({headers:{origin:env.OPERATOR_WEB_ORIGIN}})).cookie,/Max-Age=0/);
});
test('session identity rejects bearer tokens and duplicate cookies; config rejects unsafe origins',async()=>{
  const f=fixture(),identity=createCookieIdentityProvider({store:f.store});
  assert.equal(await identity.getIdentity({headers:{authorization:'Bearer private-token'}}),null);
  assert.equal(await identity.getIdentity({headers:{cookie:'__Host-3dp-session='+'a'.repeat(43)+'; __Host-3dp-session='+'b'.repeat(43)}}),null);
  for(const values of [{OPERATOR_API_ORIGIN:'http://api.3dprint4.me'},{OPERATOR_WEB_ORIGIN:'https://example.vercel.app'},{OIDC_ISSUER:'http://auth.example/'}])assert.throws(()=>createOidcService({env:{...env,...values},store:f.store,protocol:{}}));
});

test('login capacity failure does not redirect and requests are rate limited before discovery',async()=>{
  const f=fixture();let starts=0;
  const protocol={start:async()=>{starts++;return {state:'state',nonce:'nonce',verifier:'verifier',url:'https://auth.example/authorize'};}};
  const unavailable=createOidcService({env,protocol,store:{...f.store,saveFlow:async()=>false}});
  await assert.rejects(()=>unavailable.login(),error=>error.status===503);
  let clock=60000;
  const service=createOidcService({env,protocol,store:{...f.store,saveFlow:async()=>true},now:()=>clock});
  const req={headers:{'x-forwarded-for':'192.0.2.1'}};
  for(let i=0;i<5;i++)await service.login(req);
  const before=starts;
  await assert.rejects(()=>service.login(req),error=>error.status===429&&error.headers['Retry-After']==='60');
  assert.equal(starts,before);
  await service.login({headers:{'x-forwarded-for':'192.0.2.2'}});
  clock+=60000;await service.login(req);
  const global=createOidcService({env,protocol,store:{...f.store,saveFlow:async()=>true},now:()=>clock});
  for(let i=0;i<100;i++)await global.login({headers:{'x-forwarded-for':`192.0.2.${i}`}});
  await assert.rejects(()=>global.login({headers:{'x-forwarded-for':'198.51.100.1'}}),error=>error.status===429);
});
