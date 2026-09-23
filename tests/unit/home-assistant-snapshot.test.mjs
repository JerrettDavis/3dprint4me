import assert from "node:assert/strict";
import test from "node:test";

import { presentHomeAssistantSnapshot } from "../../lib/work-management/home-assistant-snapshot.js";
import { createWorkManagementService } from "../../lib/work-management/service.js";

test("snapshot exposes only operational summary fields and canonical work links", () => {
  const actual = presentHomeAssistantSnapshot({
    counts: { active: 1, unacknowledged: 1, urgent: 0, waitingCustomer: 0 },
    latestCreatedId: "work_12345678",
    items: [{
      id: "work_12345678", projectTitle: "Replacement bracket", service: "print",
      status: "submitted", priority: "normal", acknowledged: false,
      submittedAt: "2026-09-22T11:55:00.000Z", targetDate: null,
      requestId: "3DP-private", contact: { email: "private@example.com" },
      description: "private", files: ["private.stl"], notes: ["private"], revision: 7
    }]
  }, { now: () => new Date("2026-09-22T12:00:00.000Z") });

  assert.deepEqual(actual, {
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
  });
  assert.equal(JSON.stringify(actual).includes("private"), false);
});

test("empty snapshot preserves a null latest-created marker and no items", () => {
  const actual = presentHomeAssistantSnapshot({
    counts: { active: 0, unacknowledged: 0, urgent: 0, waitingCustomer: 0 },
    latestCreatedId: null,
    items: []
  }, { now: () => new Date("2026-09-22T12:00:00.000Z") });

  assert.deepEqual(actual, {
    version: 1,
    generatedAt: "2026-09-22T12:00:00.000Z",
    queueUrl: "https://work.3dprint4.me/",
    counts: { active: 0, unacknowledged: 0, urgent: 0, waitingCustomer: 0 },
    latestCreatedId: null,
    items: []
  });
});

test("invalid work IDs are rejected before a work URL can be constructed", () => {
  assert.throws(() => presentHomeAssistantSnapshot({
    counts: { active: 1, unacknowledged: 0, urgent: 0, waitingCustomer: 0 },
    latestCreatedId: "work_12345678",
    items: [{
      id: "https://attacker.example/", projectTitle: "Unsafe", service: "print",
      status: "submitted", priority: "normal", acknowledged: false,
      submittedAt: "2026-09-22T11:55:00.000Z", targetDate: null
    }]
  }), { name: "TypeError", message: "Snapshot contains an invalid work ID." });
});

test("service delegates snapshot retrieval and returns the presented contract", async () => {
  const calls = [];
  const repository = {
    async getHomeAssistantSnapshot() {
      calls.push("snapshot");
      return {
        counts: { active: 0, unacknowledged: 0, urgent: 0, waitingCustomer: 0 },
        latestCreatedId: null,
        items: []
      };
    }
  };
  const service = createWorkManagementService({ repository });

  const actual = await service.homeAssistantSnapshot();
  assert.match(actual.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual({ ...actual, generatedAt: "generated-at" }, {
    version: 1,
    generatedAt: "generated-at",
    queueUrl: "https://work.3dprint4.me/",
    counts: { active: 0, unacknowledged: 0, urgent: 0, waitingCustomer: 0 },
    latestCreatedId: null,
    items: []
  });
  assert.deepEqual(calls, ["snapshot"]);
});
