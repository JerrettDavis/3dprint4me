import { getDatabase } from '../database.js';
import { HttpError } from '../http.js';
import { fileListHash,preparedRequest,preparationHash } from './domain.js';

const terminal=new Set(['completed','declined','cancelled']);
const missing=()=>new HttpError(404,'The inquiry invitation was not found.');
const unavailable=()=>new HttpError(410,'This private invitation has expired, was replaced, or is no longer available.');

async function source(tx,id) {
  const [q]=await tx.query`SELECT * FROM quick_inquiries WHERE id=${id} FOR UPDATE`;
  if(!q||q.status!=='submitted')throw missing();
  const [work]=await tx.query`SELECT * FROM work_items WHERE inquiry_id=${id} FOR UPDATE`;
  if(!work)throw new HttpError(409,'Refresh the inquiry receipt before continuing.');
  const [project]=q.project_request_id?await tx.query`SELECT * FROM service_requests WHERE id=${q.project_request_id} FOR UPDATE`:[];
  return {inquiry:q,work,project:project??null,requestId:q.project_request_id,workId:work.id};
}
async function context(tx,tokenHash,now) {
  const [hint]=await tx.query`SELECT inquiry_id FROM inquiry_handoffs WHERE token_hash=${tokenHash}`;
  if(!hint)throw missing();
  const result=await source(tx,hint.inquiry_id);
  const [invite]=await tx.query`SELECT * FROM inquiry_handoffs WHERE token_hash=${tokenHash} FOR UPDATE`;
  if(!invite||invite.revoked_at||new Date(invite.expires_at).getTime()<=Date.parse(now))throw unavailable();
  if(!invite.consumed_at&&(terminal.has(result.work.status)||result.project?.status==='submitted'))throw unavailable();
  return {...result,consumed:Boolean(invite.consumed_at),handoff:invite};
}
async function assertOperator(tx,operator) {
  const [row]=await tx.query`SELECT id FROM operators WHERE id=${operator.id} AND enabled=true AND role IN ('owner','operator')`;
  if(!row)throw new HttpError(403,'An enabled operator is required.');
}
async function insertProject(tx,id,request,files) {
  await tx.query`INSERT INTO service_requests(id,status,service,project_title,contact_name,contact_email,payload,uploaded_files)
    VALUES(${id},'draft',${request.service},${request.projectTitle},${request.contact.name??''},${request.contact.email},
      ${JSON.stringify(request)}::jsonb,${JSON.stringify(files??[])}::jsonb)`;
}
async function updateProject(tx,id,request) {
  await tx.query`UPDATE service_requests SET service=${request.service},project_title=${request.projectTitle},
    contact_name=${request.contact.name},contact_email=${request.contact.email},payload=${JSON.stringify(request)}::jsonb,
    updated_at=now() WHERE id=${id} AND status='draft'`;
}
async function bind(tx,q,id) {
  await tx.query`UPDATE quick_inquiries SET project_request_id=${id} WHERE id=${q.id} AND project_request_id IS NULL`;
}
async function event(tx,work,type,actor,actorId,data) {
  const [row]=await tx.query`INSERT INTO work_events(work_item_id,request_id,event_type,actor_type,actor_id,data)
    VALUES(${work.id},${work.request_id},${type},${actor},${actorId},${JSON.stringify({version:1,...data})}::jsonb)
    RETURNING id`;
  return String(row.id);
}

