export class PrintEstimateClientError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "PrintEstimateClientError";
    this.status = status;
  }
}

/** Browser client for /api/print-estimate. Model bytes go straight to the signed private URL. */
export function createPrintEstimateClient({ fetchImpl = (...args) => fetch(...args) } = {}) {
  async function call(method, body, headers = {}, query = "") {
    let response;
    try {
      response = await fetchImpl(`/api/print-estimate${query}`, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch {
      throw new PrintEstimateClientError("The estimate service could not be reached.");
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new PrintEstimateClientError(payload.error || `Estimate request failed (${response.status})`, response.status);
    return payload;
  }
  return {
    create: options => call("POST", { action: "create", options }),
    authorizeUpload: body => call("POST", { action: "authorize-upload", ...body }),
    analyze: body => call("POST", { action: "analyze", ...body }),
    finalize: body => call("POST", { action: "finalize", ...body }),
    status: ({ sessionId, token }) => call("GET", null, { "X-Print-Estimate-Token": token }, `?id=${encodeURIComponent(sessionId)}`),
    async upload(instruction, file) {
      let response;
      try {
        response = await fetchImpl(instruction.uploadUrl, { method: instruction.method || "PUT", headers: { ...(instruction.headers || {}) }, body: file });
      } catch {
        throw new PrintEstimateClientError("The private model upload did not finish.");
      }
      if (!response.ok) throw new PrintEstimateClientError("The private model upload did not finish.", response.status);
    }
  };
}

/**
 * Private upload + server verification for the selected model. Failures never block
 * submission: without a verified private asset the file uploads with the request instead.
 */
export function createPrivateEstimateFlow({ client, getOptions, pollMs = 5000, maxPolls = 24, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id) }) {
  let session = null;
  let verified = null;
  let timer = null;
  let polls = 0;
  const stopPolling = () => { if (timer) clearTimer(timer); timer = null; polls = 0; };

  function schedulePoll(update, isCurrent) {
    stopPolling();
    const tick = async () => {
      timer = null;
      if (!isCurrent() || !session || polls >= maxPolls) return;
      polls += 1;
      try {
        const status = await client.status(session);
        if (!isCurrent()) return;
        update({ slice: status.slice });
        if (["pending", "processing"].includes(status.slice?.status)) timer = setTimer(tick, pollMs);
      } catch { /* keep the geometry estimate; the operator confirms later */ }
    };
    timer = setTimer(tick, pollMs);
  }

  return {
    reset() { stopPolling(); verified = null; },
    async start(file, { isCurrent, update }) {
      verified = null;
      update({ privateState: "uploading" });
      try {
        if (!session) {
          const created = await client.create(getOptions());
          session = { sessionId: created.sessionId, token: created.token };
        }
        const instruction = await client.authorizeUpload({ ...session, filename: file.name, size: file.size, contentType: file.type || undefined });
        if (!isCurrent()) return;
        await client.upload(instruction, file);
        if (!isCurrent()) return;
        update({ privateState: "verifying" });
        const result = await client.analyze({ ...session, assetId: instruction.assetId, options: getOptions() });
        if (!isCurrent()) return;
        verified = { file, assetId: instruction.assetId };
        update({ privateState: result.status === "ready" ? "verified" : "failed", slice: result.slice ?? null });
        if (["pending", "processing"].includes(result.slice?.status)) schedulePoll(update, isCurrent);
      } catch (error) {
        if (!isCurrent()) return;
        if (error?.status === 410) session = null;
        update({ privateState: error?.status === 503 ? "unavailable" : "failed" });
      }
    },
    /** The exact File already stored privately, so the request does not upload it again. */
    isPreUploaded: file => Boolean(verified && verified.file === file),
    attachment: () => (verified && session ? { sessionId: session.sessionId, token: session.token } : null),
    async finalize() {
      if (!verified || !session) return;
      try { await client.finalize({ ...session, assetId: verified.assetId, options: getOptions() }); } catch { /* best effort */ }
    }
  };
}
