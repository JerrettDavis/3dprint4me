// Retention sweep and privacy deletion for private print models.
//   npm run estimate:cleanup                      one bounded sweep
//   npm run estimate:cleanup -- --purge-request 3DP-...   delete one request's models and estimates
import { pathToFileURL } from "node:url";

import { createRetentionUseCases, retentionPolicyFromEnv } from "../lib/print-estimation/application/retention.js";
import { createPrintEstimationRuntime } from "../lib/print-estimation/runtime.js";
import { validateRequestId } from "../lib/validation.js";

export async function runMaintenance(argv = process.argv.slice(2), runtime = createPrintEstimationRuntime()) {
  if (!runtime.repository || !runtime.fileStore) throw new Error("Print estimation storage is not configured (DATABASE_URL and BLOB_READ_WRITE_TOKEN).");
  const retention = createRetentionUseCases({ repository: runtime.repository, fileStore: runtime.fileStore, policy: retentionPolicyFromEnv(), logFailure: operation => console.error(`Private model ${operation} failed.`) });
  const purgeIndex = argv.indexOf("--purge-request");
  if (purgeIndex >= 0) return { purge: await retention.purgeRequest(validateRequestId(argv[purgeIndex + 1])) };
  return { sweep: await retention.sweep({ limit: 200 }) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { console.log(JSON.stringify(await runMaintenance())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
