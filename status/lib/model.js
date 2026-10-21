export const STALE_MS=12*60000;
const fresh=(record,now,age=STALE_MS)=>Number.isFinite(record?.observedAt??record?.checkedAt)&&now-(record.observedAt??record.checkedAt)<=age&&(record.observedAt??record.checkedAt)<=now+30000;
const names={storefront:'Storefront',operator:'Work inbox',api:'Request API',auth:'Operator sign-in',requests:'Project requests',files:'Private uploads',estimates:'Print estimates',email:'Request receipts'};
const stateOf=(value)=>value===true?'operational':value===false?'unavailable':'unknown';
export function publicSnapshot(state={},now=Date.now()) {
  const platform=fresh(state.platform,now)?state.platform.details:{};
  const components=Object.entries(names).map(([id,name])=>{
    const probe=state.probes?.[id];
    let status=probe?(fresh(probe,now)?probe.status??stateOf(probe.ok):'unknown'):
      stateOf(id==='requests'?(platform.database===true?true:platform.database):platform[id]);
    if(['requests','files','estimates','email','auth'].includes(id)&&(!fresh(state.probes?.api,now)||state.probes.api.provider!==platform.provider))status='unknown';
    return {id,name,status,checkedAt:probe?.checkedAt??state.platform?.observedAt??null};
  });
  // Provider reachability is never proof that a complete owner sign-in works.
  components.find(x=>x.id==='auth').scope='GitHub identity API reachability';
  const statuses=components.map(x=>x.status);
  return {version:1,generatedAt:now,checkedAt:state.checkedAt??null,
    overall:statuses.includes('unavailable')?'unavailable':statuses.includes('degraded')?'degraded':statuses.includes('unknown')?'unknown':'operational',
    components,policy:'Invoices stay draft-only. Dispatch is manual.',
    history:(state.history??[]).slice(-30).map(x=>({day:x.day,checks:x.checks,failed:x.failed})),
    incidents:(state.incidents??[]).slice(-20).map(x=>({component:names[x.component]??'Service',openedAt:x.openedAt,resolvedAt:x.resolvedAt??null}))};
}
export function privateSnapshot(state={},now=Date.now()) {
  const control=fresh(state.control,now,86400000)?state.control.details:{};
  const platform=fresh(state.platform,now)?state.platform.details:{};
  const backup=fresh(state.backup,now,6*3600000)?state.backup.details:{};
  const blockers=[];
  const add=(id,title,next,severity='important')=>blockers.push({id,title,next,severity});
  if(!fresh(state.platform,now))add('platform-stale','Local telemetry is missing or stale','Check the local host and telemetry runner.');
  if(!fresh(state.backup,now,6*3600000)||backup.success!==true)add('backup-missing','A recent encrypted backup is not verified','Run the backup and verify the encrypted snapshot.','critical');
  else if(!fresh(state.backup,now,2*3600000))add('backup-aging','The latest backup is more than two hours old','Check the backup schedule.');
  if(backup.copied!==true)add('backup-copy','A second backup copy is not verified','Verify the copied encrypted snapshot.');
  if(control.backupUnattended!==true)add('backup-scheduler','Unattended backup execution is not verified','Register and verify a backup task that runs without an owner desktop session.');
  if(!Number.isFinite(control.restoreVerifiedAt)||now-control.restoreVerifiedAt>30*86400000)add('restore-drill','A restore drill is missing or overdue','Restore into an isolated environment and record the result.');
  if(control.offsiteVerified!==true)add('offsite','Physical off-site recovery and key custody are unverified','Verify a recovery copy and decryption access outside the local site.');
  if(control.neonOffloaded!==true||platform.provider!=='postgres'||control.sourceQuiet!==true)add('neon-exit','Neon offloading has not been verified','Verify database, sign-in, jobs, integrations and old writers before downgrade.');
  if(control.neonPlan!=='free'||!Number.isFinite(control.neonVerifiedAt)||now-control.neonVerifiedAt>86400000)add('neon-billing','Neon Free billing is not recently verified','Check the actual plan, quotas and any final accrued charges.');
  if(control.credentialsReady!==true)add('credentials','Provider credentials are not fully verified','Preserve and verify the configured email and integration paths.');
  if(control.ownerLoginVerified!==true)add('owner-login','Full operator sign-in has not been verified','Complete a real owner sign-in against the production target.');
  if(control.cutoverVerified!==true)add('cutover','Production cutover checks remain incomplete','Verify real target traffic, private files, estimates and draft-only billing.');
  if(platform.jobs!==true)add('jobs','Local background jobs are not verified','Check worker success and the oldest waiting work.');
  if(Number.isFinite(platform.diskFreePercent)&&platform.diskFreePercent<15)add('disk','Local disk capacity is low','Free or add capacity before writes are affected.',platform.diskFreePercent<5?'critical':'important');
  if(state.alerts?.configured!==true)add('alerts','External alert delivery is not configured','Configure the approved independent alert destination.');
  if(state.alerts?.lastFailureAt&&(state.alerts.lastSuccessAt??0)<state.alerts.lastFailureAt)add('alert-delivery','An operational alert could not be verified as delivered','Check the alert provider and pending event.');
  return {...publicSnapshot(state,now),blockers,evidence:{probes:state.probes??{},platform:state.platform??null,backup:state.backup??null,control:state.control??null,alerts:state.alerts?{configured:state.alerts.configured,lastSuccessAt:state.alerts.lastSuccessAt??null,lastFailureAt:state.alerts.lastFailureAt??null,pending:Boolean(state.alerts.pending),ambiguousExpired:state.alerts.ambiguousExpired??false}:null},recovery:{mode:'manual',automaticFailover:false,readiness:'Not proven until a full recovery drill passes.'}};
}

