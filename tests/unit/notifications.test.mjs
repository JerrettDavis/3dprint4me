import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test, { afterEach } from "node:test";
import { hasEmailDelivery, hasWebhookDelivery, postRequestWebhook, sendRequestEmails } from "../../lib/notifications.js";

const originalFetch = globalThis.fetch;
const watchedEnv = [
  "RESEND_API_KEY", "REQUEST_TO_EMAIL", "REQUEST_FROM_EMAIL",
  "REQUEST_WEBHOOK_URL", "REQUEST_WEBHOOK_SECRET",
  "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_STORAGE_BUCKET"
];
const originalEnv = Object.fromEntries(watchedEnv.map(key => [key, process.env[key]]));

function configureEmail() {
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.REQUEST_TO_EMAIL = "hello@3dprint4.me";
  process.env.REQUEST_FROM_EMAIL = "3dprint4.me <requests@3dprint4.me>";
}

function resetEnv() {
  for (const key of watchedEnv) delete process.env[key];
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function baseRequest(overrides = {}) {
  return {
    projectTitle: "Bracket <script>alert(1)</script> & \"co\"",
    serviceLabel: "Print my model",
    description: "Line one\nLine two & <b>bold</b>",
    estimate: { formatted: "$28–$42" },
    deadline: null,
    modelUrl: null,
    specifications: { material: "PETG" },
    contact: { name: "Jordan \"J\" Customer", email: "jordan@example.com", phone: null, preferredContact: "email" },
    ...overrides
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetEnv();
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value !== undefined) process.env[key] = value;
  }
});

test("hasEmailDelivery/hasWebhookDelivery reflect configured environment", () => {
  resetEnv();
  assert.equal(hasEmailDelivery(), false);
  assert.equal(hasWebhookDelivery(), false);
  configureEmail();
  assert.equal(hasEmailDelivery(), true);
  process.env.REQUEST_WEBHOOK_URL = "https://automation.example/hooks/3dprint4me";
  assert.equal(hasWebhookDelivery(), true);
});

test("sendRequestEmails is a no-op when Resend is not configured", async () => {
  resetEnv();
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("should not call Resend"); };
  const result = await sendRequestEmails("3DP-20260901-ABC123", baseRequest(), []);
  assert.equal(result.sent, 0);
  assert.equal(called, false);
});

test("sendRequestEmails sends both owner and customer messages with escaped HTML", async () => {
  resetEnv();
  configureEmail();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body), authorization: options.headers.Authorization });
    return jsonResponse({ id: "email_123" });
  };

  const result = await sendRequestEmails("3DP-20260901-ABC123", baseRequest(), []);

  assert.equal(result.sent, 2);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url, "https://api.resend.com/emails");
    assert.equal(call.authorization, "Bearer re_test_key");
  }

  const owner = calls.find(call => call.body.to[0] === "hello@3dprint4.me");
  assert.ok(owner, "owner email was sent");
  assert.equal(owner.body.from, "3dprint4.me <requests@3dprint4.me>");
  assert.equal(owner.body.subject, "[3DP-20260901-ABC123] Bracket <script>alert(1)</script> & \"co\"");
  assert.equal(owner.body.reply_to, "jordan@example.com");
  // The raw script tag must never appear unescaped in the HTML payload.
  assert.ok(!owner.body.html.includes("<script>alert(1)</script>"));
  assert.ok(owner.body.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(owner.body.html.includes("Line one<br>Line two"));

  const customer = calls.find(call => call.body.to[0] === "jordan@example.com");
  assert.ok(customer, "customer email was sent");
  assert.equal(customer.body.reply_to, "hello@3dprint4.me");
  assert.ok(customer.body.html.includes("3DP-20260901-ABC123"));
  assert.ok(customer.body.html.includes("$28–$42"));
});

test("sendRequestEmails includes 15-minute signed download links when Supabase is configured", async () => {
  resetEnv();
  configureEmail();
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
  process.env.SUPABASE_STORAGE_BUCKET = "service-files";
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    if (String(url).includes("/storage/v1/object/sign/")) {
      return jsonResponse({ signedURL: "/object/sign/service-files/3DP-20260901-ABC123/bracket.stl?token=dl-token" });
    }
    return jsonResponse({ id: "email_123" });
  };

  const files = [{ name: "bracket.stl", size: 2048, path: "3DP-20260901-ABC123/bracket.stl", mode: "signed" }];
  await sendRequestEmails("3DP-20260901-ABC123", baseRequest(), files);

  const signCall = calls.find(url => String(url).includes("/storage/v1/object/sign/"));
  assert.ok(signCall, "a signed download URL was requested for the uploaded file");

  const emailCalls = calls.filter(url => url === "https://api.resend.com/emails");
  assert.equal(emailCalls.length, 2);
});

