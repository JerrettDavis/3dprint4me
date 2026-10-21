import { HttpError } from '../http.js';
import { validateSubmissionKey } from '../inquiry-validation.js';
import { normalizeProjectRequest,normalizeUploadedFiles,validateRequestId } from '../validation.js';
import { signRequestFile } from '../operator-files.js';
import { newProjectRequestId } from '../project-request/identity.js';
import { HANDOFF_TTL_MS,newHandoffToken,handoffHash,fileListHash,inquiryId,workId,
  enabledOperator,projectPreparation,safePrefill,assertInquiryFiles } from './domain.js';

export function createInquiryWorkflowService({repository,now=()=>new Date(),randomToken=newHandoffToken,
  newRequestId=newProjectRequestId,verifyFiles=async files=>{if(files.length)throw new HttpError(503,'Private attachments are unavailable.');},sign,
  storefrontOrigin='https://3dprint4.me'}={}) {
  const origin=new URL(storefrontOrigin);
  if(origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash
    ||!(origin.origin==='https://3dprint4.me'||origin.protocol==='http:'&&['127.0.0.1','localhost'].includes(origin.hostname)))
    throw new HttpError(503,'The inquiry invitation origin is unavailable.');
  const digest=token=>handoffHash(token);
  async function issue(authority) {
    const token=randomToken(),createdAt=now().toISOString(),expiresAt=new Date(Date.parse(createdAt)+HANDOFF_TTL_MS).toISOString();
    await repository.issue({...authority,tokenHash:digest(token),createdAt,expiresAt,now:createdAt});
    return {token,url:origin.origin+'/order.html#inquiry='+token,expiresAt};
  }
  function normalizeForInquiry(request,context) {
    const inherited=(context.inquiry.files??[]).map(({name,size,type})=>({name,size,type}));
    const selected=Array.isArray(request?.files)?request.files:[];
    if(inherited.length+selected.length>8)throw new HttpError(400,'Attach no more than eight files in total.');
    return normalizeProjectRequest({...request,files:[...inherited,...selected]});
  }
  return {
    issueForCustomer:async({id,submissionKey})=>issue({inquiryId:inquiryId(id),keyHash:validateSubmissionKey(submissionKey)}),
    issueForOperator:async({workId:id,operator})=>issue({workId:workId(id),operator:enabledOperator(operator)}),
    async read({token}) {return safePrefill(await repository.read({tokenHash:digest(token),now:now().toISOString()}));},
    async download({token,index}) {
      const context=await repository.read({tokenHash:digest(token),now:now().toISOString()});
      if(context.consumed)throw new HttpError(410,'This invitation has already been completed.');
      return signRequestFile({work:{item:{kind:'inquiry',inquiryId:context.inquiry.id},files:context.inquiry.files??[]},index,sign});
    },
    async prepareProject(input) {return repository.prepareProject({...projectPreparation(input),newId:newRequestId(),now:now().toISOString()});},
    async createDraft({token,request}) {
      const tokenHash=digest(token),stamp=now().toISOString(),context=await repository.read({tokenHash,now:stamp});
      if(context.consumed)return {id:context.requestId,completed:true};
      return repository.createDraft({tokenHash,now:stamp,newId:newRequestId(),request:normalizeForInquiry(request,context)});
    },
    async assertRequestScope({id,token}) {
      validateRequestId(id);
      const bound=await repository.findRequestBinding(id);
      if(!bound){if(token)throw new HttpError(403,'The invitation does not belong to this project.');return {bound:false};}
      if(!token)throw new HttpError(403,'Use the private inquiry invitation to continue this project.');
      return repository.assertRequestScope({id,tokenHash:digest(token),now:now().toISOString()});
    },
    async completeDraft({token,id,request,uploadedFiles=[],attachment=null}) {
      validateRequestId(id);
      const tokenHash=digest(token),context=await repository.read({tokenHash,now:now().toISOString()});
      if(context.consumed){
        if(context.requestId!==id)throw new HttpError(404,'The invitation does not belong to this project.');
        return {id,workId:context.workId,replayed:true,outboxId:null};
      }
      if(!Array.isArray(uploadedFiles)||uploadedFiles.length>8)throw new HttpError(400,'Attach no more than eight files in total.');
      const newFiles=normalizeUploadedFiles(uploadedFiles,id),inherited=context.inquiry.files??[];
      assertInquiryFiles(inherited,context.inquiry.id);
      if(newFiles.length+inherited.length>8)throw new HttpError(400,'Attach no more than eight files in total.');
      const normalized=normalizeForInquiry(request,context),files=[...inherited,...newFiles];
      await verifyFiles(files.filter(file=>file.path&&file.mode!=='estimate'));
      const result=await repository.completeDraft({id,tokenHash,now:now().toISOString(),request:normalized,files,
        verifiedSourceHash:fileListHash(inherited),attachment});
      return {...result,...(!result.replayed?{request:normalized,files}:{})};
    }
  };
}
