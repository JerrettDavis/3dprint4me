import { HttpError } from '../http.js';
import { preparedRequest,preparationHash,fileListHash } from './domain.js';

const terminal=new Set(['completed','declined','cancelled']);
const missing=()=>new HttpError(404,'The inquiry invitation was not found.');
const unavailable=()=>new HttpError(410,'This private invitation has expired, was replaced, or is no longer available.');
function source(state,id) {
  const inquiry=state.inquiries.find(q=>q.id===id),work=state.workItems.find(w=>w.inquiryId===id);
  if(!inquiry||inquiry.status!=='submitted')throw missing();
  if(!work)throw new HttpError(409,'Refresh the inquiry receipt before continuing.');
  const record=state.requests.find(r=>r.id===inquiry.project_request_id);
  const project=record?{id:record.id,status:record.status,project_title:record.request.projectTitle,service:record.request.service}:null;
  return {inquiry,work:{...work,project_draft:work.projectDraft},project,record,workId:work.id,requestId:inquiry.project_request_id??null};
}
function context(state,tokenHash,now) {
  const invite=state.handoffs.find(h=>h.token_hash===tokenHash);
  if(!invite)throw missing();
  if(invite.revoked_at||Date.parse(invite.expires_at)<=Date.parse(now))throw unavailable();
  const current=source(state,invite.inquiry_id);
  if(!invite.consumed_at&&(terminal.has(current.work.status)||current.project?.status==='submitted'))throw unavailable();
  return {...current,handoff:invite,consumed:Boolean(invite.consumed_at)};
}
function assertOperator(operator) {
  if(operator.id!=='op_local_owner'||operator.enabled===false)throw new HttpError(403,'An enabled local operator is required.');
}
function addEvent(state,item,type,actorType,actorId,data,now) {
  const event={id:String(state.events.length+1),workItemId:item.id,requestId:item.requestId,type,
    actorType,actorId,data:{version:1,...data},occurredAt:now};
  state.events.push(event);return event;
}
function insertProject(state,q,id,request,now) {
  const record={id,request:structuredClone(request),files:structuredClone(q.files??[]),status:'draft',submittedAt:null,createdAt:now};
  state.requests.push(record);q.project_request_id=id;return record;
}

