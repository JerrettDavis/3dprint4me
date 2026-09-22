import assert from "node:assert/strict";
import test from "node:test";

import { createApiClient, OperatorApiError } from "../../operator/assets/api-client.js";
import { createPushClient, urlBase64ToUint8Array } from "../../operator/assets/push-client.js";
import { allowedTransitions, filterWork, sortWork } from "../../operator/assets/work-state.js";
import { createAuthClient } from "../../operator/assets/auth-client.js";

test("operator API client uses credentialed requests and distinguishes recovery classes", async () => {
  const calls = [];
  const client = createApiClient({ apiBase: "https://api.example", getSessionHeaders: async () => ({ authorization: "Bearer session" }), fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ error: "changed", code: "revision_conflict", currentRevision: 4 }), { status: 409, headers: { "content-type": "application/json" } });
  } });
  await assert.rejects(client.updateWork("work_1", { type: "acknowledge", revision: 3 }, "idem_12345678"), error => error instanceof OperatorApiError && error.kind === "conflict" && error.currentRevision === 4);
  assert.equal(calls[0].init.credentials, "include");
  assert.equal(calls[0].init.headers.authorization, "Bearer session");
  assert.equal(calls[0].init.cache, "no-store");
});

test("work helpers filter, rank and expose only valid next states", () => {
  const items = [{ id: "2", service: "print", priority: "normal", submittedAt: "2026-09-21T12:00:00Z" }, { id: "1", service: "repair", priority: "urgent", submittedAt: "2026-09-21T13:00:00Z" }];
  assert.deepEqual(sortWork(items).map(item => item.id), ["1", "2"]);
  assert.deepEqual(filterWork(items, { service: "print" }).map(item => item.id), ["2"]);
  assert.deepEqual(allowedTransitions({ status: "approved", targetDate: null }), ["waiting_customer", "cancelled"]);
  assert.deepEqual(allowedTransitions({ status: "approved", targetDate: "2026-09-24" }), ["scheduled", "waiting_customer", "cancelled"]);
});

test("Push remains explicit and converts the VAPID URL-safe key correctly", async () => {
  assert.deepEqual([...urlBase64ToUint8Array("AQIDBA")], [1, 2, 3, 4]);
  let prompted = 0;
  const push = createPushClient({
    navigator: { serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: async () => null, subscribe: async () => ({ toJSON: () => ({ endpoint: "https://push.example", keys: { p256dh: "p", auth: "a" } }) }) } }) } },
    Notification: { permission: "default", requestPermission: async () => { prompted += 1; return "denied"; } },
    api: { pushConfig: async () => ({ supported: true, vapidPublicKey: "AQIDBA", subscribed: false }) }
  });
  assert.equal(prompted, 0);
  assert.equal((await push.getState()).permission, "default");
  assert.equal((await push.enable()).state, "denied");
  assert.equal(prompted, 1);
});

test("provider-neutral auth adapter supplies the official client token only as an API header", async () => {
  const auth = createAuthClient({ client: { signIn: { social() {} }, getSession() {}, signOut() {} }, getToken: async () => "verified-jwt" });
  assert.deepEqual(await auth.sessionHeaders(), { authorization: "Bearer verified-jwt" });
});
