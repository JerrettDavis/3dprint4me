import assert from "node:assert/strict";
import test from "node:test";

import { buildNewWorkNotification, drainPushOutbox } from "../../lib/push-delivery.js";

test("new-work notification payload is generic and contains no customer or project data", () => {
  const payload = buildNewWorkNotification({ eventId: "42", workId: "work_12345678", customerName: "Private Person", email: "private@example.com", projectTitle: "Secret prototype", description: "Do not expose", fileName: "secret.stl" });
  assert.deepEqual(payload, {
    version: 1,
    title: "New 3dprint4.me work request",
    body: "Open the work inbox to review it.",
    tag: "work-42",
    data: { route: "/work/work_12345678", eventId: "42", workId: "work_12345678" }
  });
  const serialized = JSON.stringify(payload);
  for (const privateValue of ["Private Person", "private@example.com", "Secret prototype", "Do not expose", "secret.stl"]) assert.equal(serialized.includes(privateValue), false);
});

test("Push drain records delivery, endpoint expiry, retryable failure and malformed permanent failure", async () => {
  const outcomes = [];
  const store = {
    claimPushOutbox: async () => [{ id: "7", eventId: "42", payload: { version: 1, eventId: "42", workId: "work_12345678" } }],
    listPushSubscriptions: async () => [
      { id: "push_success", endpoint: "https://push.example/success", keys: { p256dh: "key", auth: "auth" } },
      { id: "push_expired", endpoint: "https://push.example/expired", keys: { p256dh: "key", auth: "auth" } },
      { id: "push_retry", endpoint: "https://push.example/retry", keys: { p256dh: "key", auth: "auth" } },
      { id: "push_bad", endpoint: "https://push.example/bad", keys: { p256dh: "key", auth: "auth" } }
    ],
    recordPushOutcome: async outcome => outcomes.push(outcome),
    finishPushOutbox: async (id, summary) => outcomes.push({ id, summary })
  };
  const transport = { send: async subscription => {
    if (subscription.id === "push_expired") throw Object.assign(new Error("raw provider body"), { statusCode: 410 });
    if (subscription.id === "push_retry") throw Object.assign(new Error("raw provider body"), { statusCode: 503 });
    if (subscription.id === "push_bad") throw Object.assign(new Error("raw provider body"), { statusCode: 400 });
    return { statusCode: 201 };
  } };
  const result = await drainPushOutbox({ store, transport, workerId: "worker_12345678", batchSize: 10 });
  assert.deepEqual(result, { claimed: 1, delivered: 1, disabled: 1, retrying: 1, failed: 1 });
  assert.deepEqual(outcomes.slice(0, 4).map(value => [value.subscriptionId, value.state, value.category]), [
    ["push_success", "delivered", null],
    ["push_expired", "disabled", "endpoint_expired"],
    ["push_retry", "retrying", "provider_temporary"],
    ["push_bad", "failed", "subscription_invalid"]
  ]);
  assert.equal(JSON.stringify(outcomes).includes("raw provider body"), false);
});

test("Push drain is a no-op when the store lease returns no pending work", async () => {
  let sent = false;
  const result = await drainPushOutbox({
    store: { claimPushOutbox: async () => [], listPushSubscriptions: async () => { throw new Error("must not run"); } },
    transport: { send: async () => { sent = true; } }, workerId: "worker_12345678", batchSize: 10
  });
  assert.deepEqual(result, { claimed: 0, delivered: 0, disabled: 0, retrying: 0, failed: 0 });
  assert.equal(sent, false);
});

test("Push drain finishes each claimed entry with only that entry's outcomes", async () => {
  const finished = [];
  const store = {
    claimPushOutbox: async () => [
      { id: "1", eventId: "11", payload: { workId: "work_one" } },
      { id: "2", eventId: "12", payload: { workId: "work_two" } }
    ],
    listPushSubscriptions: async entry => [{ id: `push_${entry.id}`, endpoint: `https://push.example/${entry.id}`, keys: { p256dh: "key", auth: "auth" } }],
    recordPushOutcome: async () => {},
    finishPushOutbox: async (id, summary) => finished.push({ id, summary })
  };
  const transport = { send: async subscription => {
    if (subscription.id === "push_2") throw Object.assign(new Error("temporary"), { statusCode: 503 });
  } };
  await drainPushOutbox({ store, transport, workerId: "worker_12345678" });
  assert.deepEqual(finished, [
    { id: "1", summary: { delivered: 1, disabled: 0, retrying: 0, failed: 0 } },
    { id: "2", summary: { delivered: 0, disabled: 0, retrying: 1, failed: 0 } }
  ]);
});
