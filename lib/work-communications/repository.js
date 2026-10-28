import { getDatabase } from '../database.js';
import { HttpError } from '../http.js';
const iso=value=>value?new Date(value).toISOString():null;
const present=row=>row?{id:row.id,workId:row.work_item_id,operatorId:row.operator_id,commandId:row.command_id,fingerprint:row.fingerprint,kind:row.kind,body:row.body,recipient:row.recipient,subject:row.subject,envelope:row.envelope,state:row.state,author:row.author,createdAt:iso(row.created_at),firstAttemptAt:iso(row.first_attempt_at),lastAttemptAt:iso(row.last_attempt_at),claimId:row.claim_id}:null;
export function createCommunicationRepository({database=getDatabase()}={}) {
  const query=database.query.bind(database);
  return {
    async list(workId){return (await query`SELECT * FROM (SELECT * FROM work_communications WHERE work_item_id=${workId} ORDER BY created_at DESC,id DESC LIMIT 200) recent ORDER BY created_at,id`).map(present);},
    async find(workId,id){return present((await query`SELECT * FROM work_communications WHERE work_item_id=${workId} AND id=${id}`)[0]);},
    async create(input){
      const rows=await query`INSERT INTO work_communications(id,work_item_id,operator_id,command_id,fingerprint,kind,body,recipient,subject,envelope,state,author,created_at)
        VALUES(${input.id},${input.workId},${input.operatorId},${input.commandId},${input.fingerprint},${input.kind},${input.body},${input.recipient},${input.subject},${input.envelope?JSON.stringify(input.envelope):null}::jsonb,${input.state},${input.author},${input.createdAt}::timestamptz)
        ON CONFLICT(work_item_id,operator_id,command_id) DO NOTHING RETURNING *`;
      if(rows.length)return {...present(rows[0]),inserted:true};
      const row=present((await query`SELECT * FROM work_communications WHERE work_item_id=${input.workId} AND operator_id=${input.operatorId} AND command_id=${input.commandId}`)[0]);
      if(!row||row.fingerprint!==input.fingerprint)throw new HttpError(409,'That message command was already used for different content.');
      return {...row,inserted:false};
    },
    async claim(workId,id,{stamp,claimId,envelope,staleBefore}){return present((await query`UPDATE work_communications SET state='sending',claim_id=${claimId},envelope=CASE WHEN first_attempt_at IS NULL THEN ${JSON.stringify(envelope)}::jsonb ELSE envelope END,first_attempt_at=COALESCE(first_attempt_at,${stamp}::timestamptz),last_attempt_at=${stamp}::timestamptz
      WHERE work_item_id=${workId} AND id=${id} AND kind='email' AND state<>'sent' AND (first_attempt_at IS NULL OR first_attempt_at>${stamp}::timestamptz-interval '23 hours')
      AND (state<>'sending' OR last_attempt_at<=${staleBefore}::timestamptz) RETURNING *`)[0]);},
    async finish(workId,id,claimId,state,{resetFirstAttempt=false}={}){await query`UPDATE work_communications SET state=${state},claim_id=NULL,first_attempt_at=CASE WHEN ${resetFirstAttempt} THEN NULL ELSE first_attempt_at END WHERE work_item_id=${workId} AND id=${id} AND claim_id=${claimId}`;return this.find(workId,id);}
  };
}
