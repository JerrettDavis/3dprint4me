import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLocalWorkStore } from "../../lib/local-work-store.js";
import { createNeonWorkStore } from "../../lib/work-store.js";

const requestId = "3DP-20260921-ABCDEF0123456789ABCD";
const request = {
  service: "print",
  projectTitle: "Fixture bracket",
  contact: { name: "Customer", email: "customer@example.com" }
};

test("Neon completion creates submitted work, event and outbox in one atomic query", async () => {
  const calls = [];
  const query = async (strings, ...values) => {
    calls.push({ sql: strings.join("?"), values });
    return [{
      work_id: "work_1234567890abcdef",
      request_id: requestId,
      status: "submitted",
      priority: "normal",
      revision: 1,
      event_id: "41",
      outbox_id: "9"
    }];
  };
  const store = createNeonWorkStore({ query });

  const result = await store.completeRequestWithWork(requestId, request, []);

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /UPDATE service_requests[\s\S]+INSERT INTO work_items[\s\S]+INSERT INTO work_events[\s\S]+INSERT INTO notification_outbox/i);
  assert.deepEqual(result, {
    workItem: { id: "work_1234567890abcdef", requestId, status: "submitted", priority: "normal", revision: 1 },
    event: { id: "41", type: "work.created" },
    outbox: { id: "9", state: "pending" }
  });
});

test("Neon completion rejects a missing or previously completed draft without a partial result", async () => {
  const store = createNeonWorkStore({ query: async () => [] });
  await assert.rejects(
    store.completeRequestWithWork(requestId, request, []),
    error => error.status === 409 && /already been completed/i.test(error.message)
  );
});

test("Neon work reads minimize list data and normalize authorized detail", async () => {
  const query = async (strings) => {
    const sql = strings.join("?");
    if (sql.includes("FROM work_items w") && sql.includes("project_title") && !sql.includes("payload")) return [{ id: "work_12345678", request_id: requestId, status: "submitted", service: "print", project_title: "Fixture bracket", priority: "normal", acknowledged_at: null, submitted_at: "2026-09-21T12:00:00.000Z", target_date: null, revision: 1, created_at: "2026-09-21T12:00:00.000Z" }];
    if (sql.includes("payload") && sql.includes("uploaded_files")) return [{ id: "work_12345678", request_id: requestId, status: "submitted", previous_status: null, priority: "normal", acknowledged_at: null, acknowledged_by: null, target_date: null, assigned_operator_id: null, revision: 1, created_at: "2026-09-21T12:00:00.000Z", updated_at: "2026-09-21T12:00:00.000Z", completed_at: null, payload: request, uploaded_files: [] }];
    if (sql.includes("FROM work_notes")) return [];
    if (sql.includes("FROM work_events")) return [{ id: "1", event_type: "work.created", actor_type: "system", actor_id: null, data: { version: 1 }, occurred_at: "2026-09-21T12:00:00.000Z" }];
    throw new Error(`Unexpected query: ${sql}`);
  };
  const store = createNeonWorkStore({ query });
  const listed = await store.listWork({ view: "active", service: null, priority: null, limit: 30, cursor: null }, { id: "op_12345678" });
  assert.equal(listed.items[0].projectTitle, "Fixture bracket");
  assert.equal("description" in listed.items[0], false);
  const detail = await store.getWork("work_12345678", { id: "op_12345678" });
  assert.equal(detail.request.contact.email, "customer@example.com");
  assert.deepEqual(detail.notes, []);
  assert.equal(detail.events[0].type, "work.created");
});

test("Neon mutation is revision-bound and maps an empty atomic result to conflict", async () => {
  const calls = [];
  const success = createNeonWorkStore({ query: async (strings, ...values) => {
    calls.push(strings.join("?"));
    return [{ id: "work_12345678", request_id: requestId, status: "submitted", priority: "high", acknowledged_at: null, target_date: null, assigned_operator_id: null, revision: 3, updated_at: "2026-09-21T12:01:00.000Z", event_id: "3", event_type: "work.priority_changed", occurred_at: "2026-09-21T12:01:00.000Z" }];
  } });
  const result = await success.applyWorkCommand("work_12345678", { type: "set-priority", priority: "high", revision: 2 }, { id: "op_12345678" }, "action_priority_1");
  assert.equal(calls.length, 2);
  assert.equal(result.item.revision, 3);
  assert.equal(result.event.type, "work.priority_changed");

  let reads = 0;
  const conflict = createNeonWorkStore({ query: async (strings) => {
    if (strings.join("?").includes("SELECT revision")) { reads++; return [{ revision: 4 }]; }
    return [];
  } });
  await assert.rejects(conflict.applyWorkCommand("work_12345678", { type: "acknowledge", revision: 3 }, { id: "op_12345678" }, "action_ack_2"), error => error.status === 409 && error.details.currentRevision === 4);
  assert.equal(reads, 1);
});

test("Neon mutation returns the saved result for a repeated idempotency key", async () => {
  const saved = { item: { id: "work_12345678", revision: 3, priority: "high" }, event: { id: "3", type: "work.priority_changed" } };
  let mutationAttempted = false;
  const store = createNeonWorkStore({ query: async (strings) => {
    const sql = strings.join("?");
    if (sql.includes("SELECT result FROM work_actions")) return [{ result: saved }];
    mutationAttempted = true;
    return [];
  } });
  assert.deepEqual(await store.applyWorkCommand("work_12345678", { type: "set-priority", priority: "high", revision: 2 }, { id: "op_12345678" }, "action_priority_1"), saved);
  assert.equal(mutationAttempted, false);
});

