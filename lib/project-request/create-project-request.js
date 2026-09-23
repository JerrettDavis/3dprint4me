export function createProjectRequestUseCase({ normalizeRequest, newRequestId, getRuntime }) {
  return async function createProjectRequest(body) {
    const id = newRequestId();
    if (body?.website) return { id, mode: "ignored", live: true };
    const request = normalizeRequest(body?.request);
    const runtime = getRuntime();
    if (runtime.requestRepository) await runtime.requestRepository.createDraft(id, request);
    if (runtime.recorder) await runtime.recorder.record({ event: "create", id, request });
    return { id, mode: runtime.mode, live: Boolean(runtime.requestRepository) };
  };
}
