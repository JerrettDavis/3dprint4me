import assert from "node:assert/strict";
import test from "node:test";

import { createPushHandler } from "../../api/operator-push.js";

function response() {
  const headers = new Map();
  return { statusCode: 0, body: "", setHeader(name, value) { headers.set(name.toLowerCase(), value); }, end(value = "") { this.body += value; }, headers };
}
const origin = "http://127.0.0.1:4180";
const operator = { id: "op_12345678", authUserId: "auth-user", displayName: "Owner", role: "owner" };

test("Push API exposes only public configuration and current subscription state", async () => {
  const handler = createPushHandler({ store: { hasPushSubscription: async () => true }, authorize: async () => operator, allowedOrigins: [origin], vapidPublicKey: "PUBLIC_VAPID_KEY_123", pushConfigured: true });
  const res = response();
  await handler({ method: "GET", headers: { origin } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { supported: true, vapidPublicKey: "PUBLIC_VAPID_KEY_123", subscribed: true });
  assert.equal(res.body.includes("PRIVATE"), false);
});

test("Push API validates and stores a browser subscription for the authorized operator", async () => {
  const calls = [];
  const store = { savePushSubscription: async (...args) => { calls.push(args); return { id: "push_12345678", enabled: true }; } };
  const handler = createPushHandler({ store, authorize: async () => operator, allowedOrigins: [origin], vapidPublicKey: "PUBLIC_VAPID_KEY_123", pushConfigured: true });
  const subscription = { endpoint: "https://push.example.test/send/abc", expirationTime: null, keys: { p256dh: "browser-key_123", auth: "auth-key_123" } };
  const res = response();
  await handler({ method: "POST", headers: { origin, "content-type": "application/json", "user-agent": "Browser fixture" }, body: { action: "subscribe", subscription } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls, [[operator, subscription, "Browser fixture"]]);
  assert.deepEqual(JSON.parse(res.body), { subscribed: true });
});

test("Push API supports unsubscribe and queues a generic test alert without accepting extra fields", async () => {
  const calls = [];
  const store = {
    disablePushSubscription: async (...args) => { calls.push(["unsubscribe", ...args]); return { disabled: true }; },
    queueTestNotification: async (...args) => { calls.push(["test", ...args]); return { queued: true }; }
  };
  const handler = createPushHandler({ store, authorize: async () => operator, allowedOrigins: [origin], vapidPublicKey: "PUBLIC_VAPID_KEY_123", pushConfigured: true });
  const unsubscribe = response();
  await handler({ method: "POST", headers: { origin, "content-type": "application/json" }, body: { action: "unsubscribe", endpoint: "https://push.example.test/send/abc" } }, unsubscribe);
  assert.deepEqual(JSON.parse(unsubscribe.body), { subscribed: false });
  const testAlert = response();
  await handler({ method: "POST", headers: { origin, "content-type": "application/json" }, body: { action: "test" } }, testAlert);
  assert.deepEqual(JSON.parse(testAlert.body), { queued: true });
  const invalid = response();
  await handler({ method: "POST", headers: { origin, "content-type": "application/json" }, body: { action: "test", customerName: "leak" } }, invalid);
  assert.equal(invalid.statusCode, 400);
});
