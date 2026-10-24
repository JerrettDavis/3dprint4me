import { createHmac,timingSafeEqual } from 'node:crypto';
import { HttpError,readJson,sendJson } from '../http.js';
import { GITHUB_ISSUER } from '../operator-identity/github.js';
import { partnerCookie } from './auth.js';
import { digest } from './postgres-repository.js';
import { exact,text,uuid } from './validation.js';

export function readPartnerCookie(req,name='__Host-3dp-partner') {
 const raw=req.headers?.cookie;if(typeof raw!=='string')return null;
 const matches=raw.split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));
 if(matches.length!==1)return null;const value=matches[0].slice(name.length+1);return /^[A-Za-z0-9_-]{43}$/.test(value)?value:null;
}
const ownerCsrf=token=>createHmac('sha256',token).update('3dprint4me-partner-owner-csrf-v1').digest('base64url');
function requireOwnerCsrf(session,value) {
 const a=Buffer.from(digest(typeof value==='string'?value:''),'hex'),b=Buffer.from(digest(session.csrfToken),'hex');
 if(!timingSafeEqual(a,b))throw new HttpError(403,'Refresh the owner workspace before submitting.');
}
export function createOwnerAuthorizer({query,env=process.env,now=()=>new Date()}={}) {
 return async req=>{
  const token=readPartnerCookie(req,'__Host-3dp-session');if(!token)throw new HttpError(401,'Owner sign-in is required.');
  const subject=env.OPERATOR_OWNER_SUBJECT;if(typeof subject!=='string'||!/^\d{1,20}$/.test(subject))throw new HttpError(503,'Owner access is temporarily unavailable.');
  const [row]=await query`SELECT s.operator_id FROM operator_sessions s JOIN operator_identity_bindings b ON b.operator_id=s.operator_id AND b.issuer=s.issuer AND b.subject=s.subject JOIN operators o ON o.id=s.operator_id WHERE s.token_hash=${digest(token)} AND s.expires_at>${now().toISOString()} AND s.issuer=${GITHUB_ISSUER} AND s.subject=${subject} AND o.role='owner' AND o.enabled=true`;
  if(!row)throw new HttpError(403,'Owner access is required.');
  return {actor:{role:'OWNER',id:row.operator_id,ownerSessionHash:digest(token)},csrfToken:ownerCsrf(token)};
 };
}
const PARTNER_RESOURCES=['gigs','gig','earnings','agreements','profile','visits','leads','activity','referrals','statement','export'];
export function createPartnerHandlers({getRuntime,env=process.env,now=()=>new Date()}={}) {
 const partnerOrigin=env.PARTNER_WEB_ORIGIN??'https://partners.3dprint4.me',ownerOrigin=env.OPERATOR_WEB_ORIGIN??'https://work.3dprint4.me';
 for(const value of [partnerOrigin,ownerOrigin]){const parsed=new URL(value);if(parsed.origin!==value||parsed.username||parsed.password||!['https:','http:'].includes(parsed.protocol)||(parsed.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)))throw new Error('Invalid partner origin configuration.');}
 const paths=['status','session','login','invite/redeem','logout','commands',...PARTNER_RESOURCES].map(p=>'/api/partner/v1/'+p);
 const routes=Object.fromEntries([...paths,'/api/operator-partners'].map(path=>[path,handle]));
 async function handle(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  try{
   const url=new URL(req.url,'https://partner-api.invalid'),ownerRoute=url.pathname==='/api/operator-partners',allowed=ownerRoute?ownerOrigin:partnerOrigin;
   if(!Object.hasOwn(routes,url.pathname))throw new HttpError(404,'Not found.');
   const origin=req.headers?.origin;
   if((origin&&origin!==allowed)||(!origin&&!['GET','HEAD'].includes(req.method)))throw new HttpError(403,'Origin is not allowed.');
   if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Vary','Origin');}
   res.setHeader('Access-Control-Allow-Headers','Content-Type, Idempotency-Key, X-CSRF-Token');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
   if(req.method==='OPTIONS'){res.statusCode=204;res.end();return;}
   if(!['GET','POST'].includes(req.method))throw new HttpError(405,'Method not allowed.',undefined,{Allow:'GET, POST, OPTIONS'});
   for(const key of url.searchParams.keys())if(!['resource','id','programId'].includes(key)||url.searchParams.getAll(key).length!==1)throw new HttpError(400,'Invalid query parameters.');
   const runtime=getRuntime(),clientKey=String(req.headers?.['x-forwarded-for']??req.socket?.remoteAddress??'unknown').slice(0,200);
   if(ownerRoute){
    const current=await createOwnerAuthorizer({query:(...args)=>runtime.database.query(...args),env,now})(req);
    if(req.method==='GET'){
     const resource=url.searchParams.get('resource')??'programs';
     if(resource==='session'){sendJson(res,200,{owner:{id:current.actor.id},csrfToken:current.csrfToken});return;}
     const input=Object.fromEntries([...url.searchParams].filter(([key])=>key!=='resource'));
     sendJson(res,200,{...await runtime.app.read(current.actor,resource,input),csrfToken:current.csrfToken});return;
    }
    requireOwnerCsrf(current,req.headers?.['x-csrf-token']);
    const body=exact(await readJson(req,262144),['action','input','key']);uuid(body.key);text(body.action,80);
    let result;
    if(body.action==='partner.invite'){exact(body.input,['partnerId','purpose']);result=await runtime.auth.issueInvite({actor:current.actor,...body.input});}
    else if(body.action==='partner.revoke'){exact(body.input,['partnerId','status']);result=await runtime.auth.revoke({actor:current.actor,...body.input});}
    else result=await runtime.app.execute({actor:current.actor,...body});
    sendJson(res,200,result);return;
   }
   const operation=url.pathname.slice('/api/partner/v1/'.length);
   if(operation==='status'){
    if(req.method!=='GET')throw new HttpError(405,'Method not allowed.');
    // Public maintenance copy cannot assert professional clearance from flags.
    sendJson(res,200,{message:'Partner access is by private invitation. Contact the owner for help.',invitationRequired:true});return;
   }
   if(['login','invite/redeem'].includes(operation)){
    if(req.method!=='POST')throw new HttpError(405,'Method not allowed.');
    const body=await readJson(req,4096);
    const result=operation==='login'?await runtime.auth.login({...exact(body,['accountId','password']),clientKey}):await runtime.auth.redeem({...exact(body,['token','password']),clientKey});
    res.setHeader('Set-Cookie',partnerCookie(result.token));sendJson(res,200,{partner:result.partner,csrfToken:result.csrfToken});return;
   }
   const token=readPartnerCookie(req),current=await runtime.auth.session(token);
   if(operation==='session'){
    if(req.method!=='GET')throw new HttpError(405,'Method not allowed.');
    res.setHeader('Set-Cookie',partnerCookie(token));sendJson(res,200,{partner:current.partner,csrfToken:current.csrfToken});return;
   }
   if(['commands','logout'].includes(operation)){
    if(req.method!=='POST')throw new HttpError(405,'Method not allowed.');
    runtime.auth.requireCsrf(current,req.headers?.['x-csrf-token']);
    if(operation==='logout'){await runtime.auth.logout(token);res.setHeader('Set-Cookie',partnerCookie('',{clear:true}));sendJson(res,200,{ok:true});return;}
    const body=exact(await readJson(req,262144),['action','input','key']);uuid(body.key);text(body.action,80);
    sendJson(res,200,await runtime.app.execute({actor:current.actor,...body}));return;
   }
   if(req.method!=='GET')throw new HttpError(405,'Method not allowed.');
   const input=Object.fromEntries([...url.searchParams].filter(([key])=>key!=='resource'));
   sendJson(res,200,await runtime.app.read(current.actor,operation,input));
  }catch(error){
   const status=error instanceof HttpError&&error.status<500?error.status:503;
   for(const [key,value]of Object.entries(error?.headers??{}))res.setHeader(key,value);
   const details=error?.details?.missingGates?{missingGates:error.details.missingGates}:{};
   sendJson(res,status,{error:status>=500?'The partner service is temporarily unavailable. Please try again later.':error.message,...details});
  }
 }
 return {routes,directPaths:paths};
}
