import { createHash, randomBytes } from 'node:crypto';
import { HttpError } from '../http.js';

export const GITHUB_ISSUER='https://github.com/';
const failure=()=>new HttpError(503,'Sign-in is temporarily unavailable.');
const random=()=>randomBytes(32).toString('base64url');

// OAuth identity is established by GitHub's authenticated user endpoint, never
// by a browser-supplied login/email. Provider tokens are deliberately ephemeral.
export function createGitHubProtocol(config,{fetchImpl=fetch}={}) {
  async function request(url,options) {
    try {
      const response=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(10000)});
      if(!response.ok||Number(response.headers.get('content-length')??0)>65536)throw failure();
      const reader=response.body.getReader();let size=0;const chunks=[];
      try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536)throw failure();chunks.push(Buffer.from(value));}}
      finally{await reader.cancel().catch(()=>{});}
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }catch{throw failure();}
  }
  return {
    async start() {
      const verifier=random(),state=random(),nonce=random();
      const url=new URL('https://github.com/login/oauth/authorize');
      url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:config.callback,state,scope:'',allow_signup:'false',
        code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
      return {verifier,state,nonce,url:url.href};
    },
    async finish(url,flow) {
      if(url.origin!=='https://api.3dprint4.me'||url.pathname!=='/api/auth/callback'||url.searchParams.getAll('state').length!==1||
        url.searchParams.get('state')!==flow.state||url.searchParams.getAll('code').length!==1||!url.searchParams.get('code')||url.searchParams.has('error'))throw failure();
      const token=await request('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json'},body:new URLSearchParams({
        client_id:config.clientId,client_secret:config.clientSecret,code:url.searchParams.get('code'),redirect_uri:config.callback,code_verifier:flow.verifier})});
      if(typeof token.access_token!=='string'||!token.access_token||token.access_token.length>2048||token.token_type!=='bearer'||token.error)throw failure();
      const user=await request('https://api.github.com/user',{method:'GET',headers:{Authorization:'Bearer '+token.access_token,
        Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'3dprint4me-operator'}});
      if(!Number.isSafeInteger(user.id)||user.id<=0||user.type!=='User')throw failure();
      return {iss:GITHUB_ISSUER,sub:String(user.id)};
    }
  };
}
