import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import checkoutHandler from "../../api/checkout.js";
import requestHandler from "../../api/request.js";
import { issueCheckoutToken, validCheckoutToken } from "../../lib/checkout-token.js";

const originalFetch = globalThis.fetch;
const watchedEnv = [
  "STRIPE_SECRET_KEY",
  "DEPOSIT_AMOUNT_CENTS",
  "SITE_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "LOCAL_DEV",
  "REQUEST_WEBHOOK_URL",
  "RESEND_API_KEY",
  "REQUEST_TO_EMAIL",
  "REQUEST_FROM_EMAIL"
];
const originalEnv = Object.fromEntries(watchedEnv.map(key => [key, process.env[key]]));
const originalConsoleError = console.error;

function request(body) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", host: "attacker.example" },
    body
  };
}

function response() {
  const headers = new Map();
  return {
    statusCode: 0,
    body: "",
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    end(value = "") { this.body += value; },
    headers
  };
}

function resetEnv() {
  for (const key of watchedEnv) delete process.env[key];
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
  resetEnv();
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value !== undefined) process.env[key] = value;
  }
});

test("Stripe checkout uses only the configured site origin", async () => {
  resetEnv();
  process.env.STRIPE_SECRET_KEY = "sk_test_example";
  process.env.SITE_URL = "https://3dprint4.me/untrusted/path?ignored=1";
  let stripeBody;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.stripe.com/v1/checkout/sessions");
    assert.equal(options.headers.Authorization, "Bearer sk_test_example");
    stripeBody = new URLSearchParams(options.body);
    return new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay/test" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const res = response();

  await checkoutHandler(request({
    requestId: "3DP-20260901-ABC123",
    projectTitle: "Custom enclosure",
    email: "customer@example.com",
    checkoutToken: issueCheckoutToken("3DP-20260901-ABC123", "customer@example.com", "Custom enclosure")
  }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(stripeBody.get("success_url"), "https://3dprint4.me/order.html?payment=success&request=3DP-20260901-ABC123");
  assert.equal(stripeBody.get("cancel_url"), "https://3dprint4.me/order.html?payment=cancelled&request=3DP-20260901-ABC123");
  assert.equal(JSON.parse(res.body).url, "https://checkout.stripe.com/c/pay/test");
});

test("Stripe checkout refuses an untrusted request Host when no site origin is configured", async () => {
  resetEnv();
  process.env.STRIPE_SECRET_KEY = "sk_test_example";
  console.error = () => {};
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("should not call Stripe"); };
  const res = response();

  await checkoutHandler(request({
    requestId: "3DP-20260901-ABC123",
    projectTitle: "Custom enclosure",
    email: "customer@example.com",
    checkoutToken: issueCheckoutToken("3DP-20260901-ABC123", "customer@example.com", "Custom enclosure")
  }), res);

  assert.equal(called, false);
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).error, "The service could not complete this request.");
});

test("Stripe failure does not log provider response details", async () => {
  resetEnv();
  process.env.STRIPE_SECRET_KEY = "sk_test_example";
  process.env.SITE_URL = "https://3dprint4.me";
  const logged = [];
  console.error = (...values) => logged.push(JSON.stringify(values));
  globalThis.fetch = async () => new Response("secret-token customer@example.com", { status: 502 });
  const res = response();

  await checkoutHandler(request({
    requestId: "3DP-20260901-ABC123",
    projectTitle: "Custom enclosure",
    email: "customer@example.com",
    checkoutToken: issueCheckoutToken("3DP-20260901-ABC123", "customer@example.com", "Custom enclosure")
  }), res);

  assert.equal(res.statusCode, 502);
  assert.doesNotMatch(logged.join(" "), /secret-token|customer@example.com/);
  assert.doesNotMatch(res.body, /secret-token|customer@example.com/);
});

test("Stripe network exceptions do not log credential-bearing error text", async () => {
  resetEnv();
  process.env.STRIPE_SECRET_KEY = "sk_test_example";
  process.env.SITE_URL = "https://3dprint4.me";
  const logged = [];
  console.error = (...values) => logged.push(values.map(String).join(" "));
  globalThis.fetch = async () => { throw new Error("network error at https://provider.example/?secret=leaked-secret"); };
  const res = response();

  await checkoutHandler(request({
    requestId: "3DP-20260901-ABC123",
    projectTitle: "Custom enclosure",
    email: "customer@example.com",
    checkoutToken: issueCheckoutToken("3DP-20260901-ABC123", "customer@example.com", "Custom enclosure")
  }), res);

  assert.equal(res.statusCode, 500);
  assert.doesNotMatch(logged.join(" "), /leaked-secret/);
  assert.doesNotMatch(res.body, /leaked-secret/);
});

