import { createHmac } from 'node:crypto';
import { handleApiError,HttpError,readJson,requireMethod,sendJson } from '../http.js';
import { clientAddress } from '../print-estimation/application/rate-limit.js';
import { createInquiryWorkflowRuntime } from './runtime.js';

function exact(body,fields) {
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!fields.includes(k)))
    throw new HttpError(400,'A supported inquiry invitation action is required.');
}
export function createPublicInquiryWorkflowHandler({getRuntime=createInquiryWorkflowRuntime}={}) {
  return async(req,res)=>{
    try {
      requireMethod(req,'POST');
      const url=new URL(req.url??'/api/inquiry?kind=handoff','https://3dprint4.me');
      if([...url.searchParams.keys()].some(k=>k!=='kind'))throw new HttpError(400,'Unsupported invitation query.');
      const body=await readJson(req,32768);
      if(Buffer.byteLength(JSON.stringify(body))>32768)throw new HttpError(413,'Request body is too large.');
      const actions={issue:['action','id','submissionKey'],read:['action','token'],file:['action','token','index']};
      const fields=Object.hasOwn(actions,body?.action)?actions[body.action]:null;
      if(!fields)throw new HttpError(400,'A supported inquiry invitation action is required.');
      exact(body,fields);
      if(body.action==='read'&&typeof body.token!=='string')throw new HttpError(400,'A private inquiry invitation is required.');
      if(body.action==='issue'&&(typeof body.id!=='string'||typeof body.submissionKey!=='string'))throw new HttpError(400,'The inquiry submission capability is required.');
      const runtime=getRuntime();
      if(!runtime.configured)throw new HttpError(503,'Inquiry project handoff is temporarily unavailable.');
      if(body.action==='issue'&&runtime.actionsEnabled===false)throw new HttpError(503,'New inquiry invitations are temporarily unavailable.');
      const rateKey=createHmac('sha256',process.env.DATABASE_URL||'development-inquiry-workflow').update(clientAddress(req)).digest('hex');
      await runtime.rate?.(rateKey);
      let result;
      if(body.action==='issue')result=await runtime.service.issueForCustomer({id:body.id,submissionKey:body.submissionKey});
      else if(body.action==='read')result=await runtime.service.read({token:body.token});
      else result=await runtime.service.download({token:body.token,index:body.index});
      sendJson(res,200,result);
    }catch(error){handleApiError(res,error instanceof HttpError?error:new HttpError(503,'Inquiry project handoff is temporarily unavailable.'));}
  };
}
export default createPublicInquiryWorkflowHandler();
