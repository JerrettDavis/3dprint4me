// A trusted process consumes durable jobs; HTTP handlers only enqueue them.
export function createCatalogueWorker({ repository, render, workerId, now = () => new Date().toISOString(), leaseMs = 300000, heartbeatMs = 30000 }) {
  let running = false;
  let stopped = false; let activeAbort = null;
  return { stop() { stopped = true; activeAbort?.abort(); }, async tick() {
    if (stopped) return 'stopped';
    if (running) return 'busy';
    running = true;
    let timer;
    try {
      const job = await repository.claimJob({ workerId, now: now(), leaseMs });
      if (!job) return 'idle';
      const abort = new AbortController();
      activeAbort = abort;
      let renewal = Promise.resolve(); let renewing = false;
      timer = setInterval(() => {
        if (renewing) return;
        renewing = true;
        renewal = repository.renewJob({ id: job.id, leaseToken: job.leaseToken, now: now(), leaseMs })
          .then(owned => { if (!owned) abort.abort(); }, () => abort.abort()).finally(() => { renewing = false; });
      }, heartbeatMs);
      timer.unref?.();
      let result; let ok = false;
      try { result = await render(job, { signal: abort.signal }); ok = true; }
      catch { /* Provider/process errors never enter durable state or operator output. */ }
      clearInterval(timer); timer = undefined;
      await renewal;
      if (abort.signal.aborted) return 'lease_lost';
      const finished = await repository.finishJob({ id: job.id, leaseToken: job.leaseToken, now: now(), ok, result });
      return finished.status;
    } finally { if (timer) clearInterval(timer); activeAbort = null; running = false; }
  } };
}