const schemas={
  platform:{database:'boolean',provider:['postgres','neon','unknown'],email:[true,false,null],files:[true,false,null],estimates:[true,false,null],jobs:'boolean',diskFreePercent:'number',memoryUsedPercent:'number',restarts:'number'},
  backup:{success:'boolean',copied:'boolean'},
  control:{neonPlan:['free','paid','unknown'],neonOffloaded:'boolean',neonVerifiedAt:'number',sourceQuiet:'boolean',restoreVerifiedAt:'number',offsiteVerified:'boolean',alertsConfigured:'boolean',credentialsReady:'boolean',ownerLoginVerified:'boolean',cutoverVerified:'boolean',backupUnattended:'boolean'}
};
export async function validateHeartbeat({kind,body,signature,secret,now=Date.now(),lastObservedAt=0}) {
  if(!schemas[kind]||typeof body!=='string'||new TextEncoder().encode(body).length>16384||!secret||secret.length<48||!/^[a-f0-9]{64}$/.test(signature??''))throw new Error('Invalid evidence.');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const bytes=Uint8Array.from(signature.match(/../g),x=>parseInt(x,16));
  if(!await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode('/heartbeat/'+kind+'\n'+body)))throw new Error('Invalid evidence.');
  const data=JSON.parse(body);
  if(!data||Object.keys(data).sort().join(',')!=='details,nonce,observedAt'||!Number.isSafeInteger(data.observedAt)||data.observedAt<=lastObservedAt||now-data.observedAt>90000||data.observedAt-now>30000||!/^[a-f0-9]{32}$/.test(data.nonce)||!data.details||Array.isArray(data.details))throw new Error('Invalid evidence.');
  for(const [key,value] of Object.entries(data.details)) {
    const rule=schemas[kind][key];
    if(!rule||(Array.isArray(rule)?!rule.includes(value):typeof value!==rule)||typeof value==='number'&&(!Number.isFinite(value)||value<0||value>Number.MAX_SAFE_INTEGER))throw new Error('Invalid evidence.');
  }
  return {observedAt:data.observedAt,details:data.details};
}

export const PROBES={storefront:'https://3dprint4.me/',operator:'https://work.3dprint4.me/',api:'https://3dprint4.me/api/health',auth:'https://api.github.com/'};
async function boundedText(response) {
  if(Number(response.headers.get('content-length'))>65536)throw new Error('Response bound.');
  const reader=response.body?.getReader();if(!reader)return '';
  let total=0;const chunks=[];
  try{for(;;){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>65536)throw new Error('Response bound.');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return new TextDecoder().decode(bytes);
}
export async function probeServices({now=Date.now(),fetchImpl=fetch}={}) {
  return Object.fromEntries(await Promise.all(Object.entries(PROBES).map(async([id,url])=>{
    let ok=false,provider,stage='request',httpStatus;
    try{
      const response=await fetchImpl(url,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(5000),headers:{'User-Agent':'3dprint4me-status/1'}});
      httpStatus=response.status;stage='http';
      if(response.ok){stage='body';const text=await boundedText(response);stage='validation';if(id==='api'){const data=JSON.parse(text);ok=data.ok===true&&data.service==='3dprint4.me';if(ok&&['neon','postgres'].includes(data.databaseProvider))provider=data.databaseProvider;}else ok=id==='auth'?JSON.parse(text).current_user_url==='https://api.github.com/user':id==='operator'?text.includes('id="auth-view"'):text.includes('3dprint4.me');}
    }catch{/* Only the safe failure stage is retained, never raw provider errors. */}
    return [id,{ok,checkedAt:now,...(provider?{provider}:{}),...(!ok?{stage,...(httpStatus?{httpStatus}:{})}:{})}];
  })));
}
export function updateProbeState(state,results,now) {
  const probes={};const incidents=[...(state.incidents??[])];
  for(const [id,value] of Object.entries(results)) {
    const previous=state.probes?.[id],failures=value.ok?0:(previous?.failures??0)+1,successes=value.ok?(previous?.successes??0)+1:0;
    const status=!value.ok?(failures>=2?'unavailable':'degraded'):previous?.status==='unavailable'&&successes<2?'degraded':'operational';
    probes[id]={...value,failures:Math.min(failures,100),successes:Math.min(successes,100),status};
    const open=incidents.find(x=>x.component===id&&!x.resolvedAt);
    if(status==='unavailable'&&!open)incidents.push({component:id,openedAt:now});
    if(status==='operational'&&open)open.resolvedAt=now;
  }
  return {...state,probes,checkedAt:now,incidents:incidents.slice(-20)};
}
