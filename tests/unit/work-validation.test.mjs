import assert from "node:assert/strict";
import test from "node:test";

import {
  canTransition,
  decodeWorkCursor,
  encodeWorkCursor,
  parsePushSubscription,
  parseWorkCommand,
  parseWorkQuery
} from "../../lib/work-validation.js";

test("work transitions enforce the operational workflow and scheduling prerequisite", () => {
  assert.equal(canTransition("submitted", "triage", {}), true);
  assert.equal(canTransition("triage", "waiting_customer", {}), true);
  assert.equal(canTransition("waiting_customer", "triage", { previousStatus: "triage" }), true);
  assert.equal(canTransition("waiting_customer", "quoted", { previousStatus: "triage" }), false);
  assert.equal(canTransition("submitted", "completed", {}), false);
  assert.equal(canTransition("approved", "scheduled", { targetDate: null }), false);
  assert.equal(canTransition("approved", "scheduled", { targetDate: "2026-09-30" }), true);
  assert.equal(canTransition("completed", "in_progress", {}), false);
});

test("work commands normalize valid input and reject unsafe or unrelated fields", () => {
  assert.deepEqual(parseWorkCommand({ type: "acknowledge", revision: 1 }), {
    type: "acknowledge",
    revision: 1
  });
  assert.deepEqual(parseWorkCommand({ type: "set-priority", priority: " HIGH ", revision: 2 }), {
    type: "set-priority",
    priority: "high",
    revision: 2
  });
  assert.deepEqual(parseWorkCommand({ type: "set-target-date", targetDate: "2026-09-30", revision: 3 }), {
    type: "set-target-date",
    targetDate: "2026-09-30",
    revision: 3
  });
  assert.deepEqual(parseWorkCommand({ type: "add-note", body: "  Check fit before slicing.  ", revision: 4 }), {
    type: "add-note",
    body: "Check fit before slicing.",
    revision: 4
  });
  assert.throws(() => parseWorkCommand({ type: "set-priority", priority: "critical", revision: 2 }), /priority/i);
  assert.throws(() => parseWorkCommand({ type: "add-note", body: " ", revision: 1 }), /note/i);
  assert.throws(() => parseWorkCommand({ type: "acknowledge", revision: 0 }), /revision/i);
  assert.throws(() => parseWorkCommand({ type: "acknowledge", revision: 1, admin: true }), /field/i);
});

test("work list queries are bounded and use opaque round-tripping cursors", () => {
  const cursor = encodeWorkCursor({ sort: "2026-09-21T12:00:00.000Z", id: "work_1234567890abcdef" });
  assert.deepEqual(decodeWorkCursor(cursor), {
    sort: "2026-09-21T12:00:00.000Z",
    id: "work_1234567890abcdef"
  });
  assert.deepEqual(parseWorkQuery({ view: "active", service: "print", priority: "high", limit: "25", cursor }), {
    view: "active",
    service: "print",
    priority: "high",
    limit: 25,
    cursor: { sort: "2026-09-21T12:00:00.000Z", id: "work_1234567890abcdef" }
  });
  assert.throws(() => parseWorkQuery({ limit: "101" }), /limit/i);
  assert.throws(() => decodeWorkCursor("not-a-valid-cursor"), /cursor/i);
  assert.throws(() => parseWorkQuery({ service: "laser" }), /service/i);
});

test("push subscriptions require HTTPS endpoints and complete browser key material", () => {
  const parsed = parsePushSubscription({
    endpoint: "https://push.example.test/send/abc",
    expirationTime: null,
    keys: { p256dh: "BElong-but-bounded-browser-key_123", auth: "auth-key_123" }
  });
  assert.deepEqual(parsed, {
    endpoint: "https://push.example.test/send/abc",
    expirationTime: null,
    keys: { p256dh: "BElong-but-bounded-browser-key_123", auth: "auth-key_123" }
  });
  assert.throws(() => parsePushSubscription({
    endpoint: "http://push.example.test/send/abc",
    keys: { p256dh: "key", auth: "auth" }
  }), /https/i);
  assert.throws(() => parsePushSubscription({ endpoint: "https://push.example.test/send/abc", keys: {} }), /key/i);
});
