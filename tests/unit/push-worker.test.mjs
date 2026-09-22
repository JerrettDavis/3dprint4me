import assert from "node:assert/strict";
import test from "node:test";

import { createPushWorkerHandler } from "../../lib/push-worker.js";

test("push worker rejects requests without its shared secret", async () => {
  let drained = false;
  const handler = createPushWorkerHandler({ secret: "long-worker-secret", drain: async () => { drained = true; } });
  const response = await handler(new Request("https://worker.example/", { method: "POST" }));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: { code: "unauthorized", message: "Worker authorization failed." } });
  assert.equal(drained, false);
});

test("push worker drains a bounded batch for an authorized invocation", async () => {
  const calls = [];
  const handler = createPushWorkerHandler({
    secret: "long-worker-secret",
    drain: async options => { calls.push(options); return { claimed: 2, delivered: 2, disabled: 0, retrying: 0, failed: 0 }; }
  });
  const response = await handler(new Request("https://worker.example/", {
    method: "POST", headers: { authorization: "Bearer long-worker-secret" }
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { claimed: 2, delivered: 2, disabled: 0, retrying: 0, failed: 0 });
  assert.equal(calls.length, 1);
  assert.match(calls[0].workerId, /^push_/);
  assert.equal(calls[0].batchSize, 20);
});

test("push worker never returns provider or database internals", async () => {
  const handler = createPushWorkerHandler({ secret: "long-worker-secret", drain: async () => { throw new Error("postgres://secret raw provider body"); } });
  const response = await handler(new Request("https://worker.example/", { method: "POST", headers: { authorization: "Bearer long-worker-secret" } }));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: { code: "worker_failed", message: "Push delivery could not be completed." } });
});
