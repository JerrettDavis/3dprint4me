// Private stdin/checkpoint stdout protocol. The host captures every line to an
// owner-only file; this script is never an HTTP endpoint or public CLI output.
import { createControlStore } from '../lib/platform/control-store.js';
import { createDatabaseActivation } from '../lib/platform/activation.js';
import { closeDatabase,queryDatabase } from '../lib/database.js';
import { createPrintEstimationRuntime } from '../lib/print-estimation/runtime.js';
import { sendReceiptTransport } from '../lib/notifications.js';
import { initialFunctionalState,runFunctionalProbe } from '../lib/platform/functional-probe.js';
import {readFile} from 'node:fs/promises';
import {collectPlatformStatus} from '../lib/platform/status.js';
let control;
try{
 let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>32768)throw Error('State bound');}
 const data=JSON.parse(input),state=data.state??initialFunctionalState();
 if(state.version!==1)throw Error('State version');
 control=createControlStore();await createDatabaseActivation({getSelection:control.getSelection,persistSelection:control.persistSelection}).bootstrap();
 if(process.env.DATABASE_DRIVER!=='postgres')throw Error('Native target required');
 const runtime=createPrintEstimationRuntime();
 const checkpoint=async state=>{process.stdout.write(JSON.stringify(state)+'\n');};
 await runFunctionalProbe(state,{...runtime,checkpoint,emailEnabled:data.emailEnabled===true,mailTransport:async envelope=>{
  const response=await sendReceiptTransport(envelope);
  if(!response.ok){await response.body?.cancel();throw Error('Acceptance unavailable');}
  const reader=response.body?.getReader();let text='';if(!reader)throw Error('Missing acceptance');
  try{for(;;){const {done,value}=await reader.read();if(done)break;text+=new TextDecoder().decode(value);if(text.length>4096)throw Error('Acceptance bound');}}
  finally{await reader.cancel().catch(()=>{});}
  return {accepted:true,id:JSON.parse(text).id};
 }});
 // Restart preconditions are current database facts, never inferred from a
 // Docker running flag. Only timestamps/service names leave through this line.
 const [row]=await queryDatabase`SELECT NOT EXISTS(SELECT 1 FROM platform_job_leases WHERE expires_at>now()) AS no_leases,
  NOT EXISTS(SELECT 1 FROM print_analysis_jobs WHERE state='processing' AND lease_expires_at>now()) AS no_slice_leases`;
 const statusResponse=await fetch('http://127.0.0.1:8080/internal/handover/status',{headers:{Authorization:'Bearer '+process.env.PLATFORM_PROXY_SECRET},redirect:'manual',signal:AbortSignal.timeout(5000)});
 const status=statusResponse.ok?await statusResponse.json():{};
 const staleServices=[];
 for(const [name,directory,maxAge,service] of [['push','jobs',180000,'jobs'],['statements','jobs',180000,'jobs'],['slicer','slicer',720000,'slicer']]) {
  try{
   const text=await readFile('/run/platform-health/'+directory+'/'+name+'.json','utf8');
   if(text.length>512)continue;
   const health=JSON.parse(text);
   if(health.name===name&&Number.isSafeInteger(health.observedAt)&&Date.now()-health.observedAt>maxAge&&!staleServices.includes(service))staleServices.push(service);
  }catch{/* Missing or unreadable evidence is not permission to restart. */}
 }
 const platform=await collectPlatformStatus();
 process.stdout.write(JSON.stringify({repairSafety:{database:true,unpaused:status.paused===false&&status.switching===false,noLeases:row?.no_leases===true,noSliceLeases:row?.no_slice_leases===true,staleServices,healthyServices:platform.jobs===true?['jobs','slicer']:[]}})+'\n');
}catch{process.stderr.write('Functional verification unavailable; private diagnostics suppressed.\n');process.exitCode=1;}
finally{await Promise.all([closeDatabase(),control?.close()]);}
