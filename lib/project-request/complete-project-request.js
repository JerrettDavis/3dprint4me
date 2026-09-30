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
    const request = normalizeRequest(body?.request);
    const files = normalizeFiles(body?.uploadedFiles, id);
    const attachment = request.service === "print" ? parseAttachment(body?.printEstimate) : null;
    const runtime = getRuntime();
    const integrations = { database: false, email: false, webhook: false };
    let outboxId = null;
    let printEstimate = attachment ? { attached: false } : null;

    if (runtime.workPublisher) {
      const completed = await runtime.workPublisher.completeRequest(id, request, files, attachment);
      outboxId = completed?.outboxId ?? null;
      if (attachment) printEstimate = { attached: Boolean(completed?.printEstimate?.attached) };
      integrations.database = true;
    } else if (runtime.requestRepository) {
      await runtime.requestRepository.completeDraft(id, request, files);
      integrations.database = true;
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
