import { createOperatorApiHandler } from '../operator-api.js';
import { HttpError,readJson } from '../http.js';
import { createInquiryWorkflowRuntime } from './runtime.js';

function exact(value,fields) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!fields.includes(k)))
    throw new HttpError(400,'A supported inquiry work action is required.');
}
export function createOperatorInquiryWorkflowHandler({authorize,allowedOrigins,getRuntime=createInquiryWorkflowRuntime}={}) {
  return createOperatorApiHandler({methods:['POST'],authorize,allowedOrigins,handle:async({req,operator})=>{
    const url=new URL(req.url??'/api/operator-work?resource=inquiries','https://operator-api.invalid');
    if([...url.searchParams.keys()].some(k=>k!=='resource'))throw new HttpError(400,'Unsupported inquiry work query.');
    const body=await readJson(req,8192);
    if(Buffer.byteLength(JSON.stringify(body))>8192)throw new HttpError(413,'Request body is too large.');
    if(body?.action==='invite')exact(body,['action','workId']);
    else if(body?.action==='prepare'){exact(body,['action','command']);exact(body.command,['workId','revision','service','title']);}
    else throw new HttpError(400,'A supported inquiry work action is required.');
    const runtime=getRuntime();
    if(!runtime.configured)throw new HttpError(503,'Inquiry project handoff is temporarily unavailable.');
    if(body.action==='invite')return runtime.service.issueForOperator({workId:body.workId,operator});
    return runtime.service.prepareProject({...body.command,operator,idempotencyKey:req.headers?.['idempotency-key']});
  }});
}
