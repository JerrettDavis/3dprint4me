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
    getWork: id => request(`/api/operator-work?id=${encodeURIComponent(id)}`),
    events: (after = "0") => request(`/api/operator-work?eventsAfter=${encodeURIComponent(after)}`),
    updateWork: (id, command, idempotencyKey = crypto.randomUUID()) => request("/api/operator-work-update", { method: "PATCH", body: JSON.stringify({ id, command, idempotencyKey }) }),
    pushConfig: () => request("/api/operator-push"),
    pushAction: (action, subscription) => request("/api/operator-push", { method: "POST", body: JSON.stringify(subscription ? { action, subscription } : { action }) })
  };
}
