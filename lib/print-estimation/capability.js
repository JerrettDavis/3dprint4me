// Anonymous estimate sessions are owned by a high-entropy capability token. Only
// its SHA-256 hash is stored; the token itself lives in the customer's tab memory.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { HttpError } from "../http.js";

export const SESSION_ID_PATTERN = /^est_[a-f0-9]{32}$/;
export const ASSET_ID_PATTERN = /^asset_[a-f0-9]{32}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newSessionId(random = randomBytes) { return `est_${random(16).toString("hex")}`; }
export function newAssetId(random = randomBytes) { return `asset_${random(16).toString("hex")}`; }
export function newCapabilityToken(random = randomBytes) { return random(32).toString("base64url"); }
export function hashCapability(token) { return createHash("sha256").update(String(token), "utf8").digest("hex"); }

export function validateSessionId(value) {
  const id = String(value ?? "");
  if (!SESSION_ID_PATTERN.test(id)) throw new HttpError(400, "A valid estimate session is required.");
  return id;
}
export function validateAssetId(value) {
  const id = String(value ?? "");
  if (!ASSET_ID_PATTERN.test(id)) throw new HttpError(400, "A valid model upload is required.");
  return id;
}
export function validateCapabilityToken(value) {
  const token = String(value ?? "");
  if (!TOKEN_PATTERN.test(token)) throw new HttpError(401, "This estimate session is not available.");
  return token;
}

export function capabilityMatches(token, storedHash) {
  if (!storedHash || typeof storedHash !== "string" || storedHash.length !== 64) return false;
  const actual = Buffer.from(hashCapability(token), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Validates an optional `printEstimate` attachment reference on request completion. */
export function parseEstimateAttachment(input) {
  if (input == null) return null;
  if (typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "The print estimate reference is invalid.");
  return { sessionId: validateSessionId(input.sessionId), ownershipHash: hashCapability(validateCapabilityToken(input.token)) };
}
