import { HttpError } from "../http.js";

export function createStripePaymentGateway({ secret, fetchImpl = (...args) => globalThis.fetch(...args) }) {
  return {
    async createSession({ requestId, projectTitle, email, amountCents, origin }) {
      const params = new URLSearchParams({
        mode: "payment",
        customer_email: email,
        success_url: `${origin}/order.html?payment=success&request=${encodeURIComponent(requestId)}`,
        cancel_url: `${origin}/order.html?payment=cancelled&request=${encodeURIComponent(requestId)}`,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": String(amountCents),
        "line_items[0][price_data][product_data][name]": "Optional project deposit",
        "line_items[0][price_data][product_data][description]": `${requestId} · ${projectTitle}`,
        "metadata[request_id]": requestId,
        "payment_intent_data[metadata][request_id]": requestId
      });
      const response = await fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
        signal: AbortSignal.timeout(10_000)
      });
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; }
      catch { payload = null; }
      if (!response.ok || !payload?.url) {
        console.error("Stripe checkout failed", response.status);
        throw new HttpError(502, "Checkout could not be created.");
      }
      return { url: payload.url };
    }
  };
}
