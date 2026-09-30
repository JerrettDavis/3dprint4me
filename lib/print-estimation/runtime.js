// Composition root for the print-estimation slice. Providers are chosen here only.
import { dirname, join, resolve } from "node:path";

import { localOperatorEnabled } from "../local-operator.js";
import * as neon from "../neon.js";
import { createLocalPrintRepository } from "./adapters/local-print-repository.js";
import { createNeonPrintRepository } from "./adapters/neon-print-repository.js";

let localCache;

export function localPrintStorePath() {
  const queuePath = resolve(process.env.OPERATOR_DEV_STORE_PATH || "data/operator-dev.json");
  return join(dirname(queuePath), "print-estimation-dev.json");
}

export function createPrintEstimationRuntime() {
  if (neon.hasNeon()) return { mode: "neon", repository: createNeonPrintRepository() };
  if (localOperatorEnabled()) {
    const path = localPrintStorePath();
    if (!localCache || localCache.path !== path) localCache = { path, repository: createLocalPrintRepository({ path }) };
    return { mode: "local", repository: localCache.repository };
  }
  return { mode: "unavailable", repository: null };
}
