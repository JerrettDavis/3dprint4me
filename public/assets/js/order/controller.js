export function createOrderController({
  getData,
  buildRequest,
  validateFinalStep,
  client,
  files,
  draftStore,
  view,
  newLocalId,
  warn = console.warn
}) {
  let completedRequest = null;

  async function submit(event) {
    event?.preventDefault?.();
    if (!validateFinalStep()) return null;
    const data = getData();
    const request = buildRequest();
    view.submitting("Creating request…");
    try {
      let created;
      try {
        created = await client.create({ request, website: data.website || "" });
      } catch (error) {
        if (error.kind === "correctable") throw error;
        warn("Backend unavailable; preserving a local request copy.");
        created = { id: newLocalId(), mode: "local", live: false, offlineFallback: true };
      }

      const uploadedFiles = await files.prepare(created.id, created.mode, (current, total) => view.uploadProgress(current, total));
      let completed;
      if (created.mode === "ignored") completed = { id: created.id, mode: "ignored", live: true };
      else if (created.offlineFallback) completed = { id: created.id, mode: "local", live: false };
      else {
        try {
          completed = await client.complete({ id: created.id, request, uploadedFiles });
        } catch (error) {
          if (error.kind === "correctable") throw error;
          warn("Could not confirm remote completion; preserving the request locally.");
          completed = { id: created.id, mode: created.mode || "local", live: false, warning: error.message };
        }
      }

      completedRequest = { ...request, id: created.id, uploadedFiles, backend: completed };
      const savedLocally = draftStore.saveSubmitted(completedRequest);
      draftStore.clearDraft();
      view.showSubmission(completedRequest, savedLocally);
      return completedRequest;
    } catch (error) {
      view.submissionError(error);
      return null;
    }
  }

  return {
    submit,
    completedRequest: () => completedRequest
  };
}
