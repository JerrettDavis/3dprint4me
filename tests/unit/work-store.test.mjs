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
