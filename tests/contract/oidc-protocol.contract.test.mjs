import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createOidcProtocol } from '../../lib/operator-identity/oidc.js';

const keys=await generateKeyPair('RS256',{extractable:true}),other=await generateKeyPair('RS256');
const jwk={...await exportJWK(keys.publicKey),kid:'test',alg:'RS256',use:'sig'};
const config={issuer:'https://auth.example/application/o/operator/',clientId:'test-client',clientSecret:'test-secret',callback:'https://api.3dprint4.me/api/auth/callback'};
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
async function fixture(change='valid') {
  let flow,tokenCalls=0,jwksCalls=0;
  const protocol=createOidcProtocol(config,{fetchImpl:async(url,options)=>{
    if(String(url)===config.issuer+'.well-known/openid-configuration')return json({issuer:change==='metadata-issuer'?'https://wrong.example/':config.issuer,authorization_endpoint:config.issuer+'authorize',token_endpoint:config.issuer+'token',jwks_uri:config.issuer+'jwks',response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['client_secret_basic']});
    if(String(url)===config.issuer+'jwks'){jwksCalls++;return json({keys:[jwk]});}
    assert.equal(String(url),config.issuer+'token');tokenCalls++;
    const body=new URLSearchParams(options.body);
    assert.equal(options.method,'POST');assert.equal(body.get('grant_type'),'authorization_code');
    assert.equal(body.get('code_verifier'),flow.verifier);assert.equal(body.get('redirect_uri'),config.callback);
    assert.deepEqual(Buffer.from(new Headers(options.headers).get('authorization').slice(6),'base64').toString().split(':').map(decodeURIComponent),[config.clientId,config.clientSecret]);
    const now=Math.floor(Date.now()/1000);
    const idToken=await new SignJWT({sub:'approved-user',nonce:change==='nonce'?'wrong':flow.nonce})
      .setProtectedHeader({alg:'RS256',kid:'test'})
      .setIssuer(change==='issuer'?'https://wrong.example/':config.issuer)
      .setAudience(change==='audience'?'wrong-client':config.clientId)
      .setIssuedAt(now).setExpirationTime(change==='expired'?now-300:now+300)
      .sign(change==='signature'?other.privateKey:keys.privateKey);
    return json({access_token:'unused-test-access-token',token_type:'Bearer',expires_in:300,...(change==='missing-id-token'?{}:{id_token:idToken})});
  }});
  flow=await protocol.start();
  const authorization=new URL(flow.url);
  assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');assert.ok(authorization.searchParams.get('code_challenge'));
  assert.equal(authorization.searchParams.get('nonce'),flow.nonce);
  const callback=new URL(config.callback);callback.searchParams.set('code','test-code');callback.searchParams.set('state',change==='state'?'wrong':flow.state);
  return {finish:()=>protocol.finish(callback,flow),tokenCalls:()=>tokenCalls,jwksCalls:()=>jwksCalls};
}
test('production OIDC protocol performs discovery, confidential PKCE exchange and signed ID-token verification',async()=>{
  const f=await fixture();const claims=await f.finish();assert.equal(claims.sub,'approved-user');assert.equal(f.tokenCalls(),1);assert.equal(f.jwksCalls(),1);
});
for(const change of ['state','nonce','issuer','audience','expired','signature','missing-id-token'])test(`production OIDC protocol rejects ${change}`,async()=>{
  const f=await fixture(change);await assert.rejects(f.finish());if(change==='state')assert.equal(f.tokenCalls(),0);
});
test('OIDC discovery rejects metadata from a different issuer',async()=>{await assert.rejects(fixture('metadata-issuer'));});