/** All mutations lock the inquiry before its work/draft; no external I/O in a transaction. */
export function createInquiryWorkflowRepository({database=getDatabase()}={}) {
  const transaction=operation=>{
    if(typeof database.withTransaction!=='function')throw new HttpError(503,'Inquiry project handoff is unavailable on this database provider.');
    return database.withTransaction(operation);
  };
  return {
    async issue(input) {
      return transaction(async tx=>{
        await tx.query`SELECT pg_advisory_xact_lock(315031,3)`;
        if(input.operator)await assertOperator(tx,input.operator);
        let id=input.inquiryId;
        if(input.workId){const [hint]=await tx.query`SELECT inquiry_id FROM work_items WHERE id=${input.workId}`;id=hint?.inquiry_id;}
        if(!id)throw missing();
        const current=await source(tx,id);
        if(!input.operator&&current.inquiry.key_hash!==input.keyHash)throw missing();
        if(terminal.has(current.work.status)||current.project?.status==='submitted')throw new HttpError(409,'This work already has a completed request or is closed.');
        await tx.query`DELETE FROM inquiry_handoffs WHERE expires_at<${input.now}::timestamptz-interval '30 days'`;
        const [{count}]=await tx.query`SELECT count(*)::int AS count FROM inquiry_handoffs`;
        if(count>=10000)throw new HttpError(503,'Private invitation capacity is temporarily unavailable.');
        await tx.query`UPDATE inquiry_handoffs SET revoked_at=${input.now}::timestamptz
          WHERE inquiry_id=${id} AND revoked_at IS NULL AND consumed_at IS NULL`;
        await tx.query`INSERT INTO inquiry_handoffs(token_hash,inquiry_id,actor_type,operator_id,created_at,expires_at)
          VALUES(${input.tokenHash},${id},${input.operator?'operator':'customer'},${input.operator?.id??null},
            ${input.createdAt}::timestamptz,${input.expiresAt}::timestamptz)`;
      });
    },
    read:({tokenHash,now})=>transaction(tx=>context(tx,tokenHash,now)),
    async findRequestBinding(id) {
      const [row]=await database.query`SELECT id FROM quick_inquiries WHERE project_request_id=${id}`;
      return row?.id??null;
    },
    assertRequestScope:({id,tokenHash,now})=>transaction(async tx=>{
      const current=await context(tx,tokenHash,now);
      if(current.requestId!==id)throw new HttpError(403,'The invitation does not belong to this project.');
      if(current.consumed)throw new HttpError(410,'This invitation has already been completed.');
      return {bound:true,inquiryId:current.inquiry.id};
    }),
    prepareProject(input) {
      return transaction(async tx=>{
        await tx.query`SELECT pg_advisory_xact_lock(315031,4)`;
        await assertOperator(tx,input.operator);
        const [hint]=await tx.query`SELECT inquiry_id FROM work_items WHERE id=${input.workId}`;
        if(!hint?.inquiry_id)throw new HttpError(404,'An inquiry work item is required.');
        const current=await source(tx,hint.inquiry_id);
        const intentHash=preparationHash(input);
        const [previous]=await tx.query`SELECT result FROM work_actions WHERE operator_id=${input.operator.id} AND idempotency_key=${input.idempotencyKey}`;
        if(previous){
          if(previous.result?.action!=='prepare-inquiry'||previous.result.intentHash!==intentHash)throw new HttpError(409,'Use a new operation key for changed project details.');
          return previous.result.body;
        }
        if(Number(current.work.revision)!==input.revision)throw new HttpError(409,'Work changed before this project could be prepared.',{code:'revision_conflict',currentRevision:Number(current.work.revision)});
        if(terminal.has(current.work.status)||current.project?.status==='submitted')throw new HttpError(409,'This work already has a completed request or is closed.');
        if(current.work.kind==='request')return {workId:current.workId,requestId:current.requestId,projectDraft:true,existingDraft:true};
        const existingDraft=Boolean(current.project),id=current.requestId??input.newId;
        if(!existingDraft){
          await insertProject(tx,id,preparedRequest(current.inquiry.inquiry,input),current.inquiry.files);
          await bind(tx,current.inquiry,id);
        }
        const [work]=await tx.query`UPDATE work_items SET kind='request',request_id=${id},project_draft=true,
          status=CASE WHEN status='submitted' THEN 'triage' ELSE status END,revision=revision+1,updated_at=now()
          WHERE id=${input.workId} RETURNING *`;
        await event(tx,work,'work.converted','operator',input.operator.id,{source:'inquiry',operatorPrepared:true,existingDraft});
        const body={workId:work.id,requestId:id,projectDraft:true,existingDraft};
        await tx.query`INSERT INTO work_actions(operator_id,idempotency_key,work_item_id,result)
          VALUES(${input.operator.id},${input.idempotencyKey},${work.id},${JSON.stringify({action:'prepare-inquiry',intentHash,body})}::jsonb)`;
        return body;
      });
    },
    createDraft(input) {
      return transaction(async tx=>{
        const current=await context(tx,input.tokenHash,input.now);
        if(current.consumed)return {id:current.requestId,completed:true};
        const id=current.requestId??input.newId;
        if(!current.project){await insertProject(tx,id,input.request,current.inquiry.files);await bind(tx,current.inquiry,id);}
        else await updateProject(tx,id,input.request);
        return {id};
      });
    },
    completeDraft(input) {
      return transaction(async tx=>{
        const current=await context(tx,input.tokenHash,input.now);
        if(current.requestId!==input.id)throw new HttpError(403,'The invitation does not belong to this project.');
        if(current.consumed)return {id:input.id,workId:current.workId,replayed:true,outboxId:null};
        if(!current.project||current.project.status!=='draft')throw new HttpError(409,'This project draft cannot be completed.');
        if(fileListHash(current.inquiry.files)!==input.verifiedSourceHash)throw new HttpError(409,'The inquiry attachments changed. Review them before continuing.');
        await updateProject(tx,input.id,input.request);
        await tx.query`UPDATE service_requests SET status='submitted',uploaded_files=${JSON.stringify(input.files)}::jsonb,
          submitted_at=COALESCE(submitted_at,now()),updated_at=now() WHERE id=${input.id} AND status='draft'`;
        const [work]=await tx.query`UPDATE work_items SET kind='request',request_id=${input.id},project_draft=false,
          revision=revision+1,updated_at=now() WHERE id=${current.workId} RETURNING *`;
        const eventId=await event(tx,work,current.work.kind==='inquiry'?'work.converted':'work.request_submitted','customer',null,{source:'inquiry',operatorPrepared:false});
        const [outbox]=await tx.query`INSERT INTO notification_outbox(event_id,kind,payload)
          VALUES(${eventId}::bigint,'new_work',jsonb_build_object('version',1,'eventId',${eventId}::text,
            'workId',${work.id}::text,'route',${'/work/'+work.id}::text)) RETURNING id`;
        await tx.query`UPDATE inquiry_handoffs SET consumed_at=${input.now}::timestamptz WHERE token_hash=${input.tokenHash}`;
        let attached=false;
        if(input.attachment){
          const {sessionId,ownershipHash}=input.attachment;
          const sessions=await tx.query`UPDATE print_estimate_sessions SET request_id=${input.id},state='attached',attached_at=now(),updated_at=now()
            WHERE id=${sessionId} AND ownership_hash=${ownershipHash} AND state='open' AND expires_at>now() AND request_id IS NULL RETURNING id`;
          attached=sessions.length===1;
          if(attached){
            await tx.query`UPDATE print_assets SET request_id=${input.id},retention_expires_at=NULL,updated_at=now()
              WHERE estimate_session_id=${sessionId} AND state IN ('uploaded','ready','failed') AND (parent_asset_id IS NULL OR selected=true)`;
            await tx.query`UPDATE print_estimates SET request_id=${input.id} WHERE estimate_session_id=${sessionId} AND request_id IS NULL`;
          }
        }
        return {id:input.id,workId:work.id,replayed:false,outboxId:String(outbox.id),printEstimate:{attached}};
      });
    }
  };
}
