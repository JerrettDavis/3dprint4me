export class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

export function requireMethod(req, allowed) {
  const methods = Array.isArray(allowed) ? allowed : [allowed];
  if (!methods.includes(req.method)) {
    const error = new HttpError(405, "Method not allowed.");
    error.allow = methods;
    throw error;
  }
}

export async function readJson(req, maxBytes = 1024 * 1024) {
  const contentType = String(req.headers?.["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (!(contentType === "application/json" || contentType.endsWith("+json"))) {
    throw new HttpError(415, "Request content type must be application/json.");
  }
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new HttpError(413, "Request body is too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new HttpError(400, "Request body must be valid JSON."); }
}

export function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.end(body);
}

export function handleApiError(res, error) {
  const status = Number(error?.status) || 500;
  if (error?.allow) res.setHeader("Allow", error.allow.join(", "));
  if (status >= 500) console.error("API request failed", status);
  sendJson(res, status, { error: status >= 500 ? "The service could not complete this request." : error.message, ...(error?.details ? { details: error.details } : {}) });
}

export function cleanString(value, maxLength = 1000) {
  if (value == null) return "";
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, maxLength);
}
export function cleanOptionalString(value, maxLength = 1000) { return cleanString(value, maxLength) || null; }
export function cleanUrl(value) {
  const input = cleanString(value, 2048);
  if (!input) return null;
  try {
    const url = new URL(input);
    if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("protocol");
    return url.toString();
  } catch { throw new HttpError(400, "A linked model or reference must use a valid http or https address."); }
}
export function isValidEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(value || "")); }
export function safeNumber(value, { min = -Infinity, max = Infinity, fallback = 0 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
