import assert from "node:assert/strict";
import test from "node:test";

import { createWorkManagementService } from "../../lib/work-management/service.js";

test("Given a work repository, when application operations run, then the service delegates normalized intent without transport knowledge", async () => {
  const calls = [];
  const repository = {
    async listWork(query) { calls.push(["list", query]); return { items: [] }; },
    async getWork(id) { calls.push(["detail", id]); return { item: { id } }; },
    async listEvents(after, limit) { calls.push(["events", after, limit]); return { events: [] }; },
    async applyWorkCommand(id, command, operator, key) { calls.push(["command", id, command, operator, key]); return { item: { id } }; }
  };
  const service = createWorkManagementService({ repository });
  const operator = { id: "operator-1" };

  assert.deepEqual(await service.list({ view: "active" }), { items: [] });
  assert.deepEqual(await service.detail("work-1"), { item: { id: "work-1" } });
  assert.deepEqual(await service.events("9", 20), { events: [] });
  assert.deepEqual(await service.command("work-1", { type: "acknowledge", revision: 1 }, operator, "action-1"), { item: { id: "work-1" } });
  assert.deepEqual(calls, [
    ["list", { view: "active" }], ["detail", "work-1"], ["events", "9", 20],
    ["command", "work-1", { type: "acknowledge", revision: 1 }, operator, "action-1"]
  ]);
});

test("Given Push and operator capabilities, when the service is used, then each concern stays behind the repository port", async () => {
  const calls = [];
  const repository = {
    async findOperatorByAuthUserId(id) { calls.push(["operator", id]); return { id: "op" }; },
    async hasPushSubscription(operator) { calls.push(["has-push", operator.id]); return true; },
    async savePushSubscription(operator, subscription, agent) { calls.push(["save-push", operator.id, subscription.endpoint, agent]); return { subscribed: true }; },
    async claimPushOutbox(options) { calls.push(["claim", options]); return []; }
  };
  const service = createWorkManagementService({ repository });
  const operator = { id: "op" };

  assert.deepEqual(await service.findOperator("auth-user"), { id: "op" });
  assert.equal(await service.hasPushSubscription(operator), true);
  assert.deepEqual(await service.savePushSubscription(operator, { endpoint: "https://push.example" }, "Browser"), { subscribed: true });
  assert.deepEqual(await service.claimPushOutbox({ workerId: "worker", batchSize: 10 }), []);
  assert.deepEqual(calls, [["operator", "auth-user"], ["has-push", "op"], ["save-push", "op", "https://push.example", "Browser"], ["claim", { workerId: "worker", batchSize: 10 }]]);
});
