import { createHash } from 'node:crypto';
import { capabilityMatches } from '../print-estimation/capability.js';
const DAY=86400000,PERIOD=21600000,ORIGIN='https://3dprint4.me';
export function initialFunctionalState(now=Date.now()) {
 return {version:1,nextCheckAt:now,failures:0,workflow:null,mail:null,public:{provider:'postgres',checkedAt:now,filesOk:null,estimatesOk:null,
  filesVerifiedAt:null,estimatesVerifiedAt:null,stage:'idle',nextCheckAt:now,failureCode:'none',cleanupPending:false,
  receiptId:null,receiptSentAt:null,emailStage:'idle',emailNextAt:now,lastRepairAt:null,repairService:'none',repairOutcome:'none',repairAttempts:0}};
}
// A closed 10 mm tetrahedron, independent of customer files and generator inputs.
export function functionalModel() {
 const faces=[[[0,0,0],[0,10,0],[10,0,0]],[[0,0,0],[10,0,0],[0,0,10]],[[10,0,0],[0,10,0],[0,0,10]],[[0,10,0],[0,0,0],[0,0,10]]];
 return Buffer.from('solid status\n'+faces.map(face=>'facet normal 0 0 0\nouter loop\n'+face.map(v=>'vertex '+v.join(' ')).join('\n')+'\nendloop\nendfacet').join('\n')+'\nendsolid status\n');
}
class ProbeFailure extends Error {constructor(code,retryAfter=0){super(code);this.code=code;this.retryAfter=retryAfter;}}
async function boundedBody(response,maximum=65536) {
 if(Number(response.headers.get('content-length'))>maximum)throw new ProbeFailure('network');
 const reader=response.body?.getReader();if(!reader)return Buffer.alloc(0);const chunks=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>maximum)throw new ProbeFailure('network');chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});}
 return Buffer.concat(chunks);
}
export async function runFunctionalProbe(state,{now=()=>Date.now(),env=process.env,fetchImpl=fetch,repository,fileStore,checkpoint=async()=>{},mailTransport,emailEnabled=true}={}) {
 const save=async()=>{state.public.checkedAt=now();state.public.nextCheckAt=state.nextCheckAt;state.public.cleanupPending=Boolean(state.workflow?.stage==='cleanup');await checkpoint(state);};
 const request=async(url,options={})=>{
  const r=await fetchImpl(url,{...options,redirect:'manual',signal:AbortSignal.timeout(10000)});
  if(r.status===429){const v=r.headers.get('retry-after');const delay=/^\d+$/.test(v??'')?Number(v)*1000:Date.parse(v)-now();await r.body?.cancel();throw new ProbeFailure('throttled',Math.min(DAY,Math.max(900000,delay||0)));}
  return r;
 };
 const api=async(body,query='',headers={})=>{
  const r=await request(ORIGIN+'/api/print-estimate'+query,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok){await r.body?.cancel();throw new ProbeFailure('network');}
  return JSON.parse((await boundedBody(r)).toString());
 };
 if(emailEnabled&&mailTransport) {
  if(state.mail?.status==='pending'){state.mail.status='ambiguous';await save();}
  if(!state.mail||now()>=state.mail.nextAt) {
   if(env.RESEND_API_KEY&&env.REQUEST_TO_EMAIL&&env.REQUEST_FROM_EMAIL) {
    const attemptAt=now(),day=new Date(attemptAt).toISOString().slice(0,10);
    const envelope={from:env.REQUEST_FROM_EMAIL,to:[env.REQUEST_TO_EMAIL],subject:'3dprint4.me receipt delivery verification',html:'<p>Scheduled verification of the production receipt transport. No customer request or invoice was created.</p>',idempotencyKey:'status-receipt/'+day};
    state.mail={status:'pending',attemptAt,nextAt:attemptAt+DAY,envelope};await save();
    try{const result=await mailTransport(envelope);if(!result?.accepted||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(result.id??''))throw Error('Unverified acceptance');state.mail.status='accepted';state.mail.id=result.id;}
    catch{state.mail.status='ambiguous';}
   }else state.mail={status:'failed',attemptAt:now(),nextAt:now()+DAY};
  }
 }
 state.public.receiptId=state.mail?.id??null;state.public.receiptSentAt=state.mail?.attemptAt??null;
 state.public.emailStage=state.mail?.status??'idle';state.public.emailNextAt=state.mail?.nextAt??now();
 await save();
 if(now()<state.nextCheckAt)return state;
 try{
  if(!state.workflow) {
   const response=await request(ORIGIN+'/api/health');
   if(!response.ok)throw new ProbeFailure('network');
   const health=JSON.parse((await boundedBody(response)).toString());
   if(health.ok!==true||health.databaseProvider!=='postgres')throw new ProbeFailure('configuration');
   const created=await api({action:'create',options:{material:'pla',quality:'standard',supports:'none'}});
   if(!/^est_[a-f0-9]{32}$/.test(created.sessionId??'')||!/^[A-Za-z0-9_-]{43}$/.test(created.token??''))throw new ProbeFailure('configuration');
   state.workflow={sessionId:created.sessionId,token:created.token,stage:'authorize',startedAt:now(),assetId:null};
   state.public.stage='upload';await save();
  }
  const w=state.workflow,ownership={sessionId:w.sessionId,token:w.token},bytes=functionalModel();
  if(w.stage!=='cleanup'&&now()-w.startedAt>1800000){w.stage='cleanup';state.public.estimatesOk=false;state.public.failureCode='timeout';await save();}
  if(w.stage==='authorize') {
   const signed=await api({action:'authorize-upload',...ownership,filename:'status-verification.stl',size:bytes.length,contentType:'model/stl'});
   const url=new URL(signed.uploadUrl);
   if(!/^asset_[a-f0-9]{32}$/.test(signed.assetId??'')||url.protocol!=='https:'||url.hostname!=='vercel.com'||url.pathname!=='/api/blob/'||url.username||url.password||signed.method!=='PUT')throw new ProbeFailure('configuration');
   w.assetId=signed.assetId;w.uploadUrl=signed.uploadUrl;w.stage='upload';await save();
  }
  if(w.stage==='upload') {
   const uploaded=await request(w.uploadUrl,{method:'PUT',headers:{'Content-Type':'model/stl'},body:bytes});
   await uploaded.body?.cancel();if(!uploaded.ok)throw new ProbeFailure('upload');
   w.stage='analyze';await save();
  }
  if(w.stage==='analyze') {
   const asset=await repository.findAsset(w.assetId),session=await repository.findSession(w.sessionId);
   if(!session||session.requestId||!capabilityMatches(w.token,session.ownershipHash)||asset?.sessionId!==w.sessionId||asset.requestId)throw new ProbeFailure('configuration');
   const raw=await fileStore.read(asset.blobPath,16384);
   if(createHash('sha256').update(raw).digest('hex')!==createHash('sha256').update(bytes).digest('hex'))throw new ProbeFailure('readback');
   const anonymous=new URL(await fileStore.signDownload(asset.blobPath,60));
   if(anonymous.protocol!=='https:'||!anonymous.hostname.endsWith('.private.blob.vercel-storage.com')||anonymous.username||anonymous.password)throw new ProbeFailure('configuration');
   anonymous.search='';
   const denied=await request(anonymous.href);await denied.body?.cancel();if(![401,403,404].includes(denied.status))throw new ProbeFailure('privacy');
   state.public.filesVerifiedAt=now();state.public.filesOk=true;state.public.stage='analyze';await save();
   const result=await api({action:'analyze',...ownership,assetId:w.assetId});
   if(result.status!=='ready')throw new ProbeFailure('analysis');
   w.stage='slicing';state.public.stage='slicing';await save();
  }
  if(w.stage==='slicing') {
   const result=await api(null,'?id='+encodeURIComponent(w.sessionId),{'X-Print-Estimate-Token':w.token});
   if(result.slice?.status==='ready') {
    state.public.estimatesVerifiedAt=now();state.public.estimatesOk=true;state.public.failureCode='none';state.failures=0;
    w.stage='cleanup';await save();
   }else if(['pending','processing','not_requested'].includes(result.slice?.status)) {state.nextCheckAt=now()+300000;await save();return state;}
   else throw new ProbeFailure('slice');
  }
  if(w.stage==='cleanup') {
   state.public.stage='cleanup';await save();
   const session=await repository.findSession(w.sessionId);
   if(session) {
    if(session.requestId||!capabilityMatches(w.token,session.ownershipHash))throw new ProbeFailure('cleanup');
    if(w.assetId) {
     const asset=await repository.findAsset(w.assetId);
     if(asset&&(asset.sessionId!==w.sessionId||asset.requestId))throw new ProbeFailure('cleanup');
     if(asset) {const jobs=await repository.listAssetJobs(w.assetId);if(jobs.some(j=>j.state==='processing'&&Date.parse(j.leaseExpiresAt)>now()))throw new ProbeFailure('cleanup');await fileStore.delete(asset.blobPath);}
    }
    await repository.deleteUnattachedSession(w.sessionId);
   }
   state.workflow=null;state.public.stage=state.public.failureCode==='none'?'complete':'failed';state.nextCheckAt=now()+PERIOD;await save();
  }
 }catch(error){
  const code=error instanceof ProbeFailure?error.code:'network';state.failures=Math.min((state.failures??0)+1,8);
  state.public.failureCode=code;state.public.stage=state.workflow?.stage==='cleanup'?'cleanup':'backoff';
  if(['upload','privacy','readback'].includes(code))state.public.filesOk=false;
  if(['analysis','slice','timeout'].includes(code))state.public.estimatesOk=false;
  state.nextCheckAt=now()+Math.max(error.retryAfter??0,Math.min(PERIOD,900000*2**(state.failures-1)));
  if(state.workflow&&state.failures>=3)state.workflow.stage='cleanup';
  await save();
 }
 return state;
}
