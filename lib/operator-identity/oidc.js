import { createHash, randomBytes } from 'node:crypto';
import * as oidc from 'openid-client';
import { HttpError } from '../http.js';

export const tokenHash=value=>createHash('sha256').update(value).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
const cookie=(name,value,maxAge)=>`${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
function readCookie(req,name) {
  if(typeof req.headers?.cookie!=='string')return null;
  const values=req.headers.cookie.split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));
  if(values.length!==1)return null;
  const value=values[0].slice(name.length+1);return /^[A-Za-z0-9_-]{43}$/.test(value)?value:null;
}
function settings(env) {
  const issuer=new URL(env.OIDC_ISSUER);
  if(issuer.protocol!=='https:'||issuer.username||issuer.password||issuer.search||issuer.hash||
    env.OPERATOR_API_ORIGIN!=='https://api.3dprint4.me'||env.OPERATOR_WEB_ORIGIN!=='https://work.3dprint4.me'||
    !env.OIDC_CLIENT_ID||!env.OIDC_CLIENT_SECRET)throw new Error('Invalid operator authentication configuration.');
  return {issuer:issuer.href,clientId:env.OIDC_CLIENT_ID,clientSecret:env.OIDC_CLIENT_SECRET,
    callback:env.OPERATOR_API_ORIGIN+'/api/auth/callback',web:env.OPERATOR_WEB_ORIGIN};
}
export function createOidcProtocol(config,{fetchImpl}={}) {
  let pending;
  const discovery=()=>pending??=(oidc.discovery(new URL(config.issuer),config.clientId,
    {client_secret:config.clientSecret,token_endpoint_auth_method:'client_secret_basic',id_token_signed_response_alg:'RS256'},
    oidc.ClientSecretBasic(config.clientSecret),{timeout:10,execute:[oidc.enableNonRepudiationChecks],
      ...(fetchImpl?{[oidc.customFetch]:fetchImpl}:{})}).catch(error=>{pending=undefined;throw error;}));
  return {
    async start() {
      const client=await discovery(),verifier=oidc.randomPKCECodeVerifier(),state=oidc.randomState(),nonce=oidc.randomNonce();
      const url=oidc.buildAuthorizationUrl(client,{redirect_uri:config.callback,response_type:'code',scope:'openid profile',
        code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',state,nonce});
      return {verifier,state,nonce,url:url.href};
    },
    async finish(url,flow) {
      const result=await oidc.authorizationCodeGrant(await discovery(),url,{pkceCodeVerifier:flow.verifier,expectedState:flow.state,expectedNonce:flow.nonce});
      return result.claims();
    }
  };
}
export function createCookieIdentityProvider({store}) {
  return {async getIdentity(req) {
    const value=readCookie(req,'__Host-3dp-session');if(!value)return null;
    const session=await store.findSession(tokenHash(value));
    return session?{authUserId:session.authUserId,provider:'authentik'}:null;
  }};
}
export function createOidcService({env=process.env,store,protocol,now=()=>Date.now()}) {
  const config=settings(env);protocol??=createOidcProtocol(config);
  return {
    async login() {
      const flow=await protocol.start(),raw=token();
      await store.saveFlow({...flow,cookieHash:tokenHash(raw),stateHash:tokenHash(flow.state),expiresAt:now()+600000});
      return {location:flow.url,cookie:cookie('__Host-3dp-flow',raw,600)};
    },
    async callback(req) {
      const raw=readCookie(req,'__Host-3dp-flow'),url=new URL(req.url,'https://api.3dprint4.me');
      const state=url.searchParams.get('state'),code=url.searchParams.get('code');
      if(!raw||url.pathname!=='/api/auth/callback'||!state||state.length>256||!code||code.length>4096||
        url.searchParams.getAll('state').length!==1||url.searchParams.getAll('code').length!==1)throw new HttpError(400,'Sign-in could not be verified.');
      const flow=await store.consumeFlow(tokenHash(raw),tokenHash(state));
      if(!flow||flow.expiresAt<=now())throw new HttpError(400,'Sign-in could not be verified.');
      const claims=await protocol.finish(url,flow);
      if(claims?.iss!==config.issuer||typeof claims.sub!=='string'||!claims.sub||claims.sub.length>512)throw new HttpError(401,'Sign-in could not be verified.');
      const binding=await store.findBinding(claims.iss,claims.sub);
      if(!binding)throw new HttpError(403,'This identity is not authorized for operator access.');
      const value=token();await store.saveSession({tokenHash:tokenHash(value),operatorId:binding.operatorId,issuer:claims.iss,subject:claims.sub,expiresAt:now()+8*3600000});
      return {location:config.web+'/',cookie:cookie('__Host-3dp-session',value,8*3600),clearFlow:cookie('__Host-3dp-flow','',0)};
    },
    async logout(req) {
      if(req.headers?.origin!==config.web)throw new HttpError(403,'Origin is not allowed.');
      const value=readCookie(req,'__Host-3dp-session');if(value)await store.deleteSession(tokenHash(value));
      return {cookie:cookie('__Host-3dp-session','',0)};
    }
  };
}
