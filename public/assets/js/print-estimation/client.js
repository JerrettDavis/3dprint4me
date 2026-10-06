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
    estimatePack: body => call("POST", { action: "estimate-pack", ...body }),
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
export function createPrivateEstimateFlow({ client, getOptions, pollMs = 5000, maxPolls = 24, debounceMs = 700, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id) }) {
  let session = null;
  let verified = null;
  let timer = null;
  let polls = 0;
  // Pack state: the latest mapped selection, a sequence number so a slow earlier response (or
  // poll) never overwrites a newer selection, and the preview budget. Previews are debounced,
  // never repeat the last selection sent, and stop after a 429 so the session keeps room for
  // the submission estimate.
  let lastSelections = [];
  let packSequence = 0;
  let previewTimer = null;
  // Every preview request still in flight, across selections and replaced files. The submission
  // waits for all of them, so no older preview can rewrite the selection after it lands.
  const previewsInFlight = new Set();
  let lastSentKey = null;
  let previewsBlocked = false;
  const cancelPreview = () => { if (previewTimer) clearTimer(previewTimer); previewTimer = null; };
  const resetPack = () => { cancelPreview(); lastSelections = []; lastSentKey = null; previewsBlocked = false; packSequence += 1; };
  const stopPolling = () => { if (timer) clearTimer(timer); timer = null; polls = 0; };

  function schedulePoll(update, isCurrent) {
    stopPolling();
    const sequence = packSequence;
    const tick = async () => {
      timer = null;
      if (!isCurrent() || !session || polls >= maxPolls || sequence !== packSequence) return;
      polls += 1;
      try {
        const status = await client.status(session);
        if (!isCurrent() || sequence !== packSequence) return;
        update({ slice: status.slice });
        if (["pending", "processing"].includes(status.slice?.status)) timer = setTimer(tick, pollMs);
      } catch { /* keep the geometry estimate; the operator confirms later */ }
    };
    timer = setTimer(tick, pollMs);
  }

  async function sendPreview(selections, sequence, { isCurrent, update }) {
    const key = JSON.stringify(selections);
    if (previewsBlocked || key === lastSentKey) return;
    lastSentKey = key;
    const request = (async () => {
      try {
        const result = await client.estimatePack({ ...session, assetId: verified.assetId, options: getOptions(), selections });
        if (!isCurrent() || sequence !== packSequence) return;
        update({ slice: result.slice ?? null });
        if (["pending", "processing"].includes(result.slice?.status)) schedulePoll(update, isCurrent);
      } catch (error) {
        // Keep the local planning range. After a 429 the session has no preview budget left.
        if (error?.status === 429) previewsBlocked = true;
        else if (lastSentKey === key) lastSentKey = null;
      }
    })();
    previewsInFlight.add(request);
    try { await request; } finally { previewsInFlight.delete(request); }
  }

  /** Records the latest selection and sends a preview estimate (debounced unless `immediate`). */
  async function runPackEstimate(selections, hooks, { immediate = false } = {}) {
    const sequence = ++packSequence;
    stopPolling();
    cancelPreview();
    lastSelections = verified?.partIds ? selections.map(item => ({ partId: verified.partIds.get(item.name), quantity: item.quantity })).filter(item => item.partId) : [];
    if (!lastSelections.length || !session) return;
    const mapped = lastSelections;
    if (immediate || debounceMs <= 0) return sendPreview(mapped, sequence, hooks);
    previewTimer = setTimer(() => { previewTimer = null; sendPreview(mapped, sequence, hooks); }, debounceMs);
  }

  return {
    reset() { stopPolling(); verified = null; resetPack(); },
    async start(file, { isCurrent, update, pack = null }) {
      verified = null;
      resetPack();
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
        if (pack) {
          const ready = result.status === "pack" ? result.pack.parts.filter(part => part.state === "ready") : [];
          verified = { file, assetId: instruction.assetId, pack: true, partIds: new Map(ready.map(part => [part.name, part.partId])) };
          update({ privateState: result.status === "pack" ? "verified" : "failed", slice: null });
          const current = pack();
          if (current) await runPackEstimate(current.parts.filter(part => current.selection[part.id]?.selected).map(part => ({ name: part.name, quantity: current.selection[part.id].quantity })), { isCurrent, update }, { immediate: true });
          return;
        }
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
    estimatePack: (selections, hooks) => runPackEstimate(selections, hooks),
    async finalize() {
      if (!verified || !session) return;
      try {
        if (!verified.pack) { await client.finalize({ ...session, assetId: verified.assetId, options: getOptions() }); return; }
        // The submission supersedes any pending preview, and must land after one already in flight.
        cancelPreview();
        packSequence += 1;
        while (previewsInFlight.size) await Promise.allSettled([...previewsInFlight]);
        if (lastSelections.length) await client.estimatePack({ ...session, assetId: verified.assetId, options: getOptions(), selections: lastSelections, purpose: "submission" });
      } catch { /* best effort */ }
    }
  };
}
