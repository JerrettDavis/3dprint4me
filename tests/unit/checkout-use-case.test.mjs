import assert from "node:assert/strict";
import test from "node:test";

import { createCheckoutSessionUseCase } from "../../lib/checkout/create-checkout-session.js";

test("Given valid completion proof, when checkout starts, then the use case sends normalized deposit terms through its payment port", async () => {
  let received;
  const createCheckout = createCheckoutSessionUseCase({
    validateRequestId: value => value,
    validCheckoutProof: (proof, id, email, title) => proof === `${id}:${email}:${title}`,
    paymentGateway: {
      createSession: async command => {
        received = command;
        return { url: "https://checkout.stripe.com/c/pay/test" };
      }
    }
  });

  const result = await createCheckout({
    requestId: "3DP-20260901-ABC123",
    projectTitle: "  Custom enclosure  ",
    email: "  CUSTOMER@EXAMPLE.COM ",
    checkoutToken: "3DP-20260901-ABC123:customer@example.com:Custom enclosure"
  }, { origin: "https://3dprint4.me", amountCents: 2500 });

  assert.deepEqual(received, {
    requestId: "3DP-20260901-ABC123",
    projectTitle: "Custom enclosure",
    email: "customer@example.com",
    amountCents: 2500,
    origin: "https://3dprint4.me"
  });
  assert.deepEqual(result, { url: "https://checkout.stripe.com/c/pay/test" });
});

test("Given missing completion proof, when checkout starts, then the payment port is never called", async () => {
  let called = false;
  const createCheckout = createCheckoutSessionUseCase({
    validateRequestId: value => value,
    validCheckoutProof: () => false,
    paymentGateway: { createSession: async () => { called = true; } }
  });

  await assert.rejects(
    createCheckout({
      requestId: "3DP-20260901-ABC123",
      projectTitle: "Custom enclosure",
      email: "customer@example.com"
    }, { origin: "https://3dprint4.me", amountCents: 2500 }),
    error => error.status === 400
  );
  assert.equal(called, false);
});
