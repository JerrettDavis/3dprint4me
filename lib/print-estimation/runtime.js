// Composition root for the print-estimation slice. Providers are chosen here only.
import { dirname, join, resolve } from "node:path";

import { hasBlob } from "../blob.js";
import { getLocalOperatorStore, localOperatorEnabled } from "../local-operator.js";
import * as neon from "../neon.js";
import { createBlobModelStore } from "./adapters/blob-model-store.js";
import { createLocalFileStore } from "./adapters/local-file-store.js";
import { createLocalPrintRepository } from "./adapters/local-print-repository.js";
import { createNeonPrintRepository } from "./adapters/neon-print-repository.js";
import { createFilamentUseCases } from "./application/filament.js";
import { sessionPolicyFromEnv } from "./application/estimate-session.js";
import { serverModelLimits } from "./geometry/analyze-model.js";

let localCache;

export function localPrintStorePath() {
  const queuePath = resolve(process.env.OPERATOR_DEV_STORE_PATH || "data/operator-dev.json");
  return join(dirname(queuePath), "print-estimation-dev.json");
}

function localWorkLookup() {
  return async requestId => {
    const snapshot = await getLocalOperatorStore()?.snapshot?.();
    const item = snapshot?.workItems?.find(work => work.requestId === requestId);
    return item ? { status: item.status, completedAt: item.completedAt, updatedAt: item.updatedAt } : null;
  };
}

function localRuntime() {
  const path = localPrintStorePath();
  if (!localCache || localCache.path !== path) {
    const origin = process.env.SITE_URL || `http://${process.env.HOST || "127.0.0.1"}:${process.env.PORT || 4173}`;
    localCache = {
      path,
      repository: createLocalPrintRepository({ path, workLookup: localWorkLookup() }),
      fileStore: createLocalFileStore({ root: join(dirname(path), "print-private-files"), origin })
    };
  }
  return localCache;
}

export function slicerConfigured(env = process.env) {
  return Boolean(env.SLICER_PROVIDER && env.SLICER_PROVIDER !== "none");
}

function compose(mode, repository, fileStore) {
  return {
    mode, repository, fileStore,
    materialCosts: repository ? createFilamentUseCases({ repository }) : null,
    slicerEnabled: slicerConfigured(),
    policy: sessionPolicyFromEnv(),
    limits: serverModelLimits()
  };
}

export function createPrintEstimationRuntime() {
  if (neon.hasNeon()) return compose("neon", createNeonPrintRepository(), hasBlob() ? createBlobModelStore() : null);
  if (localOperatorEnabled()) {
    const local = localRuntime();
    return compose("local", local.repository, local.fileStore);
  }
  return compose("unavailable", null, null);
}

/** The loopback dev server mounts this route for signed local uploads/downloads. */
export function localPrivateFileHandler() {
  return localOperatorEnabled() ? localRuntime().fileStore : null;
}

/** True when anonymous private model estimates can be stored (Neon + private Blob, or the loopback workspace). */
export function printEstimationAvailable() {
  return (neon.hasNeon() && hasBlob()) || localOperatorEnabled();
}

