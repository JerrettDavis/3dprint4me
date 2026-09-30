// Composition root for the print-estimation slice. Providers are chosen here only.
import { dirname, join, resolve } from "node:path";

import { hasBlob } from "../blob.js";
import { getLocalOperatorStore, localOperatorEnabled } from "../local-operator.js";
import * as neon from "../neon.js";
import { createBlobModelStore } from "./adapters/blob-model-store.js";
import { createHttpSlicer } from "./adapters/http-slicer.js";
import { createLocalCliSlicer } from "./adapters/local-cli-slicer.js";
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

/** Slicer provider selected by environment; null keeps exact slicing disabled. */
export function createSlicerFromEnv({ fileStore, env = process.env } = {}) {
  const timeoutMs = Number.isInteger(Number(env.SLICER_TIMEOUT_MS)) && Number(env.SLICER_TIMEOUT_MS) > 0 ? Number(env.SLICER_TIMEOUT_MS) : 120_000;
  if (env.SLICER_PROVIDER === "local-cli") {
    return createLocalCliSlicer({
      bin: env.SLICER_BIN, profilePath: env.SLICER_PROFILE || null, engine: env.SLICER_ENGINE || "prusaslicer-cli",
      engineVersion: env.SLICER_ENGINE_VERSION || null, profileId: env.SLICER_PROFILE_ID || null, timeoutMs,
      ...(env.SLICER_ARGS ? { args: JSON.parse(env.SLICER_ARGS) } : {})
    });
  }
  if (env.SLICER_PROVIDER === "http") return createHttpSlicer({ url: env.SLICER_HTTP_URL, token: env.SLICER_HTTP_TOKEN, signDownload: (path, seconds) => fileStore.signDownload(path, seconds), timeoutMs });
  return null;
}
