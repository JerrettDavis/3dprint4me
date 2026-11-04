export class OperatorApiError extends Error {
  constructor(kind, status, body = {}) { super(body.error?.message ?? body.error ?? "The operator service could not complete that request."); this.name = "OperatorApiError"; this.kind = kind; this.status = status; this.code = body.code ?? body.error?.code; this.currentRevision = body.currentRevision; }
}
const kinds = { 401: "signed-out", 403: "forbidden", 409: "conflict", 422: "invalid", 503: "unavailable" };
export function createApiClient({ apiBase = "", getSessionHeaders = async () => ({}), fetchImpl = fetch } = {}) {
  async function request(path, init = {}) {
    try {
      const response = await fetchImpl(`${apiBase}${path}`, { ...init, credentials: "include", cache: "no-store", headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...await getSessionHeaders(), ...init.headers } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new OperatorApiError(kinds[response.status] ?? "error", response.status, body);
      return body;
    } catch (error) { if (error instanceof OperatorApiError) throw error; throw new OperatorApiError("network", 0); }
  }
  return {
    session: () => request("/api/operator-session"),
    listWork: filters => request(`/api/operator-work?${new URLSearchParams(filters ?? {})}`),
    getWork: id => request(`/api/operator-work?id=${encodeURIComponent(id)}&schema=2`),
    listCommunications: workId=>request(`/api/operator-work?resource=communications&workId=${encodeURIComponent(workId)}`),
    createCommunication: (workId,command)=>request('/api/operator-work?resource=communications',{method:'POST',body:JSON.stringify({action:'create',workId,command})}),
    retryCommunication: (workId,messageId)=>request('/api/operator-work?resource=communications',{method:'POST',body:JSON.stringify({action:'retry',workId,messageId})}),
    modelAction: (workId,action,input)=>request('/api/operator-print',{method:'POST',body:JSON.stringify({action,workId,...input})}),
    inviteInquiry: workId => request("/api/operator-work?resource=inquiries", { method: "POST", body: JSON.stringify({ action: "invite", workId }) }),
    prepareInquiry: (command, idempotencyKey = crypto.randomUUID()) => request("/api/operator-work?resource=inquiries", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ action: "prepare", command }) }),
    invoiceStatus: workId => request(`/api/operator-work?resource=invoices&workId=${encodeURIComponent(workId)}`),
    invoiceAction: (action, value) => request("/api/operator-work?resource=invoices", { method: "POST", body: JSON.stringify({ action, ...value }) }),
    events: (after = "0") => request(`/api/operator-work?eventsAfter=${encodeURIComponent(after)}`),
    updateWork: (id, command, idempotencyKey = crypto.randomUUID()) => request("/api/operator-work-update", { method: "PATCH", body: JSON.stringify({ id, command, idempotencyKey }) }),
    printAssetDownload: (workId, assetId) => request(`/api/operator-print?resource=asset-download&workId=${encodeURIComponent(workId)}&assetId=${encodeURIComponent(assetId)}`),
    requestFileDownload: (workId, index) => request(`/api/operator-print?resource=request-file&workId=${encodeURIComponent(workId)}&index=${encodeURIComponent(index)}`),
    recordPrintRun: (workId, run) => request("/api/operator-print", { method: "POST", body: JSON.stringify({ action: "record-run", workId, run }) }),
    listFilament: () => request('/api/operator-print?resource=filament'),
    refreshSpoolman: () => request('/api/operator-print', { method: 'POST', body: JSON.stringify({ action: 'refresh-spoolman' }) }),
    saveImportedFilament: input => request('/api/operator-print', { method: 'POST', body: JSON.stringify({ action: 'save-imported-filament', ...input }) }),
    filamentSettings: () => request('/api/operator-print?resource=filament-settings'),
    saveFilament: filament => request('/api/operator-print', { method: 'POST', body: JSON.stringify({ action: 'save-filament', filament }) }),
    saveFilamentSettings: input => request('/api/operator-print', { method: 'POST', body: JSON.stringify({ action: 'save-filament-settings', ...input }) }),
    previewFilamentMatching: (workId, settings) => request('/api/operator-print', { method: 'POST', body: JSON.stringify({ action: 'preview-filament-matching', workId, settings }) }),
    filamentCommand: (workId, command) => request('/api/operator-print', { method: 'POST', body: JSON.stringify({ action: 'filament-command', workId, command }) }),
    previewSubstitutionEmail: (workId, input) => request('/api/operator-print', { method: 'POST', body: JSON.stringify({ action: 'preview-substitution-email', workId, ...input }) }),
    sendSubstitutionEmail: (workId, input) => request('/api/operator-print', { method: 'POST', body: JSON.stringify({ action: 'send-substitution-email', workId, ...input }) }),
    pushConfig: () => request("/api/operator-push"),
    pushAction: (action, value) => request("/api/operator-push", { method: "POST", body: JSON.stringify(action === "subscribe" ? { action, subscription: value } : action === "unsubscribe" ? { action, endpoint: value.endpoint } : { action }) })
  };
}
