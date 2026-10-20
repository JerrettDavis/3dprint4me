import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { closeDatabase, queryDatabase as sql } from '../lib/database.js';
import { createPlatformJobs } from '../lib/platform/jobs.js';
import { createNeonWorkStore } from '../lib/work-store.js';
import { createWebPushTransport, drainPushOutbox } from '../lib/push-delivery.js';
import { runMaintenance } from './print-estimate-maintenance.mjs';

if(process.env.DATABASE_DRIVER!=='postgres'||process.env.PLATFORM_JOBS_ENABLED!=='1')throw new Error('Local jobs require an explicit native database writer handover.');
const workerId=randomUUID(),store=createNeonWorkStore(),transport=createWebPushTransport();
async function leased(name,operation) {
  const claim=await sql`INSERT INTO platform_job_leases(name,worker_id,expires_at) VALUES(${name},${workerId},now()+interval '30 minutes')
    ON CONFLICT(name) DO UPDATE SET worker_id=EXCLUDED.worker_id,expires_at=EXCLUDED.expires_at
    WHERE platform_job_leases.expires_at<now() RETURNING name`;
  if(!claim.length)return;
  try{await operation();}finally{await sql`DELETE FROM platform_job_leases WHERE name=${name} AND worker_id=${workerId}`;}
}
const jobs=createPlatformJobs({
  drain:()=>drainPushOutbox({store,transport,workerId,batchSize:20}),
  cleanup:()=>leased('model-retention',()=>runMaintenance([])),
  expire:()=>leased('auth-expiry',async()=>{
    await sql`DELETE FROM platform_proxy_nonces WHERE expires_at<now()`;
    await sql`DELETE FROM operator_login_flows WHERE expires_at<now()`;
    await sql`DELETE FROM operator_sessions WHERE expires_at<now()`;
  }),
  onError:name=>console.error(`Scheduled ${name} operation unavailable.`)
});
const controller=new AbortController();
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>controller.abort());
try{while(!controller.signal.aborted){await jobs.tick();await sleep(1000,undefined,{signal:controller.signal}).catch(()=>{});}}
finally{await closeDatabase();}
