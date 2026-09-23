import { resolve } from "node:path";
import { createDevelopmentIdentityProvider } from "./operator-auth.js";
import { createLocalWorkRepository } from "./work-management/adapters/local-work-repository.js";

let cached;

export function localOperatorEnabled() {
  return process.env.LOCAL_DEV === "1" && process.env.OPERATOR_DEV_AUTH === "1";
}

export function getLocalOperatorStore() {
  if (!localOperatorEnabled()) return null;
  const path = resolve(process.env.OPERATOR_DEV_STORE_PATH || "data/operator-dev.json");
  if (!cached || cached.path !== path) cached = { path, store: createLocalWorkRepository({ path }) };
  return cached.store;
}

export function getLocalIdentityProvider() {
  const origins = String(process.env.OPERATOR_ALLOWED_ORIGINS ?? "http://127.0.0.1:4180").split(",");
  return createDevelopmentIdentityProvider({ enabled: process.env.OPERATOR_DEV_AUTH === "1", localDev: process.env.LOCAL_DEV === "1", host: process.env.HOST ?? "127.0.0.1", allowedOrigin: origins[0].trim() });
}
