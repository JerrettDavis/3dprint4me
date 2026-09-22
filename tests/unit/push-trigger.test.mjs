import assert from "node:assert/strict";
import test from "node:test";

import { triggerPushWorker } from "../../lib/push-trigger.js";

test("immediate push trigger sends only an outbox identifier with worker authorization", async () => {
  const calls = [];
  const result = await triggerPushWorker("77", {
    url: "https://worker.example/drain", secret: "worker-secret",
    fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 202 }); }
  });
  assert.equal(result, true);
  assert.equal(calls[0].url, "https://worker.example/drain");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.authorization, "Bearer worker-secret");
  assert.deepEqual(JSON.parse(calls[0].init.body), { outboxId: "77" });
});

test("immediate push trigger is disabled safely when incomplete and treats failures as non-fatal", async () => {
  assert.equal(await triggerPushWorker("77", { url: "", secret: "" }), false);
  assert.equal(await triggerPushWorker("77", { url: "https://worker.example", secret: "secret", fetchImpl: async () => { throw new Error("private response"); } }), false);
});
