import { createHash,randomBytes } from 'node:crypto';
import { HttpError } from '../http.js';

export const HANDOFF_TTL_MS=7*86400000;
export const newHandoffToken=()=>randomBytes(32).toString('hex');
export function handoffHash(value) {
  if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw new HttpError(400,'A valid private inquiry invitation is required.');
  return createHash('sha256').update('inquiry-handoff-v1\n'+value).digest('hex');
}
export const fileListHash=files=>createHash('sha256').update(JSON.stringify(files??[])).digest('hex');
export function assertInquiryFiles(files,id) {
  for(const file of files){
    const path=typeof file.path==='string'?file.path:'';
    if(!path.startsWith(`inquiries/${id}/`)||path.includes('\\')||path.includes('//')
      ||path.split('/').some(part=>part==='.'||part==='..')||file.mode==='estimate')
      throw new HttpError(409,'An inquiry attachment is not available for this project.');
  }
}
export const preparationHash=input=>createHash('sha256').update(JSON.stringify([input.workId,input.revision,input.service,input.title])).digest('hex');
export function inquiryId(value) {
  if(typeof value!=='string'||!/^INQ-[A-Za-z0-9_-]{8,80}$/.test(value))throw new HttpError(400,'A valid inquiry reference is required.');
  return value;
}
export function workId(value) {
  if(typeof value!=='string'||!/^work_[A-Za-z0-9_-]{8,123}$/.test(value))throw new HttpError(400,'A valid work reference is required.');
  return value;
}
export function enabledOperator(operator) {
  if(!operator?.id||operator.enabled===false||!['owner','operator'].includes(operator.role))throw new HttpError(403,'An enabled operator is required.');
  return operator;
}
export function projectPreparation(value) {
  const title=typeof value.title==='string'?value.title.trim():'';
  if(!title||title.length>120||!['print','design','repair','consult'].includes(value.service)
    ||!Number.isSafeInteger(value.revision)||value.revision<1
    ||typeof value.idempotencyKey!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(value.idempotencyKey))
    throw new HttpError(400,'Choose a service and project title for the current work revision.');
  return {workId:workId(value.workId),title,service:value.service,revision:value.revision,
    idempotencyKey:value.idempotencyKey,operator:enabledOperator(value.operator)};
}
export function preparedRequest(inquiry,{service,title}) {
  return {projectTitle:title,service,description:inquiry.message??'',
    modelUrl:inquiry.referenceUrl??null,contact:{name:inquiry.name??'',email:inquiry.replyEmail},
    files:[],estimate:null,consent:false,source:'operator-prepared-inquiry'};
}
export function safePrefill(context) {
  if(context.consumed)return {completed:true,id:context.requestId};
  const q=context.inquiry;
  return {inquiryId:q.id,inquiry:{name:q.inquiry.name??'',replyEmail:q.inquiry.replyEmail,
    message:q.inquiry.message??'',referenceUrl:q.inquiry.referenceUrl??'',intent:q.inquiry.intent??'unknown'},
    files:(q.files??[]).map((file,index)=>({index,name:file.name,size:file.size,type:file.type})),
    ...(context.project ? {project:{id:context.project.id,title:context.project.project_title,
      service:context.project.service,operatorPrepared:context.work.project_draft}} : {})};
}
