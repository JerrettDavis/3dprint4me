import { handleApiError, HttpError, readJson, requireMethod, safeNumber, sendJson } from "../http.js";
import { validateRequestId } from "../validation.js";
import { createCheckoutSessionUseCase } from "./create-checkout-session.js";
import { parseTrustedOrigin } from "./domain.js";
import { validCheckoutToken } from "./proof.js";
import { createStripePaymentGateway } from "./stripe-adapter.js";

function siteUrl(req) {
  const configured = parseTrustedOrigin(process.env.SITE_URL);
  if (configured) return configured;
  const production = parseTrustedOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (production) return production;
  if (process.env.LOCAL_DEV === "1") {
    const host = String(req.headers.host || "127.0.0.1:4173");
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) return `http://${host}`;
  }
  throw new HttpError(503, "Set SITE_URL before enabling deposit checkout.");
}

export function createCheckoutHandler() {
  return async function checkoutHandler(req, res) {
    try {
      requireMethod(req, "POST");
      const secret = process.env.STRIPE_SECRET_KEY;
      if (!secret) throw new HttpError(503, "Optional deposit checkout is not configured.");
      const createSession = createCheckoutSessionUseCase({
        validateRequestId,
        validCheckoutProof: validCheckoutToken,
        paymentGateway: createStripePaymentGateway({ secret })
      });
      const body = await readJson(req, 64 * 1024);
      const result = await createSession(body, {
        origin: siteUrl(req),
        amountCents: Math.round(safeNumber(process.env.DEPOSIT_AMOUNT_CENTS || 2500, { min: 500, max: 25000, fallback: 2500 }))
      });
      sendJson(res, 200, result);
    } catch (error) {
      handleApiError(res, error);
    }
  };
}

export default createCheckoutHandler();