test("Stripe checkout refuses a request without completion proof", async () => {
  resetEnv();
  process.env.STRIPE_SECRET_KEY = "sk_test_example";
  process.env.SITE_URL = "https://3dprint4.me";
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("Stripe must not be called"); };
  const res = response();

  await checkoutHandler(request({
    requestId: "3DP-20260901-ABC123",
    projectTitle: "Custom enclosure",
    email: "customer@example.com"
  }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(called, false);
});

test("Stripe checkout rejects completion proof bound to a different customer", async () => {
  resetEnv();
  process.env.STRIPE_SECRET_KEY = "sk_test_example";
  process.env.SITE_URL = "https://3dprint4.me";
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("Stripe must not be called"); };
  const res = response();

  await checkoutHandler(request({
    requestId: "3DP-20260901-ABC123",
    projectTitle: "Custom enclosure",
    email: "other@example.com",
    checkoutToken: issueCheckoutToken("3DP-20260901-ABC123", "customer@example.com", "Custom enclosure")
  }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(called, false);
});

test("successful request delivery issues checkout proof for that request", async () => {
  resetEnv();
  process.env.STRIPE_SECRET_KEY = "sk_test_example";
  process.env.REQUEST_WEBHOOK_URL = "https://automation.example/intake";
  globalThis.fetch = async url => {
    assert.equal(url, "https://automation.example/intake");
    return new Response(null, { status: 204 });
  };
  const res = response();
  await requestHandler({
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: {
      id: "3DP-20260901-ABC123",
      request: {
        projectTitle: "Custom enclosure",
        service: "design",
        description: "A printable electronics enclosure with access to the battery compartment.",
        contact: { name: "Taylor Customer", email: "customer@example.com" },
        consent: true
      },
      uploadedFiles: []
    }
  }, res);

  assert.equal(res.statusCode, 200);
  const result = JSON.parse(res.body);
  assert.equal(result.live, true);
  assert.equal(result.integrations.webhook, true);
  assert.ok(result.checkoutToken);
  assert.equal(result.checkoutToken.split(".").length, 2);
});

test("an owner email counts as delivered when the customer receipt fails", async () => {
  resetEnv();
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.REQUEST_TO_EMAIL = "hello@3dprint4.me";
  process.env.REQUEST_FROM_EMAIL = "requests@3dprint4.me";
  globalThis.fetch = async (_url, options) =>
    JSON.parse(options.body).to[0] === "hello@3dprint4.me"
      ? new Response('{"id":"owner_email"}', { status: 200 })
      : new Response("receipt rejected", { status: 429 });
  const res = response();
  await requestHandler({
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: {
      id: "3DP-20260901-ABC123",
      request: {
        projectTitle: "Custom enclosure",
        service: "design",
        description: "A printable electronics enclosure with access to the battery compartment.",
        contact: { name: "Taylor Customer", email: "customer@example.com" },
        consent: true
      },
      uploadedFiles: []
    }
  }, res);

  assert.equal(res.statusCode, 200);
  const result = JSON.parse(res.body);
  assert.equal(result.live, true);
  assert.equal(result.integrations.email, true);
});

test("webhook network exceptions do not log credential-bearing URLs", async () => {
  resetEnv();
  process.env.REQUEST_WEBHOOK_URL = "https://automation.example/intake?token=leaked-secret";
  const logged = [];
  console.error = (...values) => logged.push(values.map(String).join(" "));
  globalThis.fetch = async () => { throw new Error(process.env.REQUEST_WEBHOOK_URL); };
  const res = response();
  await requestHandler({
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: {
      id: "3DP-20260901-ABC123",
      request: {
        projectTitle: "Custom enclosure",
        service: "design",
        description: "A printable electronics enclosure with access to the battery compartment.",
        contact: { name: "Taylor Customer", email: "customer@example.com" },
        consent: true
      },
      uploadedFiles: []
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).live, false);
  assert.doesNotMatch(logged.join(" "), /leaked-secret/);
  assert.doesNotMatch(res.body, /leaked-secret/);
});

test("completion proof expires after 24 hours", () => {
  resetEnv();
  process.env.STRIPE_SECRET_KEY = "sk_test_example";
  const proof = issueCheckoutToken("3DP-20260901-ABC123", "customer@example.com", "Custom enclosure");
  assert.equal(validCheckoutToken(proof, "3DP-20260901-ABC123", "customer@example.com", "Custom enclosure"), true);
  const now = Date.now;
  try {
    Date.now = () => now() + 24 * 60 * 60 * 1000 + 1;
    assert.equal(validCheckoutToken(proof, "3DP-20260901-ABC123", "customer@example.com", "Custom enclosure"), false);
  } finally {
    Date.now = now;
  }
});
