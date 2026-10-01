// Global + per-client fixed-window rate limit for anonymous estimate session creation and
// upload-token issuance. Counters live in the repository (Neon in production). Any storage
// failure propagates, so the limiter fails closed: no counter, no session or upload token.
import { createHash } from "node:crypto";

import { HttpError } from "../../http.js";

export const RATE_SCOPES = Object.freeze(["session-create", "upload-token"]);
export const GLOBAL_SUBJECT = "global";
export const DEFAULT_RATE_POLICY = Object.freeze({
  windowSeconds: 3600,
  "session-create": Object.freeze({ perClient: 10, global: 300 }),
  "upload-token": Object.freeze({ perClient: 30, global: 900 })
});

export function ratePolicyFromEnv(env = process.env) {
  const bounded = (name, fallback, max) => {
    const value = Number(env[name]);
    return Number.isInteger(value) && value > 0 && value <= max ? value : fallback;
  };
  const d = DEFAULT_RATE_POLICY;
  return {
    windowSeconds: bounded("PRINT_ESTIMATE_RATE_WINDOW_SECONDS", d.windowSeconds, 86_400),
    "session-create": {
      perClient: bounded("PRINT_ESTIMATE_SESSIONS_PER_CLIENT", d["session-create"].perClient, 10_000),
      global: bounded("PRINT_ESTIMATE_SESSIONS_GLOBAL", d["session-create"].global, 1_000_000)
    },
    "upload-token": {
      perClient: bounded("PRINT_ESTIMATE_UPLOADS_PER_CLIENT", d["upload-token"].perClient, 10_000),
      global: bounded("PRINT_ESTIMATE_UPLOADS_GLOBAL", d["upload-token"].global, 1_000_000)
    }
  };
}

const header = (req, name) => {
  const value = req?.headers?.[name];
  return String(Array.isArray(value) ? value[0] : value ?? "").split(",")[0].trim();
};

/** Best-effort caller address. Vercel overwrites these headers at the edge. */
export function clientAddress(req) {
  return header(req, "x-vercel-forwarded-for") || header(req, "x-real-ip") || header(req, "x-forwarded-for") || String(req?.socket?.remoteAddress ?? "") || "unknown";
}

/** Opaque, salted per-client subject; the raw address is never stored. */
export function clientSubject(address, salt = "") {
  return `c_${createHash("sha256").update(`print-estimate-rate:${salt}:${address || "unknown"}`).digest("hex").slice(0, 32)}`;
}

export function createRateLimiter({ repository, policy = DEFAULT_RATE_POLICY, now = () => new Date() }) {
  return {
    /**
     * Counts one attempt against the client bucket, then the global bucket (so one noisy
     * client cannot drain the global budget with attempts it was already refused).
     * Throws HttpError 429 with Retry-After when either is exhausted.
     */
    async consume(scope, subject) {
      if (!RATE_SCOPES.includes(scope)) throw new TypeError("Unknown rate-limit scope.");
      const windowMs = policy.windowSeconds * 1000;
      const windowStartMs = Math.floor(now().getTime() / windowMs) * windowMs;
      const windowStart = new Date(windowStartMs).toISOString();
      const retryAfter = Math.max(1, Math.ceil((windowStartMs + windowMs - now().getTime()) / 1000));
      const limits = policy[scope];
      for (const [bucket, limit] of [[subject || "unknown", limits.perClient], [GLOBAL_SUBJECT, limits.global]]) {
        const hits = await repository.consumeRateLimit({ scope, subject: bucket, windowStart });
        if (!(Number.isInteger(hits) && hits >= 1)) throw new HttpError(503, "Rate limiting is unavailable.");
        if (hits > limit) {
          throw new HttpError(429, "Too many print estimate requests right now. Your file can still be sent with your request; submit it directly or try again later.", { retryAfterSeconds: retryAfter }, { "Retry-After": String(retryAfter) });
        }
      }
    }
  };
}
