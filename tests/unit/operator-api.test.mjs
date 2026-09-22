import assert from "node:assert/strict";
import test from "node:test";

import { createOperatorApiHandler } from "../../lib/operator-api.js";
import { createSessionHandler } from "../../api/operator-session.js";

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

const operator = { id: "op_12345678", authUserId: "auth-user-123", displayName: "Jerrett", role: "owner" };

test("session endpoint returns only the approved operator's public identity", async () => {
  const res = response();
  const store = {
    findOperatorByAuthUserId: async () => ({ ...operator, enabled: true }),
    touchOperator: async () => {}
  };
  const identityProvider = { getIdentity: async () => ({ authUserId: "auth-user-123", name: "Provider name", email: "private@example.com", provider: "github" }) };
  const handler = createSessionHandler({ store, identityProvider, allowedOrigins: ["http://127.0.0.1:4180"] });
  await handler({ method: "GET", headers: { origin: "http://127.0.0.1:4180" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), {
    authenticated: true,
    operator: { id: "op_12345678", displayName: "Jerrett", role: "owner" }
  });
  assert.equal(res.body.includes("private@example.com"), false);
  assert.equal(res.body.includes("auth-user-123"), false);
});

test("operator API allows only configured origins and emits credentialed no-store responses", async () => {
  const handler = createOperatorApiHandler({
    methods: ["GET"],
    allowedOrigins: ["http://127.0.0.1:4180"],
    authorize: async () => operator,
    handle: async ({ operator: authorized }) => ({ status: 200, body: { operator: authorized } })
  });
  const res = response();
  await handler({ method: "GET", headers: { origin: "http://127.0.0.1:4180" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "http://127.0.0.1:4180");
  assert.equal(res.headers.get("access-control-allow-credentials"), "true");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(JSON.parse(res.body), { operator });

  const denied = response();
  await handler({ method: "GET", headers: { origin: "https://evil.example" } }, denied);
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.headers.has("access-control-allow-origin"), false);
});

test("operator API handles preflight without authorization and rejects unlisted methods", async () => {
  let authorizationCalls = 0;
  const handler = createOperatorApiHandler({
    methods: ["GET"],
    allowedOrigins: ["http://127.0.0.1:4180"],
    authorize: async () => { authorizationCalls++; return operator; },
    handle: async () => ({ status: 200, body: {} })
  });
  const preflight = response();
  await handler({ method: "OPTIONS", headers: { origin: "http://127.0.0.1:4180", "access-control-request-method": "GET" } }, preflight);
  assert.equal(preflight.statusCode, 204);
  assert.equal(authorizationCalls, 0);

  const wrongMethod = response();
  await handler({ method: "POST", headers: { origin: "http://127.0.0.1:4180" } }, wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);
  assert.equal(wrongMethod.headers.get("allow"), "GET, OPTIONS");
});

test("operator API normalizes authorization and provider failures without leaking messages", async () => {
  const secret = "provider-secret-body";
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args.join(" "));
  try {
    const handler = createOperatorApiHandler({
      methods: ["GET"],
      allowedOrigins: ["http://127.0.0.1:4180"],
      authorize: async () => { throw new Error(secret); },
      handle: async () => ({ status: 200, body: {} })
    });
    const res = response();
    await handler({ method: "GET", headers: { origin: "http://127.0.0.1:4180" } }, res);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(JSON.parse(res.body), { error: "Operator service is temporarily unavailable.", code: "operator_unavailable" });
    assert.equal(res.body.includes(secret), false);
    assert.equal(logs.join(" ").includes(secret), false);
  } finally {
    console.error = originalError;
  }
});
