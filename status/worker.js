import { privateSnapshot, publicSnapshot, probeServices, updateProbeState, validateHeartbeat } from './lib/model.js';
import { deliverStatusAlert } from './lib/alerts.js';
import { updateCapacity } from './lib/capacity.js';
import { operationsPage } from './lib/operations-page.js';
import { collectProviderCapacity, providerCoverage } from './lib/capacity-providers.js';

const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
async function bodyText(request) {
  if(Number(request.headers.get('content-length'))>16384)throw new Error('Body bound.');
  const reader=request.body?.getReader();if(!reader)throw new Error('Missing body.');
  const chunks=[];let length=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>16384)throw new Error('Body bound.');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return new TextDecoder().decode(bytes);
}
// SQLite-backed Durable Object: serial execution makes replay checks atomic even
// across Worker isolates. No PostgreSQL, Neon, timers or local services required.
export class StatusState {
  constructor(ctx,env){this.ctx=ctx;this.env=env;}
  fetch(request){return this.ctx.blockConcurrencyWhile(()=>this.handle(request));}
  async handle(request) {
    const path=new URL(request.url).pathname,now=Date.now();
    const state=await this.ctx.storage.get('state')??{};
    if(path==='/internal/probe'&&request.method==='POST') {
      if(state.checkedAt&&now-state.checkedAt<240000)return json({ok:true});
      const next=updateProbeState(state,await probeServices({now}),now),day=new Date(now).toISOString().slice(0,10);
      const history=[...(state.history??[])],entry=history.find(x=>x.day===day)??{day,checks:0,failed:0};
      if(!history.includes(entry))history.push(entry);
      entry.checks++;if(Object.values(next.probes).some(x=>!x.ok))entry.failed++;
      next.history=history.slice(-30);
      if(!state.providerCollectionAt||now-state.providerCollectionAt>=3600000) {
        next.providerCollectionAt=now;
        next.providerCoverage=providerCoverage(this.env);
        next.providerAvailability={...(state.providerAvailability??{})};
        const skipUntil=Object.fromEntries(Object.entries(next.providerAvailability).map(([id,value])=>[id,value.retryAt??0]));
        try {
          const readings=await collectProviderCapacity({env:this.env,now,skipUntil,onAvailability:value=>{next.providerAvailability[value.provider]=value;}});
          next.capacity=updateCapacity(state.capacity,readings,now);
        }catch{/* Original last-good measurement timestamps remain unchanged. */}
      }
      next.alerts={...(next.alerts??{}),configured:Boolean(this.env.ALERT_RESEND_KEY&&this.env.ALERT_FROM&&this.env.ALERT_TO)};
      const final=await deliverStatusAlert({state:next,view:privateSnapshot(next,now),env:this.env,now,persist:value=>this.ctx.storage.put('state',value)});
      await this.ctx.storage.put('state',final);return json({ok:true});
    }
    if(path.startsWith('/heartbeat/')&&request.method==='POST') {
      const kind=path.slice('/heartbeat/'.length);
      try{
        if(state[kind]?.receivedAt&&now-state[kind].receivedAt<60000)return json({error:'Evidence arrived too frequently.'},429);
        const data=await validateHeartbeat({kind,body:await bodyText(request),signature:request.headers.get('x-status-signature'),secret:this.env['STATUS_'+kind.toUpperCase()+'_SECRET'],now,lastObservedAt:state[kind]?.observedAt??0});
        const next={...state,[kind]:{...data,receivedAt:now}};
        if(data.details.capacity)next.capacity=updateCapacity(state.capacity,data.details.capacity,now);
        await this.ctx.storage.put('state',next);return json({ok:true});
      }catch{return json({error:'Evidence could not be verified.'},401);}
    }
    if(path==='/api/public'&&request.method==='GET')return json(publicSnapshot(state,now));
    if(path==='/operations'&&request.method==='GET')return operationsPage(privateSnapshot(state,now),{theme:new URL(request.url).searchParams.get('theme')??'system'});
    return json({error:'Not found.'},404);
  }
}

async function authorizeReader(request,env) {
  const time=request.headers.get('x-status-read-time'),signature=request.headers.get('x-status-read-signature'),secret=env.STATUS_READER_SECRET;
  if(!secret||secret.length<48||!/^\d{13}$/.test(time??'')||!/^([a-f0-9]{2}){32}$/.test(signature??'')||Date.now()-Number(time)>60000||Number(time)-Date.now()>30000)return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  return crypto.subtle.verify('HMAC',key,Uint8Array.from(signature.match(/../g),x=>parseInt(x,16)),new TextEncoder().encode('/operations-reader\n'+time));
}
export default {
  async fetch(request,env) {
    const path=new URL(request.url).pathname;
    if(path==='/operations'||path==='/operations-reader'&&!await authorizeReader(request,env))return json({error:'Independent operator sign-in is required.'},403);
    if(!((path==='/api/public'||path==='/operations-reader')&&request.method==='GET'||/^\/heartbeat\/(platform|backup|control)$/.test(path)&&request.method==='POST'))return json({error:'Not found.'},404);
    try{
      const stub=env.STATUS_STATE.get(env.STATUS_STATE.idFromName('3dprint4me'));
      const response=await stub.fetch(path==='/operations-reader'?new Request('https://status.internal/operations'+new URL(request.url).search):request);
      if(path==='/api/public') {
        const headers=new Headers(response.headers),origin=request.headers.get('origin');
        const allowed=['https://status.3dprint4.me','https://3dprint4me-status.vercel.app',...(env.DASHBOARD_ORIGINS??'').split(',')];
        if(allowed.includes(origin)){headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');}
        return new Response(response.body,{status:response.status,headers});
      }
      return response;
    }catch{return json({error:'Status evidence is temporarily unavailable.'},503);}
  },
  async scheduled(_event,env,ctx) {
    ctx.waitUntil(env.STATUS_STATE.get(env.STATUS_STATE.idFromName('3dprint4me')).fetch(new Request('https://status.internal/internal/probe',{method:'POST'})));
  }
};
