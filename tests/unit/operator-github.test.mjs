import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubProtocol } from '../../lib/operator-identity/github.js';
import { createOidcService, tokenHash } from '../../lib/operator-identity/oidc.js';

test('GitHub uses PKCE, confidential exchange and exact numeric identity without repository scopes',async()=>{
  const calls=[];
  const protocol=createGitHubProtocol({clientId:'client',clientSecret:'private',callback:'https://api.3dprint4.me/api/auth/callback'},{fetchImpl:async(url,options)=>{
    calls.push({url,options});return Response.json(calls.length===1?{access_token:'temporary',token_type:'bearer'}:{id:2610199,type:'User',login:'ignored',email:'ignored'});
  }});
  const flow=await protocol.start(),authorize=new URL(flow.url);
  assert.equal(authorize.origin,'https://github.com');assert.equal(authorize.searchParams.get('scope'),'');
  assert.equal(authorize.searchParams.get('code_challenge_method'),'S256');assert.equal(authorize.searchParams.get('allow_signup'),'false');
  const callback=new URL('https://api.3dprint4.me/api/auth/callback');callback.searchParams.set('state',flow.state);callback.searchParams.set('code','code');
  assert.deepEqual(await protocol.finish(callback,flow),{iss:'https://github.com/',sub:'2610199'});
  assert.equal(calls[0].url,'https://github.com/login/oauth/access_token');assert.equal(calls[0].options.method,'POST');
  assert.equal(calls[0].options.body.get('code_verifier'),flow.verifier);assert.equal(calls[0].options.body.get('client_secret'),'private');
  assert.equal(calls[1].url,'https://api.github.com/user');assert.equal(calls[1].options.headers.Authorization,'Bearer temporary');
  assert.equal(calls[1].options.headers['X-GitHub-Api-Version'],'2026-03-10');assert.equal(calls[1].options.redirect,'error');
  await assert.rejects(protocol.finish(new URL(callback.href.replace(flow.state,'bad')),flow));assert.equal(calls.length,2);
});

test('GitHub rejects invalid identity and sanitizes provider failures',async()=>{
  for(const result of [{id:1,type:'Organization'},{id:'2610199',type:'User'},{id:-1,type:'User'}]){
    let n=0;const p=createGitHubProtocol({clientId:'c',clientSecret:'s',callback:'https://api.3dprint4.me/api/auth/callback'},{fetchImpl:async()=>Response.json(++n===1?{access_token:'secret',token_type:'bearer'}:result)});
    const f=await p.start(),u=new URL('https://api.3dprint4.me/api/auth/callback');u.searchParams.set('state',f.state);u.searchParams.set('code','c');
    await assert.rejects(p.finish(u,f),e=>!e.message.includes('secret'));
  }
});

test('GitHub bounds and sanitizes provider HTTP, token, JSON and network failures',async()=>{
  const failures=[()=>new Response('private',{status:400}),()=>Response.json({error:'private'}),()=>Response.json({}),
    ()=>Response.json({access_token:'private',token_type:'wrong'}),()=>new Response('private malformed JSON'),
    ()=>new Response('{}',{headers:{'content-length':'65537'}}),()=>new Response('x'.repeat(65537)),
    ()=>{throw new Error('private network failure');}];
  for(const response of failures){
    const p=createGitHubProtocol({clientId:'c',clientSecret:'s',callback:'https://api.3dprint4.me/api/auth/callback'},{fetchImpl:async(_,options)=>{
      assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);return response();
    }});
    const f=await p.start(),u=new URL('https://api.3dprint4.me/api/auth/callback');u.searchParams.set('state',f.state);u.searchParams.set('code','c');
    await assert.rejects(p.finish(u,f),e=>e.status===503&&e.message==='Sign-in is temporarily unavailable.');
  }
});

test('GitHub service binds exact numeric identity and retains only application session hash',async()=>{
  let flow,saved,lookup;
  const env={OPERATOR_AUTH_PROVIDER:'github',GITHUB_CLIENT_ID:'client',GITHUB_CLIENT_SECRET:'private',OPERATOR_API_ORIGIN:'https://api.3dprint4.me',OPERATOR_WEB_ORIGIN:'https://work.3dprint4.me'};
  const store={saveFlow:async f=>{flow=f;return true;},consumeFlow:async(hash,state)=>{
    if(!flow||hash!==flow.cookieHash||state!==flow.stateHash)return null;const result=flow;flow=null;return result;
  },findBinding:async(issuer,subject)=>{lookup=[issuer,subject];return subject==='2610199'?{operatorId:'existing-operator'}:null;},saveSession:async value=>{saved=value;}};
  const protocol={start:async()=>({state:'state',verifier:'verifier',nonce:'unused',url:'https://github.com/login/oauth/authorize'}),finish:async()=>({iss:'https://github.com/',sub:'2610199'})};
  const service=createOidcService({env,store,protocol}),start=await service.login();
  const result=await service.callback({url:'/api/auth/callback?state=state&code=code',headers:{cookie:start.cookie.split(';')[0]}});
  assert.deepEqual(lookup,['https://github.com/','2610199']);assert.equal(saved.operatorId,'existing-operator');
  assert.equal(saved.tokenHash,tokenHash(result.cookie.split(';')[0].split('=')[1]));assert.equal(saved.access_token,undefined);
  assert.match(result.cookie,/Secure; HttpOnly; SameSite=Lax/);
});
