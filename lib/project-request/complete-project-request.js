import { HttpError } from '../http.js';

export function completeProjectRequestUseCase({
  normalizeRequest,
  normalizeFiles,
  validateId,
  issueCheckoutProof,
  getRuntime,
  parseAttachment = () => null,
  logFailure = operation => console.error(`Project request ${operation} failed.`)
}) {
  return async function completeProjectRequest(body) {
    const id = validateId(body?.id);
    const runtime = getRuntime();
    let request,files,attachment;
    const integrations = { database: false, email: false, webhook: false };
    let outboxId = null;
    let printEstimate = null;

    if(body?.handoffToken!==undefined){
      if(!runtime.inquiryWorkflow?.configured)throw new HttpError(503,'Inquiry project handoff is temporarily unavailable.');
      attachment=body?.request?.service==='print'?parseAttachment(body?.printEstimate):null;
      const result=await runtime.inquiryWorkflow.service.completeDraft({token:body.handoffToken,id,
        request:body.request,uploadedFiles:body.uploadedFiles,attachment});
      if(result.replayed)return {id,mode:runtime.mode,live:true,replayed:true,
        integrations:{database:true,email:false,webhook:false},checkoutToken:null};
      request=result.request;files=result.files;outboxId=result.outboxId;
      integrations.database=true;
      if(attachment)printEstimate={attached:Boolean(result.printEstimate?.attached)};
    }else{
      if(runtime.inquiryWorkflow?.configured)await runtime.inquiryWorkflow.service.assertRequestScope({id});
      request=normalizeRequest(body?.request);
      files=normalizeFiles(body?.uploadedFiles,id);
      attachment=request.service==='print'?parseAttachment(body?.printEstimate):null;
      printEstimate=attachment?{attached:false}:null;
      if (runtime.workPublisher) {
        const completed = await runtime.workPublisher.completeRequest(id, request, files, attachment);
        outboxId = completed?.outboxId ?? null;
        if (attachment) printEstimate = { attached: Boolean(completed?.printEstimate?.attached) };
        integrations.database = true;
      } else if (runtime.requestRepository) {
        await runtime.requestRepository.completeDraft(id, request, files);
        integrations.database = true;
      }
    }
    if (runtime.recorder) await runtime.recorder.record({ event: "complete", id, request, files });

    const [emailResult, webhookResult, pushResult] = await Promise.allSettled([
      runtime.emailNotifier?.notify(id, request, files) ?? { owner: false },
      runtime.webhookNotifier?.notify(id, request, files) ?? { delivered: false },
      runtime.pushTrigger?.trigger(outboxId)
    ]);
    if (emailResult.status === "fulfilled") integrations.email = Boolean(emailResult.value?.owner);
    else logFailure("email");
    if (webhookResult.status === "fulfilled") integrations.webhook = Boolean(webhookResult.value?.delivered);
    else logFailure("webhook");
    if (pushResult.status === "rejected") logFailure("push");

    const live = Object.values(integrations).some(Boolean);
    return {
      id,
      mode: runtime.mode,
      live,
      integrations,
      ...(printEstimate ? { printEstimate } : {}),
      checkoutToken: live ? issueCheckoutProof(id, request.contact.email, request.projectTitle) : null
    };
  };
}
