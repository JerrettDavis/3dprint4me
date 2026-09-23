import { HttpError } from "../http.js";
import { normalizeCheckoutRequest } from "./domain.js";

export function createCheckoutSessionUseCase({ validateRequestId, validCheckoutProof, paymentGateway }) {
  return async function createCheckoutSession(body, terms) {
    const checkout = normalizeCheckoutRequest(body, validateRequestId);
    if (!validCheckoutProof(checkout.checkoutToken, checkout.requestId, checkout.email, checkout.projectTitle)) {
      throw new HttpError(400, "Complete a project request before opening deposit checkout.");
    }
    return paymentGateway.createSession({
      requestId: checkout.requestId,
      projectTitle: checkout.projectTitle,
      email: checkout.email,
      amountCents: terms.amountCents,
      origin: terms.origin
    });
  };
}
