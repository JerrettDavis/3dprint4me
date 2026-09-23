import assert from "node:assert/strict";
import test from "node:test";

import { createHomeAssistantWorkHandler } from "../../api/home-assistant-work.js";
import { HttpError } from "../../lib/http.js";

const token = "home-assistant-test-token-with-at-least-32-characters";
const snapshot = {
  version: 1,
  generatedAt: "2026-09-22T12:00:00.000Z",
  queueUrl: "https://work.3dprint4.me/",
  counts: { active: 1, unacknowledged: 1, urgent: 0, waitingCustomer: 0 },
  latestCreatedId: "work_12345678",
  items: [{
    id: "work_12345678", title: "Replacement bracket", service: "print",
    status: "submitted", priority: "normal", acknowledged: false,
    submittedAt: "2026-09-22T11:55:00.000Z", targetDate: null,
    url: "https://work.3dprint4.me/work/work_12345678"
  }]
};

function response() {
  const headers = new Map();
  return {
    statusCode: 0,
    body: "",
    headers,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    end(value = "") { this.body += value; }
  };
}

function runtimeSpy(result = snapshot) {
  let calls = 0;
  return {
    runtime: { service: { async homeAssistantSnapshot() { calls += 1; return result; } } },
    calls: () => calls
  };
}

test("GET with the exact bearer token returns the snapshot without caching or CORS", async () => {
  const spy = runtimeSpy();
  const handler = createHomeAssistantWorkHandler({ runtime: spy.runtime, token });
  const res = response();
  await handler({ method: "GET", headers: { authorization: `Bearer ${token}` } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(res.headers.has("access-control-allow-origin"), false);
  assert.deepEqual(JSON.parse(res.body), snapshot);
  assert.equal(spy.calls(), 1);
});

test("missing and malformed authorization never read the snapshot", async () => {
  const spy = runtimeSpy();
  const handler = createHomeAssistantWorkHandler({ runtime: spy.runtime, token });
  const invalidHeaders = [
    {},
    { authorization: `Basic ${token}` },
    { authorization: `bearer ${token}` },
    { authorization: `Bearer ${token} extra` },
    { authorization: [`Bearer ${token}`] },
    { authorization: `Bearer ${token}`, Authorization: `Bearer ${token}` },
    { authorization: `Bearer ${token}-wrong` }
  ];
  for (const headers of invalidHeaders) {
    const res = response();
    await handler({ method: "GET", headers }, res);
    assert.equal(res.statusCode, 401, JSON.stringify(headers));
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(JSON.parse(res.body), { error: "Authentication is required." });
  }
  assert.equal(spy.calls(), 0);
});

test("duplicate raw Authorization fields are rejected after Node normalizes headers", async () => {
  const spy = runtimeSpy();
  const handler = createHomeAssistantWorkHandler({ runtime: spy.runtime, token });
  const res = response();
  await handler({
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
    rawHeaders: ["Host", "3dprint4.me", "Authorization", `Bearer ${token}`, "authorization", "Bearer another-token"]
  }, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(JSON.parse(res.body), { error: "Authentication is required." });
  assert.equal(spy.calls(), 0);
});

test("one raw Authorization field and a Headers object without rawHeaders remain valid", async () => {
  const spy = runtimeSpy();
  const handler = createHomeAssistantWorkHandler({ runtime: spy.runtime, token });
  const requests = [
    {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      rawHeaders: ["Host", "3dprint4.me", "Authorization", `Bearer ${token}`]
    },
    { method: "GET", headers: new Headers({ Authorization: `Bearer ${token}` }) }
  ];
  for (const req of requests) {
    const res = response();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), snapshot);
  }
  assert.equal(spy.calls(), 2);
});

test("an absent or short configured token fails closed before reading the snapshot", async () => {
  const spy = runtimeSpy();
  for (const configuredToken of ["", "too-short"]) {
    const handler = createHomeAssistantWorkHandler({ runtime: spy.runtime, token: configuredToken });
    const res = response();
    await handler({ method: "GET", headers: { authorization: `Bearer ${configuredToken}` } }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(JSON.parse(res.body), { error: "The service could not complete this request." });
    if (configuredToken) assert.equal(res.body.includes(configuredToken), false);
  }
  assert.equal(spy.calls(), 0);
});

test("POST is rejected with Allow GET and without reading the snapshot", async () => {
  const spy = runtimeSpy();
  const handler = createHomeAssistantWorkHandler({ runtime: spy.runtime, token });
  const res = response();
  await handler({ method: "POST", headers: { authorization: `Bearer ${token}` } }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.get("allow"), "GET");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(spy.calls(), 0);
});

test("provider failures reveal neither a sentinel secret nor raw internals in body or logs", async () => {
  const sentinel = "SENTINEL_PROVIDER_SECRET_123";
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args.join(" "));
  try {
    for (const failure of [new Error(`SQL failed: ${sentinel}`), new HttpError(400, sentinel)]) {
      const runtime = { service: { async homeAssistantSnapshot() { throw failure; } } };
      const handler = createHomeAssistantWorkHandler({ runtime, token });
      const res = response();
      await handler({ method: "GET", headers: { authorization: `Bearer ${token}` } }, res);
      assert.equal(res.statusCode, 503);
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.deepEqual(JSON.parse(res.body), { error: "Home Assistant integration is temporarily unavailable." });
      assert.equal(`${res.body}\n${logs.join("\n")}`.includes(sentinel), false);
    }
    assert.deepEqual(logs, ["Home Assistant work snapshot failed.", "Home Assistant work snapshot failed."]);
  } finally {
    console.error = originalError;
  }
});
