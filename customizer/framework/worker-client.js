// Main-thread wrapper around the build worker.
//
// Scheduling: at most ONE request is in flight in the worker and at most ONE is queued.
// A new build() supersedes everything older: the in-flight request's promise and any queued
// request's promise reject with SupersededError at once (the in-flight one still finishes in
// the worker; its reply is discarded), and the new request becomes the queued one. When the
// in-flight reply (or a timeout/crash) arrives, the queued request is posted. So rapid edits
// cost at most one extra build, never a backlog.
//
// The timeout is measured from the moment a request is posted to the worker, not from when
// it was queued. On timeout or crash the worker is terminated and recreated; the in-flight
// request rejects (error.retryable = true) and a queued request survives and is posted to the
// fresh worker. Request payloads (custom font bytes, traced image contours) are only
// structured-cloned by postMessage for requests that actually run.
export const BUILD_TIMEOUT_MS = 30_000;

export class SupersededError extends Error {
  constructor() { super("A newer build replaced this one."); this.name = "SupersededError"; this.superseded = true; }
}

const retryable = message => Object.assign(new Error(message), { retryable: true });
const defaultCreateWorker = () => new Worker(new URL("./worker.js", import.meta.url), { type: "module" });

export function createWorkerClient({
  createWorker = defaultCreateWorker,
  timeoutMs = BUILD_TIMEOUT_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = handle => clearTimeout(handle)
} = {}) {
  let worker = null;
  let nextId = 0;
  let inFlight = null; // entry posted to the worker
  let queued = null;   // latest entry waiting for the worker

  // entry: { id, message, resolve, reject, settled, timer }
  const settle = (entry, fn, value) => {
    if (!entry || entry.settled) return;
    entry.settled = true;
    entry[fn](value);
  };
  const supersede = entry => settle(entry, "reject", new SupersededError());

  function ensure() {
    if (worker) return worker;
    worker = createWorker();
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    return worker;
  }
  function reset() {
    if (!worker) return;
    worker.removeEventListener("message", onMessage);
    worker.removeEventListener("error", onError);
    worker.terminate();
    worker = null;
  }

  function post(entry) {
    inFlight = entry;
    try {
      ensure().postMessage({ id: entry.id, ...entry.message });
    } catch (error) {
      reset();
      finish(entry, "reject", retryable(String(error?.message ?? error)));
      return;
    }
    entry.timer = setTimer(() => {
      if (inFlight !== entry) return;
      reset();
      finish(entry, "reject", retryable("Building the model took too long. Try simpler settings, or try again."));
    }, timeoutMs);
  }

  // Completes the in-flight entry and starts the queued one, if any.
  function finish(entry, fn, value) {
    if (entry.timer !== undefined) clearTimer(entry.timer);
    if (inFlight === entry) inFlight = null;
    settle(entry, fn, value);
    if (!inFlight && queued) {
      const next = queued;
      queued = null;
      post(next);
    }
  }

  function onMessage({ data }) {
    if (!inFlight || !data || data.id !== inFlight.id) return;
    if (data.ok) finish(inFlight, "resolve", data.result);
    else finish(inFlight, "reject", new Error(data.error || "The model could not be built."));
  }
  function onError(event) {
    event?.preventDefault?.();
    reset();
    if (inFlight) finish(inFlight, "reject", retryable("The model builder stopped unexpectedly. Try again."));
  }

  return {
    // imageContours: a traced customer image as plain [[x, y], ...] arrays (never the image).
    build(generatorId, params, { fontId, fontBytes, fontKey, imageContours } = {}) {
      supersede(inFlight);
      supersede(queued);
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const entry = { id, message: { generatorId, params, fontId, fontBytes, fontKey, imageContours }, resolve, reject, settled: false, timer: undefined };
        if (inFlight) queued = entry;
        else post(entry);
      });
    },
    terminate() {
      supersede(inFlight);
      supersede(queued);
      if (inFlight?.timer !== undefined) clearTimer(inFlight.timer);
      inFlight = null;
      queued = null;
      reset();
    }
  };
}
