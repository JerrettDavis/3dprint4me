import { createRemoteJWKSet, jwtVerify } from "jose";
import { HttpError } from "./http.js";

function header(req, name) {
  const value = req?.headers?.[name.toLowerCase()] ?? req?.headers?.[name] ?? req?.headers?.get?.(name);
  return Array.isArray(value) ? value[0] : value ?? null;
}

function normalizeIdentity(session) {
  const user = session?.user ?? session?.payload ?? session;
  const authUserId = String(user?.id ?? user?.sub ?? "").trim();
  if (!authUserId) return null;
  return { authUserId, name: user?.name ? String(user.name) : null, email: user?.email ? String(user.email) : null, provider: session?.provider ? String(session.provider) : "neon" };
}

export function createIdentityProvider({ verifySession }) {
  if (typeof verifySession !== "function") throw new TypeError("A session verifier is required.");
  return { async getIdentity(req) { return normalizeIdentity(await verifySession(req)); } };
}

export function createNeonIdentityProvider({ jwksUrl = process.env.NEON_AUTH_JWKS_URL, issuer = process.env.NEON_AUTH_BASE_URL } = {}) {
  if (!jwksUrl) throw new Error("NEON_AUTH_JWKS_URL is required.");
  const jwks = createRemoteJWKSet(new URL(jwksUrl), { timeoutDuration: 8_000 });
  return createIdentityProvider({ async verifySession(req) {
    const match = /^Bearer\s+([^\s]+)$/i.exec(String(header(req, "authorization") ?? ""));
    if (!match) return null;
    try {
      const { payload } = await jwtVerify(match[1], jwks, issuer ? { issuer: issuer.replace(/\/$/, "") } : {});
      return { payload, provider: "neon" };
    } catch (error) {
      if (["ERR_JWT_EXPIRED", "ERR_JWS_INVALID", "ERR_JWS_SIGNATURE_VERIFICATION_FAILED", "ERR_JWT_CLAIM_VALIDATION_FAILED"].includes(error?.code)) return null;
      console.error("Neon Auth verification failed.");
      throw new HttpError(503, "Operator authentication is temporarily unavailable.");
    }
  } });
}

export async function authorizeOperator(req, store, identityProvider) {
  const identity = await identityProvider.getIdentity(req);
  if (!identity) throw new HttpError(401, "Sign in is required.", { code: "sign_in_required" });
  const record = await store.findOperatorByAuthUserId(identity.authUserId);
  if (!record?.enabled) throw new HttpError(403, "This identity is not authorized for operator access.", { code: "operator_forbidden" });
  const operator = { id: record.id, authUserId: record.authUserId, displayName: record.displayName, role: record.role };
  await store.touchOperator?.(record.id);
  return operator;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const isLoopbackAddress = value => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(String(value ?? ""));

export function createDevelopmentIdentityProvider({ enabled, localDev, host, allowedOrigin }) {
  if (!enabled) return { getIdentity: async () => null };
  if (!localDev) throw new Error("Operator development identity requires development mode.");
  if (!LOOPBACK_HOSTS.has(String(host))) throw new Error("Operator development identity requires a loopback host.");
  const origin = new URL(allowedOrigin);
  if (!LOOPBACK_HOSTS.has(origin.hostname)) throw new Error("Operator development identity requires a loopback origin.");
  return { async getIdentity(req) {
    if (header(req, "origin") !== origin.origin || !isLoopbackAddress(req?.socket?.remoteAddress)) return null;
    return { authUserId: "local-development-owner", name: "Local owner", email: null, provider: "development" };
  } };
}
