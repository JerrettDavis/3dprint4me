// Asynchronous slice-job worker.
//   npm run estimate:worker            poll until stopped
//   npm run estimate:worker -- --once  process one batch and exit
// Requires SLICER_PROVIDER plus the print-estimation storage the site uses.
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import { createSliceJobRunner } from "../lib/print-estimation/application/slice-jobs.js";
import { createPrintEstimationRuntime, createSlicerFromEnv } from "../lib/print-estimation/runtime.js";

export function createWorker(runtime = createPrintEstimationRuntime(), env = process.env) {
  if (!runtime.repository || !runtime.fileStore) throw new Error("Print estimation storage is not configured.");
  const slicer = createSlicerFromEnv({ fileStore: runtime.fileStore, env });
  if (!slicer) throw new Error("SLICER_PROVIDER is not configured (local-cli or http).");
  return createSliceJobRunner({
    repository: runtime.repository, fileStore: runtime.fileStore, slicer, materialCosts: runtime.materialCosts, limits: runtime.limits,
    logFailure: category => console.error(`Slice job failed: ${category}`)
  });
}

async function main() {
  const worker = createWorker();
  const once = process.argv.includes("--once");
  const interval = Number(process.env.SLICER_POLL_MS) > 0 ? Number(process.env.SLICER_POLL_MS) : 15_000;
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; });
  do {
    const summary = await worker.runOnce({ batchSize: 2 });
    if (summary.claimed) console.log(JSON.stringify({ worker: worker.workerId, ...summary }));
    if (once) break;
    if (!summary.claimed) await sleep(interval);
  } while (!stopping);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