test("local work store persists one complete work record across store instances", async () => {
  const directory = await mkdtemp(join(tmpdir(), "3dp-work-store-"));
  const path = join(directory, "operator-dev.json");
  try {
    const first = createLocalWorkStore({ path });
    const created = await first.completeRequestWithWork(requestId, request, [{ name: "part.stl", size: 1200 }]);
    assert.equal(created.workItem.requestId, requestId);
    assert.equal(created.workItem.status, "submitted");
    assert.equal(created.workItem.revision, 1);
    assert.equal(created.event.type, "work.created");
    assert.equal(created.outbox.state, "pending");

    const second = createLocalWorkStore({ path });
    const snapshot = await second.snapshot();
    assert.equal(snapshot.requests.length, 1);
    assert.equal(snapshot.workItems.length, 1);
    assert.equal(snapshot.events.length, 1);
    assert.equal(snapshot.outbox.length, 1);
    assert.equal(snapshot.requests[0].request.contact.email, "customer@example.com");

    await assert.rejects(
      second.completeRequestWithWork(requestId, request, []),
      error => error.status === 409
    );
    const persisted = JSON.parse(await readFile(path, "utf8"));
    assert.equal(persisted.workItems.length, 1);
    assert.equal(JSON.stringify(persisted).includes("DATABASE_URL"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("local work store supports minimized reads, interactive updates, history and conflicts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "3dp-work-operations-"));
  const path = join(directory, "operator-dev.json");
  try {
    const store = createLocalWorkStore({ path });
    const actor = await store.findOperatorByAuthUserId("local-development-owner");
    assert.equal(actor.role, "owner");
    const created = await store.completeRequestWithWork(requestId, request, [{ name: "part.stl", size: 1200 }]);

    const listed = await store.listWork({ view: "unacknowledged", service: "print", priority: null, limit: 30, cursor: null }, actor);
    assert.equal(listed.items.length, 1);
    assert.equal(listed.items[0].id, created.workItem.id);
    assert.equal("description" in listed.items[0], false);
    assert.equal("contact" in listed.items[0], false);

    const acknowledged = await store.applyWorkCommand(created.workItem.id, { type: "acknowledge", revision: 1 }, actor, "action_acknowledge_1");
    assert.equal(acknowledged.item.revision, 2);
    assert.equal(acknowledged.item.acknowledged, true);
    const repeated = await store.applyWorkCommand(created.workItem.id, { type: "acknowledge", revision: 1 }, actor, "action_acknowledge_1");
    assert.deepEqual(repeated, acknowledged);

    await assert.rejects(
      store.applyWorkCommand(created.workItem.id, { type: "set-priority", priority: "high", revision: 1 }, actor, "action_conflict_1"),
      error => error.status === 409 && error.details.currentRevision === 2
    );
    const priority = await store.applyWorkCommand(created.workItem.id, { type: "set-priority", priority: "high", revision: 2 }, actor, "action_priority_1");
    assert.equal(priority.item.priority, "high");
    const note = await store.applyWorkCommand(created.workItem.id, { type: "add-note", body: "Check dimensions.", revision: 3 }, actor, "action_note_1");
    assert.equal(note.item.revision, 4);

    const detail = await store.getWork(created.workItem.id, actor);
    assert.equal(detail.request.contact.email, "customer@example.com");
    assert.equal(detail.files[0].name, "part.stl");
    assert.equal(detail.notes[0].body, "Check dimensions.");
    assert.deepEqual(detail.events.map(event => event.type), ["work.created", "work.acknowledged", "work.priority_changed", "work.note_added"]);
    const events = await store.listEvents("0", 100, actor);
    assert.equal(events.events.length, 4);
    assert.equal(events.nextCursor, "4");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("local work store owns subscriptions and leases notification outbox idempotently", async () => {
  const directory = await mkdtemp(join(tmpdir(), "3dp-push-store-"));
  const path = join(directory, "operator-dev.json");
  try {
    const store = createLocalWorkStore({ path });
    const actor = await store.findOperatorByAuthUserId("local-development-owner");
    await store.completeRequestWithWork(requestId, request, []);
    const subscription = { endpoint: "https://push.example.test/send/abc", expirationTime: null, keys: { p256dh: "browser-key_123", auth: "auth-key_123" } };
    assert.deepEqual(await store.savePushSubscription(actor, subscription, "Browser fixture"), { subscribed: true });
    assert.equal(await store.hasPushSubscription(actor), true);
    const claimed = await store.claimPushOutbox({ workerId: "worker_12345678", batchSize: 10 });
    assert.equal(claimed.length, 1);
    assert.equal((await store.claimPushOutbox({ workerId: "worker_other_12", batchSize: 10 })).length, 0);
    const subscriptions = await store.listPushSubscriptions(claimed[0]);
    assert.equal(subscriptions.length, 1);
    await store.recordPushOutcome({ outboxId: claimed[0].id, subscriptionId: subscriptions[0].id, state: "delivered", category: null });
    await store.finishPushOutbox(claimed[0].id, { delivered: 1, retrying: 0 });
    assert.equal((await store.snapshot()).outbox[0].state, "delivered");
    assert.deepEqual(await store.disablePushSubscription(actor, subscription.endpoint), { disabled: true });
    assert.equal(await store.hasPushSubscription(actor), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
