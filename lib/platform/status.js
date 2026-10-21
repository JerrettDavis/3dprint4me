import { queryDatabase } from '../database.js';
import { readJobHealth } from './job-health.js';

export async function collectPlatformStatus({query=queryDatabase,env=process.env,health=readJobHealth}={}) {
  let database=false;
  try{await query`SELECT id FROM operators LIMIT 1`;database=true;}catch{/* No database diagnostics in evidence. */}
  let queueHealthy=false;
  if(database)try {
    const [queue]=await query`SELECT NOT (
      EXISTS(SELECT 1 FROM notification_outbox WHERE state='failed' OR state='pending' AND next_attempt_at<now()-interval '5 minutes' OR state='processing' AND lease_expires_at<now()-interval '5 minutes')
      OR EXISTS(SELECT 1 FROM print_analysis_jobs WHERE state='failed' OR state='pending' AND next_attempt_at<now()-interval '15 minutes' OR state='processing' AND lease_expires_at<now()-interval '15 minutes')
    ) AS healthy`;
    queueHealthy=queue?.healthy===true;
  }catch{/* Unknown queue progress remains unhealthy. */}
  const states=await Promise.all([['push',120000],['expiry',180000],['cleanup',7*3600000],['slicer',720000]].map(([name,maxAge])=>health(name,{directory:'/run/platform-health/'+(name==='slicer'?'slicer':'jobs'),maxAge})));
  const files=Boolean(env.BLOB_READ_WRITE_TOKEN||env.SUPABASE_URL&&env.SUPABASE_SERVICE_ROLE_KEY);
  return {database,provider:env.DATABASE_DRIVER==='postgres'?'postgres':env.DATABASE_DRIVER==='neon'||!env.DATABASE_DRIVER?'neon':'unknown',
    // Configuration proves availability prerequisites, never provider health.
    // Keep capabilities unknown until an independent functional check exists.
    files:files?null:false,email:env.RESEND_API_KEY&&env.REQUEST_TO_EMAIL&&env.REQUEST_FROM_EMAIL?null:false,
    estimates:database&&files&&env.SLICER_PROVIDER&&states[3].ok?null:false,jobs:queueHealthy&&states.every(x=>x.ok)};
}
