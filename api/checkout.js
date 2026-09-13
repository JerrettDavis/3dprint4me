import { cleanString, handleApiError, HttpError, isValidEmail, readJson, requireMethod, sendJson, safeNumber } from "../lib/http.js";
import { validateRequestId } from "../lib/validation.js";
import { validCheckoutToken } from "../lib/checkout-token.js";

function parseOrigin(value) {
  if (!value) return null;
  try {
    const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const parsed = new URL(candidate);
    if (!new Set(["http:", "https:"]).has(parsed.protocol)) return null;
    return parsed.origin;
  } catch { return null; }
}

function siteUrl(req) {
  const configured = parseOrigin(process.env.SITE_URL);
  if (configured) return configured;
  const vercelProduction = parseOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (vercelProduction) return vercelProduction;
  if (process.env.LOCAL_DEV === "1") {
    const host = String(req.headers.host || "127.0.0.1:4173");
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) return `http://${host}`;
  }
  throw new HttpError(503, "Set SITE_URL before enabling deposit checkout.");
}

export default async function handler(req, res) {
  try {
    requireMethod(req, "POST");
    if (!process.env.STRIPE_SECRET_KEY) throw new HttpError(503, "Optional deposit checkout is not configured.");
    const body = await readJson(req, 64 * 1024);
    const requestId = validateRequestId(body.requestId);
    const projectTitle = cleanString(body.projectTitle, 120) || "Custom fabrication project";
    const email = cleanString(body.email, 254).toLowerCase();
    if (!isValidEmail(email)) throw new HttpError(400, "A valid checkout email is required.");
    if (!validCheckoutToken(body.checkoutToken, requestId, email, projectTitle)) throw new HttpError(400, "Complete a project request before opening deposit checkout.");
    const amount = Math.round(safeNumber(process.env.DEPOSIT_AMOUNT_CENTS || 2500, { min: 500, max: 25000, fallback: 2500 }));
    const origin = siteUrl(req);
    const params = new URLSearchParams({
      mode: "payment",
      customer_email: email,
      success_url: `${origin}/order.html?payment=success&request=${encodeURIComponent(requestId)}`,
      cancel_url: `${origin}/order.html?payment=cancelled&request=${encodeURIComponent(requestId)}`,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(amount),
      "line_items[0][price_data][product_data][name]": "Optional project deposit",
      "line_items[0][price_data][product_data][description]": `${requestId} · ${projectTitle}`,
      "metadata[request_id]": requestId,
      "payment_intent_data[metadata][request_id]": requestId
    });
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" }, body: params, signal: AbortSignal.timeout(10_000) });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; }
    catch { payload = { message: text.slice(0, 1000) }; }
    if (!response.ok || !payload?.url) { console.error("Stripe checkout failed", response.status); throw new HttpError(502, "Checkout could not be created."); }
    sendJson(res, 200, { url: payload.url });
  } catch (error) { handleApiError(res, error); }
}
