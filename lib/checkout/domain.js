import { cleanString, HttpError, isValidEmail } from "../http.js";

export function normalizeCheckoutRequest(body, validateRequestId) {
  const requestId = validateRequestId(body?.requestId);
  const projectTitle = cleanString(body?.projectTitle, 120) || "Custom fabrication project";
  const email = cleanString(body?.email, 254).toLowerCase();
  if (!isValidEmail(email)) throw new HttpError(400, "A valid checkout email is required.");
  return { requestId, projectTitle, email, checkoutToken: body?.checkoutToken };
}

export function parseTrustedOrigin(value) {
  if (!value) return null;
  try {
    const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const parsed = new URL(candidate);
    return new Set(["http:", "https:"]).has(parsed.protocol) ? parsed.origin : null;
  } catch {
    return null;
  }
}
