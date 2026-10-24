import { randomUUID } from 'node:crypto';
import { HttpError } from '../http.js';
import { invalidateOwnExports } from './export-retention.js';
import { uuid,integer,iso } from './validation.js';
const view=r=>({id:r.id,startedAt:iso(r.started_at),endedAt:iso(r.ended_at)??null,pausedAt:iso(r.paused_at)??null,runningSince:iso(r.running_since)??null,elapsedSeconds:r.elapsed_seconds,revision:r.revision,optional:true});
export function activityCommands({repo,now}){
 const commands={
  'activity.start':{role:'PARTNER',fields:[],run:async(tx,input,actor)=>{
   const id=randomUUID(),time=now().toISOString();
   const [row]=await tx.query`INSERT INTO partner_activity_sessions(id,partner_id,started_at,running_since) VALUES(${id},${actor.id},${time},${time}) ON CONFLICT DO NOTHING RETURNING *`;
   if(!row)throw new HttpError(409,'You already have an open optional activity record.');
   const [account]=await tx.query`SELECT program_id FROM partner_accounts WHERE id=${actor.id}`;
   await repo.audit(tx,{programId:account.program_id,actor,action:'activity.started',entityKind:'activity',entityId:id});return view(row);
  }}
 };
 for(const action of ['pause','resume','stop','delete'])commands['activity.'+action]={role:'PARTNER',fields:['activityId','expectedRevision'],run:async(tx,input,actor)=>{
  const [row]=await tx.query`SELECT * FROM partner_activity_sessions WHERE id=${uuid(input.activityId)} AND partner_id=${actor.id} FOR UPDATE`;
  if(!row)throw new HttpError(404,'Activity record not found.');
  if(row.revision!==integer(input.expectedRevision,1,2147483647)||(row.ended_at&&action!=='delete')||(action==='pause'&&!row.running_since)||(action==='resume'&&row.running_since))throw new HttpError(409,'This optional activity record has changed.');
  const [account]=await tx.query`SELECT program_id FROM partner_accounts WHERE id=${actor.id}`;
  if(action==='delete'){await invalidateOwnExports(tx,actor.id,now());await tx.query`DELETE FROM partner_activity_sessions WHERE id=${row.id} AND partner_id=${actor.id}`;await repo.audit(tx,{programId:account.program_id,actor,action:'activity.deleted',entityKind:'activity',entityId:row.id});return {id:row.id,deleted:true};}
  const time=now().toISOString(),elapsed=row.elapsed_seconds+(row.running_since?Math.max(0,Math.floor((now()-new Date(row.running_since))/1000)):0);
  const [updated]=await tx.query`UPDATE partner_activity_sessions SET elapsed_seconds=${elapsed},running_since=${action==='resume'?time:null},paused_at=${action==='pause'?time:null},ended_at=${action==='stop'?time:null},revision=revision+1 WHERE id=${row.id} RETURNING *`;
  await repo.audit(tx,{programId:account.program_id,actor,action:'activity.'+action,entityKind:'activity',entityId:row.id});return view(updated);
 }};
 return commands;
}
export async function readActivity(tx,actor){
 if(actor.role!=='PARTNER')throw new HttpError(403,'Optional activity records belong to the partner.');
 return {items:(await tx.query`SELECT * FROM partner_activity_sessions WHERE partner_id=${actor.id} ORDER BY started_at DESC,id LIMIT 1000`).map(view)};
}
