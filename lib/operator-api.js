import { HttpError, sendJson } from "./http.js";

function requestOrigin(req) { return String(req?.headers?.origin ?? req?.headers?.Origin ?? ""); }
function setCors(res, origin, methods) {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", [...methods, "OPTIONS"].join(", "));
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key");
  res.setHeader("Vary", "Origin");
}

export function configuredOperatorOrigins(value = process.env.OPERATOR_ALLOWED_ORIGINS ?? "") {
  return [...new Set(String(value).split(",").map(item => item.trim()).filter(Boolean).map(item => new URL(item).origin))];
}

export function createOperatorApiHandler({ methods, allowedOrigins, authorize, handle }) {
  const permitted = new Set(methods);
  const origins = new Set(allowedOrigins);
  return async function operatorApiHandler(req, res) {
    const origin = requestOrigin(req);
    if (!origin || !origins.has(origin)) { sendJson(res, 403, { error: "Origin is not allowed.", code: "origin_forbidden" }); return; }
    setCors(res, origin, permitted);
    if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
    if (!permitted.has(req.method)) {
      res.setHeader("Allow", [...permitted, "OPTIONS"].join(", "));
      sendJson(res, 405, { error: "Method not allowed.", code: "method_not_allowed" });
      return;
    }
    try {
      const operator = await authorize(req);
      const result = await handle({ req, res, operator });
      if (!res.writableEnded) sendJson(res, result?.status ?? 200, result?.body ?? result ?? {});
    } catch (error) {
      if (error instanceof HttpError && error.status < 500) {
        const code = error.details?.code ?? (error.status === 401 ? "sign_in_required" : error.status === 403 ? "operator_forbidden" : "operator_request_invalid");
        sendJson(res, error.status, { error: error.message, code });
        return;
      }
      console.error("Operator API failed.");
      sendJson(res, 503, { error: "Operator service is temporarily unavailable.", code: "operator_unavailable" });
    }
  };
}