/** Same use-case contract as native PostgreSQL; single-process loopback development only. */
export function createLocalInquiryWorkflowRepository({work}) {
  return {
    issue:input=>work.inquiryTransaction(state=>{
      if(input.operator)assertOperator(input.operator);
      const id=input.inquiryId??state.workItems.find(x=>x.id===input.workId)?.inquiryId;
      const current=source(state,id);
      if(!input.operator&&current.inquiry.key_hash!==input.keyHash)throw missing();
      if(terminal.has(current.work.status)||current.project?.status==='submitted')throw new HttpError(409,'This work already has a completed request or is closed.');
      state.handoffs=state.handoffs.filter(h=>Date.parse(h.expires_at)>=Date.parse(input.now)-30*86400000);
      if(state.handoffs.length>=10000)throw new HttpError(503,'Private invitation capacity is temporarily unavailable.');
      for(const h of state.handoffs)if(h.inquiry_id===id&&!h.revoked_at&&!h.consumed_at)h.revoked_at=input.now;
      state.handoffs.push({token_hash:input.tokenHash,inquiry_id:id,actor_type:input.operator?'operator':'customer',
        operator_id:input.operator?.id??null,created_at:input.createdAt,expires_at:input.expiresAt,revoked_at:null,consumed_at:null});
    }),
    read:async({tokenHash,now})=>context(await work.snapshot(),tokenHash,now),
    findRequestBinding:async id=>(await work.snapshot()).inquiries.find(q=>q.project_request_id===id)?.id??null,
    assertRequestScope:async({id,tokenHash,now})=>{
      const current=context(await work.snapshot(),tokenHash,now);
      if(current.requestId!==id)throw new HttpError(403,'The invitation does not belong to this project.');
      if(current.consumed)throw new HttpError(410,'This invitation has already been completed.');
      return {bound:true,inquiryId:current.inquiry.id};
    },
    prepareProject:input=>work.inquiryTransaction(state=>{
      assertOperator(input.operator);
      const hint=state.workItems.find(x=>x.id===input.workId);
      if(!hint?.inquiryId)throw new HttpError(404,'An inquiry work item is required.');
      const current=source(state,hint.inquiryId),intentHash=preparationHash(input);
      const previous=state.actions.find(x=>x.operatorId===input.operator.id&&x.key===input.idempotencyKey);
      if(previous){
        if(previous.result?.action!=='prepare-inquiry'||previous.result.intentHash!==intentHash)throw new HttpError(409,'Use a new operation key for changed project details.');
        return previous.result.body;
      }
      if(current.work.revision!==input.revision)throw new HttpError(409,'Work changed before this project could be prepared.',{code:'revision_conflict',currentRevision:current.work.revision});
      if(terminal.has(current.work.status)||current.project?.status==='submitted')throw new HttpError(409,'This work already has a completed request or is closed.');
      if(hint.kind==='request')return {workId:hint.id,requestId:hint.requestId,projectDraft:true,existingDraft:true};
      const existingDraft=Boolean(current.record),id=current.requestId??input.newId;
      if(!existingDraft)insertProject(state,current.inquiry,id,preparedRequest(current.inquiry.inquiry,input),input.now);
      Object.assign(hint,{kind:'request',requestId:id,projectDraft:true,
        status:hint.status==='submitted'?'triage':hint.status,revision:hint.revision+1,updatedAt:input.now});
      addEvent(state,hint,'work.converted','operator',input.operator.id,{source:'inquiry',operatorPrepared:true,existingDraft},input.now);
      const body={workId:hint.id,requestId:id,projectDraft:true,existingDraft};
      state.actions.push({operatorId:input.operator.id,key:input.idempotencyKey,workItemId:hint.id,
        result:{action:'prepare-inquiry',intentHash,body},createdAt:input.now});return body;
    }),
    createDraft:input=>work.inquiryTransaction(state=>{
      const current=context(state,input.tokenHash,input.now);
      if(current.consumed)return {id:current.requestId,completed:true};
      const id=current.requestId??input.newId;
      if(!current.record)insertProject(state,current.inquiry,id,input.request,input.now);
      else current.record.request=structuredClone(input.request);
      return {id};
    }),
    completeDraft:input=>work.inquiryTransaction(state=>{
      const current=context(state,input.tokenHash,input.now);
      if(current.requestId!==input.id)throw new HttpError(403,'The invitation does not belong to this project.');
      if(current.consumed)return {id:input.id,workId:current.workId,replayed:true,outboxId:null};
      if(!current.record||current.record.status!=='draft')throw new HttpError(409,'This project draft cannot be completed.');
      if(fileListHash(current.inquiry.files)!==input.verifiedSourceHash)throw new HttpError(409,'The inquiry attachments changed. Review them before continuing.');
      Object.assign(current.record,{status:'submitted',request:structuredClone(input.request),files:structuredClone(input.files),submittedAt:input.now});
      const item=state.workItems.find(x=>x.id===current.workId),wasInquiry=item.kind==='inquiry';
      Object.assign(item,{kind:'request',requestId:input.id,projectDraft:false,revision:item.revision+1,updatedAt:input.now});
      const event=addEvent(state,item,wasInquiry?'work.converted':'work.request_submitted','customer',null,
        {source:'inquiry',operatorPrepared:false},input.now);
      const outbox={id:String(state.outbox.length+1),eventId:event.id,kind:'new_work',
        payload:{version:1,eventId:event.id,workId:item.id,route:'/work/'+item.id},state:'pending',
        attemptCount:0,nextAttemptAt:input.now,createdAt:input.now,updatedAt:input.now};
      state.outbox.push(outbox);current.handoff.consumed_at=input.now;
      return {id:input.id,workId:item.id,replayed:false,outboxId:outbox.id,printEstimate:{attached:false}};
    })
  };
}