test("customer receipt asks for files that were only recorded as metadata", async () => {
  resetEnv();
  configureEmail();
  const messages = [];
  globalThis.fetch = async (_url, options) => {
    messages.push(JSON.parse(options.body));
    return jsonResponse({ id: "email_123" });
  };

  await sendRequestEmails("3DP-20260901-ABC123", baseRequest(), [
    { name: "bracket.stl", size: 2048, path: null, mode: "metadata" }
  ]);

  const customer = messages.find(message => message.to[0] === "jordan@example.com");
  assert.match(customer.html, /files were not uploaded/i);
  assert.match(customer.html, /attach them/i);
  assert.doesNotMatch(customer.html, /review the files and details/i);
});

test("sendRequestEmails throws when Resend rejects the request", async () => {
  resetEnv();
  configureEmail();
  globalThis.fetch = async () => new Response("secret-token customer@example.com", { status: 429 });

  await assert.rejects(
    () => sendRequestEmails("3DP-20260901-ABC123", baseRequest(), []),
    error => /Resend returned 429/.test(error.message) && !/secret-token|customer@example.com/.test(error.message)
  );
});

test("owner delivery remains successful when the customer receipt fails", async () => {
  resetEnv();
  configureEmail();
  globalThis.fetch = async (_url, options) => {
    const recipient = JSON.parse(options.body).to[0];
    return recipient === "hello@3dprint4.me"
      ? jsonResponse({ id: "owner_email" })
      : new Response("receipt rejected", { status: 429 });
  };

  const result = await sendRequestEmails("3DP-20260901-ABC123", baseRequest(), []);
  assert.deepEqual(result, { sent: 1, owner: true, customer: false });
});

test("postRequestWebhook is a no-op when no webhook URL is configured", async () => {
  resetEnv();
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("should not call webhook"); };
  const result = await postRequestWebhook("3DP-20260901-ABC123", baseRequest(), []);
  assert.deepEqual(result, { delivered: false });
  assert.equal(called, false);
});

test("postRequestWebhook signs the exact raw body with HMAC-SHA256 when a secret is configured", async () => {
  resetEnv();
  process.env.REQUEST_WEBHOOK_URL = "https://automation.example/hooks/3dprint4me";
  process.env.REQUEST_WEBHOOK_SECRET = "a-very-long-random-secret";
  let seen;
  globalThis.fetch = async (url, options) => {
    seen = { url, method: options.method, headers: options.headers, body: options.body };
    return jsonResponse({ ok: true });
  };

  const request = baseRequest();
  const result = await postRequestWebhook("3DP-20260901-ABC123", request, []);

  assert.deepEqual(result, { delivered: true });
  assert.equal(seen.url, "https://automation.example/hooks/3dprint4me");
  assert.equal(seen.method, "POST");

  const expectedSignature = `sha256=${createHmac("sha256", "a-very-long-random-secret").update(seen.body).digest("hex")}`;
  assert.equal(seen.headers["X-3DP-Signature"], expectedSignature);

  const parsed = JSON.parse(seen.body);
  assert.equal(parsed.event, "project.requested");
  assert.equal(parsed.id, "3DP-20260901-ABC123");
  assert.deepEqual(parsed.request, request);
});

test("postRequestWebhook omits the signature header when no secret is configured", async () => {
  resetEnv();
  process.env.REQUEST_WEBHOOK_URL = "https://automation.example/hooks/3dprint4me";
  let seen;
  globalThis.fetch = async (url, options) => { seen = options; return jsonResponse({ ok: true }); };

  await postRequestWebhook("3DP-20260901-ABC123", baseRequest(), []);

  assert.equal("X-3DP-Signature" in seen.headers, false);
});

test("postRequestWebhook throws on a non-2xx response so the caller can record the failure", async () => {
  resetEnv();
  process.env.REQUEST_WEBHOOK_URL = "https://automation.example/hooks/3dprint4me";
  globalThis.fetch = async () => new Response("", { status: 500 });

  await assert.rejects(
    () => postRequestWebhook("3DP-20260901-ABC123", baseRequest(), []),
    /Webhook returned 500/
  );
});
