import { HttpError } from '../http.js';

export function createProjectRequestUseCase({ normalizeRequest, newRequestId, getRuntime }) {
  return async function createProjectRequest(body) {
    const id = newRequestId();
    if (body?.website) return { id, mode: "ignored", live: true };
    if(body?.handoffToken!==undefined){
      const runtime=getRuntime(),workflow=runtime.inquiryWorkflow;
      if(!workflow?.configured)throw new HttpError(503,'Inquiry project handoff is temporarily unavailable.');
      const draft=await workflow.service.createDraft({token:body.handoffToken,request:body.request});
      return {...draft,mode:runtime.mode,live:true};
    }
    const request = normalizeRequest(body?.request);
    const runtime = getRuntime();
    if (runtime.requestRepository) await runtime.requestRepository.createDraft(id, request);
    if (runtime.recorder) await runtime.recorder.record({ event: "create", id, request });
    return { id, mode: runtime.mode, live: Boolean(runtime.requestRepository) };
  };
}
