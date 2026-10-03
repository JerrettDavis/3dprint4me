// Main-thread wrapper around the build worker: one worker, monotonically increasing ids,
// latest-wins (an older request is rejected as superseded once a newer one is sent), and a
// timeout that terminates and recreates a stuck worker.
export const BUILD_TIMEOUT_MS = 30_000;

export class SupersededError extends Error {
  constructor() { super("A newer build replaced this one."); this.name = "SupersededError"; this.superseded = true; }
}

const defaultCreateWorker = () => new Worker(new URL("./worker.js", import.meta.url), { type: "module" });

export function createWorkerClient({ createWorker = defaultCreateWorker, timeoutMs = BUILD_TIMEOUT_MS } = {}) {
  let worker = null;
  let nextId = 0;
  let pending = null; // { id, resolve, reject, timer }

  const settle = (fn, value) => {
    if (!pending) return;
    clearTimeout(pending.timer);
    const current = pending;
    pending = null;
    current[fn](value);
  };

  function onMessage({ data }) {
    if (!pending || !data || data.id !== pending.id) return; // stale reply from a superseded build
    if (data.ok) settle("resolve", data.result);
    else settle("reject", new Error(data.error || "The model could not be built."));
  }
  function onError(event) {
    event?.preventDefault?.();
    reset();
    settle("reject", new Error("The model builder stopped unexpectedly. Try again."));
  }

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

  return {
    build(generatorId, params, { fontId, fontBytes, fontKey } = {}) {
      if (pending) settle("reject", new SupersededError());
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (pending?.id !== id) return;
          reset();
          settle("reject", new Error("Building the model took too long. Try simpler settings, or try again."));
        }, timeoutMs);
        pending = { id, resolve, reject, timer };
        try {
          ensure().postMessage({ id, generatorId, params, fontId, fontBytes, fontKey });
        } catch (error) {
          reset();
          settle("reject", new Error(String(error?.message ?? error)));
        }
      });
    },
    terminate() {
      if (pending) settle("reject", new SupersededError());
      reset();
    }
  };
}
